import { describe, expect, it } from "vitest";
import {
  compareEvaluationManifests,
  evaluateConditionalQloraPromotion,
  readEvaluationManifest,
  validateEvaluationManifest,
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
      confidenceLevel: 0.95,
      overallTargetMarginPercentagePoints: 5,
      criticalTargetMarginPercentagePoints: 3,
      plannedBrandClusters: 10,
      overallPower: 0.85,
      criticalPower: 0.84,
    },
    bootstrapSeed: 20261002,
    results,
  };
}

describe("conditional QLoRA promotion evaluator", () => {
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
      confidenceLevel: 0.95,
      overallTargetMarginPercentagePoints: 5,
      criticalTargetMarginPercentagePoints: 3,
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
      confidenceLevel: 0.95,
      overallTargetMarginPercentagePoints: 5,
      criticalTargetMarginPercentagePoints: 3,
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