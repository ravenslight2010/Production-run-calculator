import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  calculateQloraPromotionPower,
  compareQloraPromotionResultManifests,
  compareEvaluationManifests,
  evaluateConditionalQloraPromotion,
  QLORA_PROMOTION_POWER_METHOD,
  readEvaluationManifest,
  validateEvaluationManifest,
  validateQloraPromotionResultManifest,
  type EvaluationManifest,
  type QloraPromotionCaseResult,
  type QloraPromotionInput,
  type QloraPromotionSafetyGates,
} from "./index.js";

const digest = "a".repeat(64);
const manifest: EvaluationManifest = {
  manifestVersion: 1,
  evaluation: { id: "fixture", kind: "deterministic" },
  corpus: { sha256: digest, cases: 2, sourceAuthority: "synthetic-fixture" },
  thresholds: { minimumAccuracy: 1 },
  dependencies: { node: "24" },
  provider: { identityState: "not-applicable", name: null, model: null },
  performance: {
    inputTokens: { state: "unavailable", reason: "not applicable" },
    outputTokens: { state: "unavailable", reason: "not applicable" },
    cost: { state: "measured", value: 0, unit: "USD" },
    latencyP95: { state: "measured", value: 4, unit: "ms" },
  },
  execution: { retries: 0, seed: 7 },
  privacy: {
    mode: "synthetic-only",
    rawProviderPayloadsRetained: false,
    retainedEvaluationContent: "synthetic",
  },
  outcome: { state: "passed", reason: null },
  provenance: {
    sourceSha256: digest,
    evidence: { state: "hashed", sha256: digest },
    evidenceType: "fixture",
    evaluator: { state: "hashed", sha256: digest },
  },
};

describe("evaluation manifest", () => {
  it("validates a complete versioned manifest", () => {
    expect(validateEvaluationManifest(manifest)).toEqual(manifest);
  });

  it("keeps unavailable distinct from failed", () => {
    expect(validateEvaluationManifest({ ...manifest, outcome: { state: "unavailable", reason: "provider not configured" } }).outcome.state).toBe("unavailable");
    expect(validateEvaluationManifest({ ...manifest, outcome: { state: "failed", reason: "threshold missed" } }).outcome.state).toBe("failed");
  });

  it("rejects ambiguous or unsafe evidence", () => {
    expect(() => validateEvaluationManifest({ ...manifest, performance: { ...manifest.performance, cost: null } })).toThrow(/cost/);
    expect(() => validateEvaluationManifest({ ...manifest, performance: { ...manifest.performance, cost: { state: "measured", value: -1, unit: "USD" } } })).toThrow(/non-negative/);
    expect(() => validateEvaluationManifest({ ...manifest, privacy: { ...manifest.privacy, rawProviderPayloadsRetained: true } })).toThrow(/privacy/);
    expect(() => validateEvaluationManifest({ ...manifest, outcome: { state: "failed", reason: null } })).toThrow(/require a reason/);
    expect(() => validateEvaluationManifest({ ...manifest, provenance: { ...manifest.provenance, sourceSha256: "b".repeat(64) } })).toThrow(/match corpus/);
  });

  it("reads additive wrappers and legacy reviewer reports", () => {
    expect(readEvaluationManifest({ evaluationManifest: manifest })).toEqual(manifest);
    const legacy = readEvaluationManifest({
      benchmarkVersion: 1,
      sourceHash: digest,
      acceptanceCriteria: { maximumFailureRate: 0.05 },
      corpus: { labeledCases: 3, sourceAuthority: "human-review" },
      measuredEffects: { p95LatencyMs: 20 },
      latencyAndRetry: { reviewerRetries: 0 },
      decision: { retain: false, reason: "threshold missed" },
    });
    expect(legacy.outcome.state).toBe("failed");
    expect(legacy.performance.inputTokens.state).toBe("unavailable");
    expect(legacy.corpus.sha256).toBe(digest);
  });

  it("reads legacy Gemini reports only with source-bound metadata", () => {
    const legacy = {
      provider: "gemini",
      model: "fixture-model",
      metrics: { evaluated: 0 },
      results: [{ status: "provider_unavailable", attempts: 1 }],
    };
    expect(() => readEvaluationManifest(legacy)).toThrow(/source metadata/);
    const translated = readEvaluationManifest(legacy, {
      sourceSha256: digest,
      cases: 1,
      sourceAuthority: "reviewed fixture",
    });
    expect(translated.outcome.state).toBe("unavailable");
    expect(translated.provenance.sourceSha256).toBe(digest);
    const mixed = readEvaluationManifest(
      {
        ...legacy,
        metrics: { evaluated: 1, accuracy: 1 },
        results: [
          { status: "included", expected: "trigger", decision: "trigger" },
          { status: "provider_unavailable" },
        ],
      },
      { sourceSha256: digest, cases: 2, sourceAuthority: "reviewed fixture" },
    );
    expect(mixed.outcome.state).toBe("failed");
    const disagreements = readEvaluationManifest(
      {
        ...legacy,
        metrics: { evaluated: 2, accuracy: 1 },
        results: [
          { status: "disagreement", expected: "trigger", decision: "do_not_trigger" },
          { status: "disagreement", expected: "do_not_trigger", decision: "trigger" },
        ],
      },
      { sourceSha256: digest, cases: 2, sourceAuthority: "reviewed fixture" },
    );
    expect(disagreements.outcome.state).toBe("failed");
    const empty = readEvaluationManifest(
      { ...legacy, results: [] },
      { sourceSha256: digest, cases: 0, sourceAuthority: "reviewed fixture" },
    );
    expect(empty.outcome.state).toBe("unavailable");
    expect(() => readEvaluationManifest(
      legacy,
      { sourceSha256: digest, cases: 0, sourceAuthority: "reviewed fixture" },
    )).toThrow(/exceeds declared corpus/);
  });
});


describe("evaluation manifest comparison", () => {
  it("separates identity, metric, and outcome changes", () => {
    const candidate: EvaluationManifest = {
      ...manifest,
      corpus: { ...manifest.corpus, cases: 3 },
      thresholds: { minimumAccuracy: 0.9 },
      performance: {
        ...manifest.performance,
        latencyP95: { state: "measured", value: 6, unit: "ms" },
      },
      outcome: { state: "failed", reason: "threshold missed" },
    };
    const comparison = compareEvaluationManifests(manifest, candidate);
    expect(comparison.identityChanges.map((change) => change.path)).toEqual([
      "corpus.cases",
      "thresholds.minimumAccuracy",
    ]);
    expect(comparison.metricChanges.map((change) => change.path)).toEqual([
      "performance.latencyP95.value",
    ]);
    expect(comparison.outcomeChanges.map((change) => change.path)).toEqual([
      "outcome.reason",
      "outcome.state",
    ]);
    expect(comparison.summary).toBe("5 changes: 2 identity, 1 metric, 2 outcome.");
  });

  it("reports identical manifests concisely", () => {
    expect(compareEvaluationManifests(manifest, manifest).summary).toMatch(/^No changes:/);
  });

  it("refuses incompatible and unbound evidence", () => {
    expect(() => compareEvaluationManifests(
      manifest,
      { ...manifest, evaluation: { ...manifest.evaluation, id: "other" } },
    )).toThrow(/incompatible.*evaluation\.id/);
    expect(() => compareEvaluationManifests(
      {
        ...manifest,
        provenance: {
          ...manifest.provenance,
          evidence: { state: "unavailable", reason: "legacy report" },
        },
      },
      manifest,
    )).toThrow(/baseline manifest is unbound.*evidence hash.*legacy report/);
  });

  it("compares hashed historical evidence with explicit evaluator limitations", () => {
    const historical: EvaluationManifest = {
      ...manifest,
      provenance: {
        ...manifest.provenance,
        evaluator: { state: "unavailable", reason: "predates evaluator binding" },
      },
    };
    const comparison = compareEvaluationManifests(historical, historical);
    expect(comparison.identityChanges).toEqual([]);
    expect(comparison.limitations).toEqual([
      "baseline evaluator identity is unavailable: predates evaluator binding",
      "candidate evaluator identity is unavailable: predates evaluator binding",
    ]);
  });
});

const promotionFields = Array.from({ length: 100 }, (_, index) => `field-${index}`);
const promotionCriticalFields = promotionFields.slice(0, 10);

function qloraIdentity(expectedCases: number) {
  return {
    state: "identified" as const,
    sourceRevisionSha256: "a".repeat(64),
    promptParseCacheSha256: "b".repeat(64),
    outputSchemaSha256: "c".repeat(64),
    sanitizerSha256: "d".repeat(64),
    caseInputManifestSha256: "e".repeat(64),
    goldLabelManifestSha256: "f".repeat(64),
    fieldScoringRulesSha256: "1".repeat(64),
    scoringImplementationSha256: "2".repeat(64),
    expectedCases,
    candidate: {
      modelSha256: "3".repeat(64),
      tokenizerSha256: "4".repeat(64),
      generationSettingsSha256: "5".repeat(64),
      retryPolicySha256: "6".repeat(64),
    },
    promptedBase: {
      modelSha256: "7".repeat(64),
      tokenizerSha256: "4".repeat(64),
      generationSettingsSha256: "5".repeat(64),
      retryPolicySha256: "6".repeat(64),
    },
    gemini: {
      provider: "Gemini",
      model: "synthetic-gemini",
      generationSettingsSha256: "8".repeat(64),
      retryPolicySha256: "9".repeat(64),
    },
  };
}

function qloraRow(
  caseId: string,
  brandClusterId: string,
  correctFields: string[],
  overrides: Partial<QloraPromotionCaseResult> = {},
): QloraPromotionCaseResult {
  return {
    caseId,
    brandClusterId,
    eligibleFields: promotionFields,
    criticalFields: promotionCriticalFields,
    fieldCorrectness: Object.fromEntries(correctFields.map((field) => [field, true])),
    schemaValid: true,
    blankPoison: false,
    emptyOutput: false,
    systematicMissingRequiredFields: false,
    ...overrides,
  };
}

function qloraRows(
  expectedCases: number,
  counts: { candidate: number; promptedBase: number; gemini: number },
): QloraPromotionInput["results"] {
  const runs = {
    candidate: [] as QloraPromotionCaseResult[],
    promptedBase: [] as QloraPromotionCaseResult[],
    gemini: [] as QloraPromotionCaseResult[],
  };
  const makeCorrectFields = (count: number) => {
    const criticalCount = Math.round(count / 10);
    const nonCriticalFields = promotionFields.filter(
      (field) => !promotionCriticalFields.includes(field),
    );
    return [
      ...nonCriticalFields.slice(0, count - criticalCount),
      ...promotionCriticalFields.slice(0, criticalCount),
    ];
  };
  for (let index = 0; index < expectedCases; index += 1) {
    const caseId = `case-${index}`;
    const brandClusterId = `brand-${index}`;
    runs.candidate.push(qloraRow(caseId, brandClusterId, makeCorrectFields(counts.candidate)));
    runs.promptedBase.push(qloraRow(caseId, brandClusterId, makeCorrectFields(counts.promptedBase)));
    runs.gemini.push(qloraRow(caseId, brandClusterId, makeCorrectFields(counts.gemini)));
  }
  return runs;
}

function qloraInput(
  results: QloraPromotionInput["results"] = qloraRows(12, {
    candidate: 90,
    promptedBase: 80,
    gemini: 92,
  }),
): QloraPromotionInput {
  return {
    identities: qloraIdentity(results.candidate.length),
    powerAnalysis: {
      state: "qualified",
      developmentEvidenceSha256: "f".repeat(64),
      method: QLORA_PROMOTION_POWER_METHOD,
      seed: 20261002,
      confidenceLevel: 0.95,
      minimumPower: 0.8,
      overallTargetMarginPercentagePoints: 5,
      criticalTargetMarginPercentagePoints: 3,
      developmentCaseCount: 12,
      developmentBrandClusterCount: 12,
      simulationReplicates: 5000,
      plannedBrandClusters: 10,
      overallPower: 0.85,
      criticalPower: 0.84,
    },
    bootstrapSeed: 20261002,
    results,
  };
}

function qloraDevelopmentPowerInput(
  results: QloraPromotionInput["results"] = qloraRows(12, {
    candidate: 90,
    promptedBase: 80,
    gemini: 92,
  }),
  seed = 20261002,
) {
  return {
    evidenceScope: "development-only" as const,
    seed,
    results: {
      candidate: results.candidate,
      promptedBase: results.promptedBase,
    },
  };
}

type QloraPowerReferenceBrand = {
  caseCount: number;
  overallFieldGainsPerCase: number;
  criticalFieldGainCases: number;
};

type QloraPowerReferenceVector = {
  name: string;
  nearMargin: boolean;
  brands: QloraPowerReferenceBrand[];
  referenceMinimumBrandClusters: number;
  minimumBrandClusterTolerance: number;
  referencePowerByBrandCount: Record<number, { overall: number; critical: number }>;
  powerAbsoluteTolerance: number;
};

const qloraPowerReferenceFields = Array.from({ length: 100 }, (_, index) => `field-${index}`);
const qloraPowerReferenceCriticalFields = qloraPowerReferenceFields.slice(0, 20);

function qloraPowerReferenceInput(brands: QloraPowerReferenceBrand[], seed = 20261002) {
  const candidate: QloraPromotionCaseResult[] = [];
  const promptedBase: QloraPromotionCaseResult[] = [];
  brands.forEach((brand, brandIndex) => {
    for (let caseIndex = 0; caseIndex < brand.caseCount; caseIndex += 1) {
      const criticalGain = caseIndex < brand.criticalFieldGainCases ? 1 : 0;
      const correctFields = new Set<string>();
      if (criticalGain) correctFields.add(qloraPowerReferenceCriticalFields[0]);
      for (
        let fieldIndex = 0;
        fieldIndex < brand.overallFieldGainsPerCase - criticalGain;
        fieldIndex += 1
      ) {
        correctFields.add(qloraPowerReferenceFields[20 + fieldIndex]);
      }
      const row: QloraPromotionCaseResult = {
        caseId: `synthetic-case-${brandIndex}-${caseIndex}`,
        brandClusterId: `synthetic-brand-${brandIndex}`,
        eligibleFields: qloraPowerReferenceFields,
        criticalFields: qloraPowerReferenceCriticalFields,
        fieldCorrectness: Object.fromEntries([...correctFields].map((field) => [field, true])),
        schemaValid: true,
        blankPoison: false,
        emptyOutput: false,
        systematicMissingRequiredFields: false,
      };
      candidate.push(row);
      promptedBase.push({ ...row, fieldCorrectness: {} });
    }
  });
  return {
    evidenceScope: "development-only" as const,
    seed,
    results: { candidate, promptedBase },
  };
}

const qloraPowerReferenceAdditionalSeeds = [20261003, 20261004, 20261005] as const;

const qloraPowerReferenceVectors: QloraPowerReferenceVector[] = [
  {
    name: "balanced brands with low variance and gains comfortably above both margins",
    nearMargin: false,
    brands: [
      { caseCount: 10, overallFieldGainsPerCase: 7, criticalFieldGainCases: 8 },
      { caseCount: 10, overallFieldGainsPerCase: 8, criticalFieldGainCases: 9 },
      { caseCount: 10, overallFieldGainsPerCase: 9, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 7, criticalFieldGainCases: 9 },
      { caseCount: 10, overallFieldGainsPerCase: 8, criticalFieldGainCases: 8 },
      { caseCount: 10, overallFieldGainsPerCase: 9, criticalFieldGainCases: 9 },
      { caseCount: 10, overallFieldGainsPerCase: 7, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 8, criticalFieldGainCases: 9 },
      { caseCount: 10, overallFieldGainsPerCase: 9, criticalFieldGainCases: 8 },
      { caseCount: 10, overallFieldGainsPerCase: 7, criticalFieldGainCases: 9 },
      { caseCount: 10, overallFieldGainsPerCase: 8, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 9, criticalFieldGainCases: 9 },
      { caseCount: 10, overallFieldGainsPerCase: 7, criticalFieldGainCases: 8 },
      { caseCount: 10, overallFieldGainsPerCase: 8, criticalFieldGainCases: 9 },
      { caseCount: 10, overallFieldGainsPerCase: 9, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 8, criticalFieldGainCases: 9 },
    ],
    referenceMinimumBrandClusters: 2,
    minimumBrandClusterTolerance: 0,
    referencePowerByBrandCount: {
      2: { overall: 1, critical: 1 },
    },
    powerAbsoluteTolerance: 0.03,
  },
  {
    name: "uneven low-variance brands with gains close to both margins",
    nearMargin: true,
    brands: [
      { caseCount: 10, overallFieldGainsPerCase: 5, criticalFieldGainCases: 6 },
      { caseCount: 10, overallFieldGainsPerCase: 6, criticalFieldGainCases: 7 },
      { caseCount: 10, overallFieldGainsPerCase: 6, criticalFieldGainCases: 7 },
      { caseCount: 10, overallFieldGainsPerCase: 7, criticalFieldGainCases: 8 },
      { caseCount: 10, overallFieldGainsPerCase: 6, criticalFieldGainCases: 7 },
      { caseCount: 10, overallFieldGainsPerCase: 7, criticalFieldGainCases: 8 },
      { caseCount: 10, overallFieldGainsPerCase: 5, criticalFieldGainCases: 7 },
      { caseCount: 10, overallFieldGainsPerCase: 6, criticalFieldGainCases: 7 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 12 },
      { caseCount: 20, overallFieldGainsPerCase: 6, criticalFieldGainCases: 14 },
      { caseCount: 20, overallFieldGainsPerCase: 6, criticalFieldGainCases: 13 },
      { caseCount: 20, overallFieldGainsPerCase: 7, criticalFieldGainCases: 15 },
      { caseCount: 20, overallFieldGainsPerCase: 6, criticalFieldGainCases: 14 },
      { caseCount: 20, overallFieldGainsPerCase: 7, criticalFieldGainCases: 15 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 13 },
      { caseCount: 20, overallFieldGainsPerCase: 6, criticalFieldGainCases: 14 },
    ],
    referenceMinimumBrandClusters: 4,
    minimumBrandClusterTolerance: 1,
    referencePowerByBrandCount: {
      3: { overall: 0.68549, critical: 0.842909 },
      4: { overall: 0.818911, critical: 0.948178 },
      5: { overall: 0.907079, critical: 0.985595 },
    },
    powerAbsoluteTolerance: 0.03,
  },
  {
    name: "balanced high-variance brands with both gains close to their margins",
    nearMargin: true,
    brands: [
      { caseCount: 10, overallFieldGainsPerCase: 1, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 12, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 2, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 11, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 3, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 10, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 1, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 12, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 2, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 11, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 3, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 10, criticalFieldGainCases: 10 },
      { caseCount: 10, overallFieldGainsPerCase: 1, criticalFieldGainCases: 0 },
      { caseCount: 10, overallFieldGainsPerCase: 12, criticalFieldGainCases: 0 },
      { caseCount: 10, overallFieldGainsPerCase: 2, criticalFieldGainCases: 2 },
      { caseCount: 10, overallFieldGainsPerCase: 11, criticalFieldGainCases: 2 },
      { caseCount: 10, overallFieldGainsPerCase: 3, criticalFieldGainCases: 3 },
      { caseCount: 10, overallFieldGainsPerCase: 10, criticalFieldGainCases: 3 },
      { caseCount: 10, overallFieldGainsPerCase: 1, criticalFieldGainCases: 5 },
      { caseCount: 10, overallFieldGainsPerCase: 12, criticalFieldGainCases: 5 },
    ],
    referenceMinimumBrandClusters: 99,
    minimumBrandClusterTolerance: 3,
    referencePowerByBrandCount: {
      96: { overall: 0.934344, critical: 0.80359 },
      97: { overall: 0.936478, critical: 0.807214 },
      98: { overall: 0.938455, critical: 0.810958 },
      99: { overall: 0.940603, critical: 0.814192 },
      100: { overall: 0.942351, critical: 0.817034 },
      101: { overall: 0.944454, critical: 0.820333 },
      102: { overall: 0.946149, critical: 0.823415 },
    },
    powerAbsoluteTolerance: 0.03,
  },
  {
    name: "uneven high-variance brands with gains close to both margins",
    nearMargin: true,
    brands: [
      { caseCount: 5, overallFieldGainsPerCase: 12, criticalFieldGainCases: 4 },
      { caseCount: 5, overallFieldGainsPerCase: 11, criticalFieldGainCases: 5 },
      { caseCount: 5, overallFieldGainsPerCase: 12, criticalFieldGainCases: 3 },
      { caseCount: 5, overallFieldGainsPerCase: 11, criticalFieldGainCases: 4 },
      { caseCount: 5, overallFieldGainsPerCase: 12, criticalFieldGainCases: 5 },
      { caseCount: 5, overallFieldGainsPerCase: 11, criticalFieldGainCases: 3 },
      { caseCount: 5, overallFieldGainsPerCase: 12, criticalFieldGainCases: 4 },
      { caseCount: 5, overallFieldGainsPerCase: 11, criticalFieldGainCases: 5 },
      { caseCount: 5, overallFieldGainsPerCase: 12, criticalFieldGainCases: 3 },
      { caseCount: 5, overallFieldGainsPerCase: 11, criticalFieldGainCases: 4 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 14 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 15 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 13 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 14 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 15 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 13 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 14 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 15 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 13 },
      { caseCount: 20, overallFieldGainsPerCase: 5, criticalFieldGainCases: 14 },
    ],
    referenceMinimumBrandClusters: 10,
    minimumBrandClusterTolerance: 1,
    referencePowerByBrandCount: {
      9: { overall: 0.746016, critical: 0.999988 },
      10: { overall: 0.828271, critical: 0.999996 },
      11: { overall: 0.886587, critical: 1 },
    },
    powerAbsoluteTolerance: 0.03,
  },
];

describe("conditional QLoRA pre-holdout power analysis", () => {
  it("calculates a reproducible, metadata-only minimum brand sample from paired development evidence", () => {
    const input = qloraDevelopmentPowerInput();
    const result = calculateQloraPromotionPower(input);

    expect(result).toMatchObject({
      state: "qualified",
      developmentEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      method: QLORA_PROMOTION_POWER_METHOD,
      seed: 20261002,
      confidenceLevel: 0.95,
      minimumPower: 0.8,
      overallTargetMarginPercentagePoints: 5,
      criticalTargetMarginPercentagePoints: 3,
      plannedBrandClusters: expect.any(Number),
      overallPower: expect.any(Number),
      criticalPower: expect.any(Number),
      simulationReplicates: 5000,
    });
    if (result.state !== "qualified") throw new Error("expected qualified power analysis");
    expect(result.plannedBrandClusters).toBe(2);
    expect(result.overallPower).toBeGreaterThanOrEqual(0.8);
    expect(result.criticalPower).toBeGreaterThanOrEqual(0.8);
    expect(JSON.stringify(result)).not.toContain("case-0");
    expect(JSON.stringify(result)).not.toContain("brand-0");
    expect(JSON.stringify(calculateQloraPromotionPower(input))).toBe(JSON.stringify(result));
  });

  it("returns insufficient power when a development gain does not clear its target", () => {
    const input = qloraDevelopmentPowerInput(
      qloraRows(12, { candidate: 85, promptedBase: 80, gemini: 92 }),
    );
    const result = calculateQloraPromotionPower(input);

    expect(result).toMatchObject({
      state: "insufficient",
      developmentEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      method: QLORA_PROMOTION_POWER_METHOD,
      maximumEvaluatedBrandClusters: 1000,
    });
    if (result.state !== "insufficient") throw new Error("expected insufficient power");
    expect(result.reason).toMatch(/did not reach 80%/);
    expect(result.overallPower).toBeLessThan(0.8);
  });

  it.each(qloraPowerReferenceVectors)(
    "matches the independent offline statistical reference for $name",
    (vector) => {
      const input = qloraPowerReferenceInput(vector.brands);
      const result = calculateQloraPromotionPower(input);

      expect(result.state).toBe("qualified");
      if (result.state !== "qualified") throw new Error("expected qualified power analysis");
      const expectedCaseCount = vector.brands.reduce((sum, brand) => sum + brand.caseCount, 0);
      expect(result.developmentCaseCount).toBe(expectedCaseCount);
      expect(result.developmentBrandClusterCount).toBe(vector.brands.length);
      expect(
        Math.abs(result.plannedBrandClusters - vector.referenceMinimumBrandClusters),
      ).toBeLessThanOrEqual(vector.minimumBrandClusterTolerance);

      const referencePower = vector.referencePowerByBrandCount[result.plannedBrandClusters];
      expect(referencePower).toBeDefined();
      expect(Math.abs(result.overallPower - referencePower.overall))
        .toBeLessThanOrEqual(vector.powerAbsoluteTolerance);
      expect(Math.abs(result.criticalPower - referencePower.critical))
        .toBeLessThanOrEqual(vector.powerAbsoluteTolerance);
    },
  );

  for (const vector of qloraPowerReferenceVectors.filter((candidate) => candidate.nearMargin)) {
    it.each(qloraPowerReferenceAdditionalSeeds)(
      `matches the independent reference tolerances for ${vector.name} (seed $seed)`,
      (seed) => {
        const result = calculateQloraPromotionPower(qloraPowerReferenceInput(vector.brands, seed));

        expect(result.state).toBe("qualified");
        if (result.state !== "qualified") throw new Error("expected qualified power analysis");
        expect(result.seed).toBe(seed);
        expect(
          Math.abs(result.plannedBrandClusters - vector.referenceMinimumBrandClusters),
        ).toBeLessThanOrEqual(vector.minimumBrandClusterTolerance);

        const referencePower = vector.referencePowerByBrandCount[result.plannedBrandClusters];
        expect(referencePower).toBeDefined();
        expect(Math.abs(result.overallPower - referencePower.overall))
          .toBeLessThanOrEqual(vector.powerAbsoluteTolerance);
        expect(Math.abs(result.criticalPower - referencePower.critical))
          .toBeLessThanOrEqual(vector.powerAbsoluteTolerance);
      },
    );
  }

  it("fails closed for missing, holdout-scoped, and malformed development evidence", () => {
    expect(calculateQloraPromotionPower(undefined)).toMatchObject({
      state: "unavailable",
      reason: expect.stringMatching(/missing or malformed/),
    });
    expect(calculateQloraPromotionPower({
      ...qloraDevelopmentPowerInput(),
      evidenceScope: "holdout",
    })).toMatchObject({
      state: "unavailable",
      reason: expect.stringMatching(/development-only/),
    });

    const malformed = qloraDevelopmentPowerInput();
    malformed.results.promptedBase = malformed.results.promptedBase.slice(1);
    expect(calculateQloraPromotionPower(malformed)).toMatchObject({
      state: "unavailable",
      reason: expect.stringMatching(/same development cases/),
    });
  });

  it("keeps the evidence digest and calculated power invariant to input row ordering", () => {
    const input = qloraDevelopmentPowerInput();
    const baseline = calculateQloraPromotionPower(input);
    fc.assert(
      fc.property(
        fc.shuffledSubarray(input.results.candidate, {
          minLength: input.results.candidate.length,
          maxLength: input.results.candidate.length,
        }),
        (candidate) => {
          const permuted = calculateQloraPromotionPower({
            ...input,
            results: { ...input.results, candidate },
          });
          expect(permuted).toEqual(baseline);
        },
      ),
      { numRuns: 8 },
    );
  });

  it("is reproducible for generated unsigned seeds", () => {
    const base = qloraDevelopmentPowerInput();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffff_ffff }), (seed) => {
        const input = { ...base, seed };
        expect(calculateQloraPromotionPower(input)).toEqual(
          calculateQloraPromotionPower(input),
        );
      }),
      { numRuns: 12 },
    );
  });
});

describe("conditional QLoRA promotion evaluator", () => {
  it("accepts the metadata-only result of the development power preflight", () => {
    const powerAnalysis = calculateQloraPromotionPower(qloraDevelopmentPowerInput());
    if (powerAnalysis.state !== "qualified") {
      throw new Error("expected synthetic development evidence to qualify");
    }
    const input = qloraInput();
    input.powerAnalysis = powerAnalysis;

    expect(evaluateConditionalQloraPromotion(input).decision).toBe("promotion-recommended");
  });

  it("recommends only when both brand-clustered lower bounds and all safety gates pass", () => {
    const result = evaluateConditionalQloraPromotion(qloraInput());

    expect(result.decision).toBe("promotion-recommended");
    expect(result.gains?.overall.lowerBoundPercentagePoints).toBeGreaterThan(5);
    expect(result.gains?.critical.lowerBoundPercentagePoints).toBeGreaterThan(3);
    expect(result.safetyGates).toMatchObject({
      schemaValidity: true,
      criticalFieldAgreement: true,
      overallFieldAgreement: true,
      zeroBlankPoisonCases: true,
      emptyOutputRate: true,
      noSystematicMissingRequiredFields: true,
    });
    expect(result.bootstrap).toMatchObject({
      method: "seeded-brand-cluster-percentile",
      seed: 20261002,
    });
    expect(result.caseCount).toBe(12);
    expect(result.brandClusterCount).toBe(12);
    expect(result.manifest).toMatchObject({
      format: "qlora-promotion-result-manifest",
      formatVersion: 1,
      privacy: {
        mode: "metadata-only",
        rawProviderPayloadsRetained: false,
        retainedEvaluationContent: "none",
      },
      identities: qloraIdentity(12),
      powerAnalysis: qloraInput().powerAnalysis,
      decision: "promotion-recommended",
      reasonCodes: ["ALL_PROMOTION_GATES_PASSED"],
      bootstrap: {
        method: "seeded-brand-cluster-percentile",
        confidenceLevel: 0.95,
        replicates: 10_000,
        seed: 20261002,
      },
      caseCount: 12,
      brandClusterCount: 12,
      agreements: result.agreements,
      gains: result.gains,
      safetyGates: result.safetyGates,
    });
    expect(result.manifest?.reasons).toEqual(result.reasons);
    expect(JSON.stringify(result.manifest)).not.toContain("case-0");
    expect(JSON.stringify(result.manifest)).not.toContain("field-0");
    expect(JSON.stringify(result.manifest)).not.toContain("fieldCorrectness");
    expect(validateQloraPromotionResultManifest(result.manifest, {
      identities: qloraInput().identities,
      powerAnalysis: qloraInput().powerAnalysis,
      bootstrapSeed: qloraInput().bootstrapSeed,
    })).toEqual(result.manifest);
    expect(validateQloraPromotionResultManifest(
      JSON.parse(JSON.stringify(result.manifest)) as unknown,
      qloraInput(),
    )).toEqual(result.manifest);
  });

  it("returns no-go when any non-compensatory safety gate fails", () => {
    const results = qloraRows(12, { candidate: 90, promptedBase: 80, gemini: 92 });
    results.candidate[0] = qloraRow(
      "case-0",
      "brand-0",
      promotionFields.slice(0, 90),
      { blankPoison: true },
    );

    const result = evaluateConditionalQloraPromotion(qloraInput(results));

    expect(result.decision).toBe("no-go");
    expect(result.safetyGates?.zeroBlankPoisonCases).toBe(false);
    expect(result.reasonCodes).toContain("SAFETY_GATE_FAILED");
    expect(result.manifest?.decision).toBe("no-go");
    expect(result.manifest?.reasonCodes).toEqual(result.reasonCodes);
  });

  it("rejects missing, changed, or unexpected manifest identity data", () => {
    const input = qloraInput();
    const result = evaluateConditionalQloraPromotion(input);
    const resultManifest = result.manifest!;
    const changedIdentities = qloraIdentity(12);
    changedIdentities.candidate.tokenizerSha256 = "9".repeat(64);

    expect(() => validateQloraPromotionResultManifest(
      { ...resultManifest, identities: undefined },
      input,
    )).toThrow(/identities are invalid/);
    expect(() => validateQloraPromotionResultManifest(
      {
        ...resultManifest,
        identities: {
          ...resultManifest.identities,
          candidate: { ...resultManifest.identities.candidate, tokenizerSha256: "9".repeat(64) },
        },
      },
      input,
    )).toThrow(/identities do not match/);
    expect(() => validateQloraPromotionResultManifest(
      resultManifest,
      { ...input, identities: changedIdentities },
    )).toThrow(/identities do not match/);
    expect(() => validateQloraPromotionResultManifest(
      { ...resultManifest, caseResults: input.results },
      input,
    )).toThrow(/unsupported metadata fields/);
    expect(() => validateQloraPromotionResultManifest(
      resultManifest,
      {
        ...input,
        powerAnalysis: {
          ...input.powerAnalysis,
          developmentEvidenceSha256: "9".repeat(64),
        },
      },
    )).toThrow(/power analysis does not match/);
    expect(() => validateQloraPromotionResultManifest(
      { ...resultManifest, bootstrap: { ...resultManifest.bootstrap, seed: 20261003 } },
      input,
    )).toThrow(/bootstrap seed does not match/);
  });

  it("retains a metadata-only manifest for paired-evidence failures but none for unbound inputs", () => {
    const unmatched = qloraInput();
    unmatched.results.gemini[0] = {
      ...unmatched.results.gemini[0],
      caseId: "private-case-identifier",
    };
    const invalidPairs = evaluateConditionalQloraPromotion(unmatched);
    expect(invalidPairs).toMatchObject({
      decision: "inconclusive",
      reasonCodes: ["PAIRED_EVIDENCE_INVALID"],
      manifest: {
        decision: "inconclusive",
        agreements: null,
        gains: null,
        safetyGates: null,
      },
    });
    expect(JSON.stringify(invalidPairs.manifest)).not.toContain("private-case-identifier");

    const unavailable = qloraInput();
    unavailable.identities = {
      state: "unavailable",
      reason: "candidate model digest was not retained",
    };
    expect(evaluateConditionalQloraPromotion(unavailable).manifest).toBeNull();

    const undersampled = qloraInput();
    undersampled.powerAnalysis = {
      ...undersampled.powerAnalysis,
      plannedBrandClusters: 13,
    };
    expect(evaluateConditionalQloraPromotion(undersampled)).toMatchObject({
      decision: "inconclusive",
      reasonCodes: ["POWER_ANALYSIS_CLUSTER_COUNT_NOT_MET"],
      caseCount: 12,
      brandClusterCount: 12,
      manifest: {
        caseCount: 12,
        brandClusterCount: 12,
        agreements: null,
        gains: null,
        safetyGates: null,
      },
    });
  });

  it("enforces each independent Gemini safety gate without compensation", () => {
    type GateName = Exclude<keyof QloraPromotionSafetyGates, "criticalFieldHardFailure">;
    const removeCorrectFields = (row: QloraPromotionCaseResult, fields: string[]) => ({
      ...row,
      fieldCorrectness: Object.fromEntries(
        Object.entries(row.fieldCorrectness).filter(([field]) => !fields.includes(field)),
      ),
    });
    const scenarios: { gate: GateName; change: (input: QloraPromotionInput) => void }[] = [
      {
        gate: "schemaValidity",
        change: (input) => { input.results.candidate[0].schemaValid = false; },
      },
      {
        gate: "criticalFieldAgreement",
        change: (input) => {
          input.results.candidate = input.results.candidate.map((row) =>
            removeCorrectFields(row, [promotionCriticalFields[0]]),
          );
        },
      },
      {
        gate: "overallFieldAgreement",
        change: (input) => {
          input.results.candidate = input.results.candidate.map((row) =>
            removeCorrectFields(row, promotionFields.slice(10, 14)),
          );
        },
      },
      {
        gate: "zeroBlankPoisonCases",
        change: (input) => { input.results.candidate[0].blankPoison = true; },
      },
      {
        gate: "emptyOutputRate",
        change: (input) => { input.results.candidate[0].emptyOutput = true; },
      },
      {
        gate: "noSystematicMissingRequiredFields",
        change: (input) => { input.results.candidate[0].systematicMissingRequiredFields = true; },
      },
    ];

    for (const scenario of scenarios) {
      const input = qloraInput();
      scenario.change(input);
      const result = evaluateConditionalQloraPromotion(input);

      expect(result.decision, scenario.gate).toBe("no-go");
      expect(result.safetyGates?.[scenario.gate], scenario.gate).toBe(false);
      expect(result.reasonCodes).toContain("SAFETY_GATE_FAILED");
    }
  });

  it("never promotes tied candidate and prompted-base scores", () => {
    const result = evaluateConditionalQloraPromotion(qloraInput(
      qloraRows(12, { candidate: 90, promptedBase: 90, gemini: 92 }),
    ));

    expect(result.decision).toBe("no-go");
    expect(result.gains?.overall.estimatePercentagePoints).toBe(0);
    expect(result.gains?.critical.estimatePercentagePoints).toBe(0);
  });

  it("returns inconclusive when confidence bounds cross a required gain margin", () => {
    const runs = {
      candidate: [] as QloraPromotionCaseResult[],
      promptedBase: [] as QloraPromotionCaseResult[],
      gemini: [] as QloraPromotionCaseResult[],
    };
    for (let index = 0; index < 10; index += 1) {
      const candidateCount = index < 5 ? 100 : 70;
      const baseCount = index < 5 ? 70 : 85;
      const candidate = qloraRow(
        `case-${index}`,
        `brand-${index}`,
        promotionFields.slice(0, candidateCount),
        { criticalFields: promotionFields },
      );
      const promptedBase = qloraRow(
        `case-${index}`,
        `brand-${index}`,
        promotionFields.slice(0, baseCount),
        { criticalFields: promotionFields },
      );
      runs.candidate.push(candidate);
      runs.promptedBase.push(promptedBase);
      runs.gemini.push(candidate);
    }
    const input = qloraInput(runs);
    input.powerAnalysis = {
      state: "qualified",
      developmentEvidenceSha256: "f".repeat(64),
      method: QLORA_PROMOTION_POWER_METHOD,
      seed: 20261002,
      confidenceLevel: 0.95,
      minimumPower: 0.8,
      overallTargetMarginPercentagePoints: 5,
      criticalTargetMarginPercentagePoints: 3,
      developmentCaseCount: 10,
      developmentBrandClusterCount: 10,
      simulationReplicates: 5000,
      plannedBrandClusters: 10,
      overallPower: 0.85,
      criticalPower: 0.84,
    };

    const result = evaluateConditionalQloraPromotion(input);

    expect(result.decision).toBe("inconclusive");
    expect(result.gains?.overall.estimatePercentagePoints).toBeGreaterThan(5);
    expect(result.gains?.overall.lowerBoundPercentagePoints).toBeLessThanOrEqual(5);
    expect(result.gains?.overall.upperBoundPercentagePoints).toBeGreaterThan(5);
    expect(result.reasonCodes).toContain("REQUIRED_GAIN_NOT_ESTABLISHED");
  });

  it("keeps insufficient power and unavailable identities inconclusive", () => {
    const underpowered = qloraInput();
    underpowered.powerAnalysis = { state: "insufficient", reason: "development-only power was below 80%" };
    expect(evaluateConditionalQloraPromotion(underpowered)).toMatchObject({
      decision: "inconclusive",
      reasonCodes: ["POWER_ANALYSIS_INSUFFICIENT"],
      agreements: null,
    });

    const wrongPowerTarget = qloraInput();
    wrongPowerTarget.powerAnalysis = {
      ...wrongPowerTarget.powerAnalysis,
      overallTargetMarginPercentagePoints: 4,
    };
    expect(evaluateConditionalQloraPromotion(wrongPowerTarget)).toMatchObject({
      decision: "inconclusive",
      reasonCodes: ["POWER_ANALYSIS_INSUFFICIENT"],
      gains: null,
    });

    const unavailable = qloraInput();
    unavailable.identities = { state: "unavailable", reason: "candidate model digest was not retained" };
    expect(evaluateConditionalQloraPromotion(unavailable)).toMatchObject({
      decision: "inconclusive",
      reasonCodes: ["IDENTITIES_UNAVAILABLE"],
      gains: null,
    });
  });

  it("macro-averages field agreement within each case before averaging cases", () => {
    const fields = ["critical"];
    const results = {
      candidate: [
        qloraRow("small", "brand-a", fields, { eligibleFields: fields, criticalFields: fields }),
        qloraRow("large", "brand-b", [], { eligibleFields: promotionFields, criticalFields: [promotionFields[0]] }),
      ],
      promptedBase: [
        qloraRow("small", "brand-a", [], { eligibleFields: fields, criticalFields: fields }),
        qloraRow("large", "brand-b", [], { eligibleFields: promotionFields, criticalFields: [promotionFields[0]] }),
      ],
      gemini: [
        qloraRow("small", "brand-a", fields, { eligibleFields: fields, criticalFields: fields }),
        qloraRow("large", "brand-b", [], { eligibleFields: promotionFields, criticalFields: [promotionFields[0]] }),
      ],
    };
    const input = qloraInput(results);
    input.identities = qloraIdentity(2);
    input.powerAnalysis = {
      state: "qualified",
      developmentEvidenceSha256: "f".repeat(64),
      method: QLORA_PROMOTION_POWER_METHOD,
      seed: 20261002,
      confidenceLevel: 0.95,
      minimumPower: 0.8,
      overallTargetMarginPercentagePoints: 5,
      criticalTargetMarginPercentagePoints: 3,
      developmentCaseCount: 2,
      developmentBrandClusterCount: 2,
      simulationReplicates: 5000,
      plannedBrandClusters: 2,
      overallPower: 0.8,
      criticalPower: 0.8,
    };

    const result = evaluateConditionalQloraPromotion(input);

    expect(result.agreements?.candidate.overall).toBe(0.5);
    expect(result.agreements?.promptedBase.overall).toBe(0);
  });

  it("scores omitted eligible field results as incorrect and requires exact paired cases", () => {
    const results = qloraRows(12, { candidate: 90, promptedBase: 80, gemini: 92 });
    results.candidate[0] = {
      ...results.candidate[0],
      fieldCorrectness: Object.fromEntries(promotionFields.slice(0, 89).map((field) => [field, true])),
    };
    const scored = evaluateConditionalQloraPromotion(qloraInput(results));
    expect(scored.agreements?.candidate.overall).toBeLessThan(0.9);

    const unmatched = qloraRows(12, { candidate: 90, promptedBase: 80, gemini: 92 });
    unmatched.gemini[0] = { ...unmatched.gemini[0], caseId: "unmatched-case" };
    expect(evaluateConditionalQloraPromotion(qloraInput(unmatched))).toMatchObject({
      decision: "inconclusive",
      reasonCodes: ["PAIRED_EVIDENCE_INVALID"],
      agreements: null,
    });
  });
});

describe("QLoRA result manifest comparison", () => {
  it("reports identical validated manifests as comparable with no changes", () => {
    const input = qloraInput();
    const result = evaluateConditionalQloraPromotion(input);
    const comparisonInput = {
      manifest: result.manifest,
      bindings: input,
    };

    const comparison = compareQloraPromotionResultManifests(
      comparisonInput,
      comparisonInput,
    );

    expect(comparison).toMatchObject({
      format: "qlora-promotion-result-comparison",
      formatVersion: 1,
      compatible: true,
      limitations: [],
      identityChanges: [],
      powerAnalysisChanges: [],
      bootstrapChanges: [],
      aggregateMetricChanges: [],
      safetyGateChanges: [],
      decisionChanges: [],
      summary: "No changes: QLoRA result manifests are identical and comparable.",
    });
  });

  it("marks changed frozen identities as incompatible and still reports the changes", () => {
    const baselineInput = qloraInput();
    const candidateInput = qloraInput();
    candidateInput.identities.candidate.modelSha256 = "9".repeat(64);
    const baseline = evaluateConditionalQloraPromotion(baselineInput);
    const candidate = evaluateConditionalQloraPromotion(candidateInput);

    const comparison = compareQloraPromotionResultManifests(
      { manifest: baseline.manifest, bindings: baselineInput },
      { manifest: candidate.manifest, bindings: candidateInput },
    );

    expect(comparison.compatible).toBe(false);
    expect(comparison.identityChanges.map(({ path }) => path)).toContain(
      "identities.candidate.modelSha256",
    );
    expect(comparison.limitations).toContain(
      "frozen QLoRA identities differ; aggregate metrics are not directly comparable",
    );
    expect(comparison.summary).toContain("not directly comparable");
    expect(() => compareQloraPromotionResultManifests(
      { manifest: baseline.manifest, bindings: baselineInput },
      {
        manifest: {
          ...candidate.manifest,
          identities: baseline.manifest?.identities,
        },
        bindings: candidateInput,
      },
    )).toThrow(/identities do not match/);
  });

  it("reports changed aggregate metrics separately when the frozen contract matches", () => {
    const baselineInput = qloraInput();
    const candidateInput = qloraInput(qloraRows(12, {
      candidate: 95,
      promptedBase: 80,
      gemini: 92,
    }));
    const baseline = evaluateConditionalQloraPromotion(baselineInput);
    const candidate = evaluateConditionalQloraPromotion(candidateInput);

    const comparison = compareQloraPromotionResultManifests(
      { manifest: baseline.manifest, bindings: baselineInput },
      { manifest: candidate.manifest, bindings: candidateInput },
    );

    expect(comparison.compatible).toBe(true);
    expect(comparison.identityChanges).toEqual([]);
    expect(comparison.powerAnalysisChanges).toEqual([]);
    expect(comparison.bootstrapChanges).toEqual([]);
    expect(comparison.aggregateMetricChanges.map(({ path }) => path)).toContain(
      "gains.overall.estimatePercentagePoints",
    );
    expect(comparison.safetyGateChanges).toEqual([]);
    expect(comparison.decisionChanges).toEqual([]);
  });

  it("separates power, bootstrap, safety-gate, and decision changes", () => {
    const baselineInput = qloraInput();
    const changedPowerInput = qloraInput();
    changedPowerInput.powerAnalysis.developmentEvidenceSha256 = "0".repeat(64);
    const changedBootstrapInput = qloraInput();
    changedBootstrapInput.bootstrapSeed += 1;
    const failedGateResults = qloraRows(12, {
      candidate: 90,
      promptedBase: 80,
      gemini: 92,
    });
    failedGateResults.candidate[0] = qloraRow(
      "case-0",
      "brand-0",
      promotionFields.slice(0, 90),
      { blankPoison: true },
    );
    const changedGateInput = qloraInput(failedGateResults);
    const baseline = evaluateConditionalQloraPromotion(baselineInput);
    const changedPower = evaluateConditionalQloraPromotion(changedPowerInput);
    const changedBootstrap = evaluateConditionalQloraPromotion(changedBootstrapInput);
    const changedGate = evaluateConditionalQloraPromotion(changedGateInput);

    const powerComparison = compareQloraPromotionResultManifests(
      { manifest: baseline.manifest, bindings: baselineInput },
      { manifest: changedPower.manifest, bindings: changedPowerInput },
    );
    const bootstrapComparison = compareQloraPromotionResultManifests(
      { manifest: baseline.manifest, bindings: baselineInput },
      { manifest: changedBootstrap.manifest, bindings: changedBootstrapInput },
    );
    const gateComparison = compareQloraPromotionResultManifests(
      { manifest: baseline.manifest, bindings: baselineInput },
      { manifest: changedGate.manifest, bindings: changedGateInput },
    );

    expect(powerComparison.compatible).toBe(false);
    expect(powerComparison.powerAnalysisChanges.map(({ path }) => path)).toContain(
      "powerAnalysis.developmentEvidenceSha256",
    );
    expect(bootstrapComparison.compatible).toBe(false);
    expect(bootstrapComparison.bootstrapChanges.map(({ path }) => path)).toContain(
      "bootstrap.seed",
    );
    expect(gateComparison.safetyGateChanges.map(({ path }) => path)).toContain(
      "safetyGates.zeroBlankPoisonCases",
    );
    expect(gateComparison.decisionChanges.map(({ path }) => path)).toContain(
      "decision",
    );
  });
});
