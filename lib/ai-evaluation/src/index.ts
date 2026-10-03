import { createHash } from "node:crypto";

export const EVALUATION_MANIFEST_VERSION = 1 as const;

export type EvaluationState = "passed" | "failed" | "unavailable";
export type Measurement =
  | { state: "measured"; value: number; unit: string }
  | { state: "unavailable"; reason: string };

export type EvaluationManifest = {
  manifestVersion: typeof EVALUATION_MANIFEST_VERSION;
  evaluation: { id: string; kind: "deterministic" | "provider-backed" };
  corpus: { sha256: string; cases: number; sourceAuthority: string };
  thresholds: Record<string, number>;
  dependencies: Record<string, string>;
  provider:
    | { identityState: "not-applicable"; name: null; model: null }
    | { identityState: "identified"; name: string; model: string }
    | { identityState: "unavailable"; name: null; model: null; reason: string };
  performance: {
    inputTokens: Measurement;
    outputTokens: Measurement;
    cost: Measurement;
    latencyP95: Measurement;
  };
  execution: { retries: number; seed: number | null };
  privacy: {
    mode: "metadata-only" | "synthetic-only" | "content-retained";
    rawProviderPayloadsRetained: false;
    retainedEvaluationContent: "none" | "synthetic" | "queries-and-model-output";
  };
  outcome: { state: EvaluationState; reason: string | null };
  provenance: {
    sourceSha256: string;
    evidence:
      | { state: "hashed"; sha256: string }
      | { state: "unavailable"; reason: string };
    evidenceType: string;
    evaluator:
      | { state: "hashed"; sha256: string }
      | { state: "unavailable"; reason: string };
  };
};

export type EvaluationSourceIdentity = EvaluationManifest["corpus"];


export type EvaluationManifestChange = {
  path: string;
  before: unknown;
  after: unknown;
};

export type EvaluationManifestComparison = {
  format: "evaluation-manifest-comparison";
  formatVersion: 1;
  compatible: true;
  limitations: string[];
  identityChanges: EvaluationManifestChange[];
  metricChanges: EvaluationManifestChange[];
  outcomeChanges: EvaluationManifestChange[];
  summary: string;
};

type LegacyReport = Record<string, unknown>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function finite(value: unknown, label: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function measurement(value: unknown, label: string): Measurement {
  const item = record(value, label);
  if (item.state === "measured") {
    const measuredValue = finite(item.value, `${label}.value`) as number;
    if (measuredValue < 0) throw new Error(`${label}.value must be non-negative`);
    return {
      state: "measured",
      value: measuredValue,
      unit: string(item.unit, `${label}.unit`) as string,
    };
  }
  if (item.state === "unavailable") {
    return {
      state: "unavailable",
      reason: string(item.reason, `${label}.reason`) as string,
    };
  }
  throw new Error(`${label}.state must be measured or unavailable`);
}

export function validateEvaluationManifest(value: unknown): EvaluationManifest {
  const root = record(value, "manifest");
  if (root.manifestVersion !== EVALUATION_MANIFEST_VERSION) throw new Error("unsupported evaluation manifest version");
  const evaluation = record(root.evaluation, "evaluation");
  if (evaluation.kind !== "deterministic" && evaluation.kind !== "provider-backed") {
    throw new Error("evaluation.kind must be deterministic or provider-backed");
  }
  const corpus = record(root.corpus, "corpus");
  const sha256 = string(corpus.sha256, "corpus.sha256") as string;
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("corpus.sha256 must be a lowercase SHA-256 digest");
  const thresholds = record(root.thresholds, "thresholds");
  const dependencies = record(root.dependencies, "dependencies");
  const provider = record(root.provider, "provider");
  const performance = record(root.performance, "performance");
  const execution = record(root.execution, "execution");
  const privacy = record(root.privacy, "privacy");
  const outcome = record(root.outcome, "outcome");
  const provenance = record(root.provenance, "provenance");
  if (!["passed", "failed", "unavailable"].includes(String(outcome.state))) {
    throw new Error("outcome.state must be passed, failed, or unavailable");
  }
  if (outcome.state !== "passed" && (typeof outcome.reason !== "string" || outcome.reason.length === 0)) {
    throw new Error("failed and unavailable outcomes require a reason");
  }
  if (
    !["metadata-only", "synthetic-only", "content-retained"].includes(String(privacy.mode))
    || privacy.rawProviderPayloadsRetained !== false
    || !["none", "synthetic", "queries-and-model-output"].includes(String(privacy.retainedEvaluationContent))
  ) {
    throw new Error("privacy must use an allowed mode and retain no raw payloads");
  }
  if (
    (privacy.mode === "metadata-only" && privacy.retainedEvaluationContent !== "none")
    || (privacy.mode === "synthetic-only" && privacy.retainedEvaluationContent !== "synthetic")
    || (privacy.mode === "content-retained" && privacy.retainedEvaluationContent !== "queries-and-model-output")
  ) {
    throw new Error("privacy mode must match retained evaluation content");
  }
  const retries = finite(execution.retries, "execution.retries") as number;
  if (!Number.isInteger(retries) || retries < 0) throw new Error("execution.retries must be a non-negative integer");
  const cases = finite(corpus.cases, "corpus.cases") as number;
  if (!Number.isInteger(cases) || cases < 0) throw new Error("corpus.cases must be a non-negative integer");
  const sourceSha256 = string(provenance.sourceSha256, "provenance.sourceSha256") as string;
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error("provenance.sourceSha256 must be a lowercase SHA-256 digest");
  if (sourceSha256 !== sha256) throw new Error("provenance source must match corpus hash");
  const evidence = record(provenance.evidence, "provenance.evidence");
  let validatedEvidence: EvaluationManifest["provenance"]["evidence"];
  if (evidence.state === "hashed") {
    const evidenceSha256 = string(evidence.sha256, "provenance.evidence.sha256") as string;
    if (!/^[a-f0-9]{64}$/.test(evidenceSha256)) throw new Error("evidence sha256 must be a lowercase SHA-256 digest");
    validatedEvidence = { state: "hashed", sha256: evidenceSha256 };
  } else if (evidence.state === "unavailable") {
    validatedEvidence = {
      state: "unavailable",
      reason: string(evidence.reason, "provenance.evidence.reason") as string,
    };
  } else {
    throw new Error("provenance.evidence.state must be hashed or unavailable");
  }
  const evaluator = record(provenance.evaluator, "provenance.evaluator");
  let validatedEvaluator: EvaluationManifest["provenance"]["evaluator"];
  if (evaluator.state === "hashed") {
    const evaluatorSha256 = string(evaluator.sha256, "provenance.evaluator.sha256") as string;
    if (!/^[a-f0-9]{64}$/.test(evaluatorSha256)) throw new Error("evaluator sha256 must be a lowercase SHA-256 digest");
    validatedEvaluator = { state: "hashed", sha256: evaluatorSha256 };
  } else if (evaluator.state === "unavailable") {
    validatedEvaluator = {
      state: "unavailable",
      reason: string(evaluator.reason, "provenance.evaluator.reason") as string,
    };
  } else {
    throw new Error("provenance.evaluator.state must be hashed or unavailable");
  }
  let validatedProvider: EvaluationManifest["provider"];
  if (evaluation.kind === "deterministic") {
    if (provider.identityState !== "not-applicable" || provider.name !== null || provider.model !== null) {
      throw new Error("deterministic evaluations must use a not-applicable provider identity");
    }
    validatedProvider = { identityState: "not-applicable", name: null, model: null };
  } else if (provider.identityState === "identified") {
    validatedProvider = {
      identityState: "identified",
      name: string(provider.name, "provider.name") as string,
      model: string(provider.model, "provider.model") as string,
    };
  } else if (provider.identityState === "unavailable") {
    if (provider.name !== null || provider.model !== null) throw new Error("unavailable provider identity must not name a provider or model");
    validatedProvider = {
      identityState: "unavailable",
      name: null,
      model: null,
      reason: string(provider.reason, "provider.reason") as string,
    };
  } else {
    throw new Error("provider-backed evaluations require identified or explicitly unavailable identity");
  }

  return {
    manifestVersion: 1,
    evaluation: {
      id: string(evaluation.id, "evaluation.id") as string,
      kind: evaluation.kind,
    },
    corpus: {
      sha256,
      cases,
      sourceAuthority: string(corpus.sourceAuthority, "corpus.sourceAuthority") as string,
    },
    thresholds: Object.fromEntries(Object.entries(thresholds).map(([key, entry]) => [key, finite(entry, `thresholds.${key}`) as number])),
    dependencies: Object.fromEntries(Object.entries(dependencies).map(([key, entry]) => [key, string(entry, `dependencies.${key}`) as string])),
    provider: validatedProvider,
    performance: {
      inputTokens: measurement(performance.inputTokens, "performance.inputTokens"),
      outputTokens: measurement(performance.outputTokens, "performance.outputTokens"),
      cost: measurement(performance.cost, "performance.cost"),
      latencyP95: measurement(performance.latencyP95, "performance.latencyP95"),
    },
    execution: {
      retries,
      seed: finite(execution.seed, "execution.seed", true),
    },
    privacy: {
      mode: privacy.mode as EvaluationManifest["privacy"]["mode"],
      rawProviderPayloadsRetained: false,
      retainedEvaluationContent: privacy.retainedEvaluationContent as EvaluationManifest["privacy"]["retainedEvaluationContent"],
    },
    outcome: {
      state: outcome.state as EvaluationState,
      reason: string(outcome.reason, "outcome.reason", true),
    },
    provenance: {
      sourceSha256,
      evidence: validatedEvidence,
      evidenceType: string(provenance.evidenceType, "provenance.evidenceType") as string,
      evaluator: validatedEvaluator,
    },
  };
}

export function validateComparableEvaluationManifest(
  value: unknown,
  requirements: EvaluationComparabilityRequirements,
): EvaluationManifest {
  const manifest = validateEvaluationManifest(value);
  if (manifest.evaluation.id !== requirements.evaluationId) {
    throw new Error(
      `evaluation identity mismatch: expected ${requirements.evaluationId}, received ${manifest.evaluation.id}`,
    );
  }
  if (manifest.evaluation.kind !== requirements.kind) {
    throw new Error(
      `evaluation kind mismatch: expected ${requirements.kind}, received ${manifest.evaluation.kind}`,
    );
  }
  if (
    manifest.corpus.sha256 !== requirements.source.sha256
    || manifest.corpus.cases !== requirements.source.cases
    || manifest.corpus.sourceAuthority !== requirements.source.sourceAuthority
  ) {
    throw new Error("evaluation source identity does not match the required corpus");
  }
  const sameRecord = (
    actual: Record<string, number | string>,
    expected: Record<string, number | string>,
  ): boolean => {
    const actualEntries = Object.entries(actual).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
  };
  if (!sameRecord(manifest.thresholds, requirements.thresholds)) {
    throw new Error("evaluation thresholds do not match the required contract");
  }
  if (!sameRecord(manifest.dependencies, requirements.dependencies)) {
    throw new Error("evaluation dependencies do not match the required contract");
  }
  if (JSON.stringify(manifest.provider) !== JSON.stringify(requirements.provider)) {
    throw new Error("evaluation provider identity does not match the required contract");
  }
  if (requirements.requirePassedOutcome && manifest.outcome.state !== "passed") {
    throw new Error(
      `evaluation outcome must be passed, received ${manifest.outcome.state}`,
    );
  }
  if (manifest.provenance.evidence.state !== "hashed") {
    throw new Error("required evaluation evidence provenance is unavailable");
  }
  if (
    manifest.provenance.evidence.sha256 !== requirements.evidence.sha256
  ) {
    throw new Error("evaluation evidence identity does not match the required contract");
  }
  if (manifest.provenance.evidenceType !== requirements.evidenceType) {
    throw new Error("evaluation evidence type does not match the required contract");
  }
  if (manifest.provenance.evaluator.state !== "hashed") {
    throw new Error("required evaluator provenance is unavailable");
  }
  if (
    manifest.provenance.evaluator.sha256 !== requirements.evaluator.sha256
  ) {
    throw new Error("evaluation evaluator identity does not match the required contract");
  }
  return manifest;
}

const unavailable = (reason: string): Measurement => ({ state: "unavailable", reason });

export function readEvaluationManifest(
  value: unknown,
  legacySource?: { sourceSha256: string; cases: number; sourceAuthority: string },
): EvaluationManifest {
  const report = record(value, "evaluation report") as LegacyReport;
  if ("manifestVersion" in report) return validateEvaluationManifest(report);
  if ("evaluationManifest" in report) return validateEvaluationManifest(report.evaluationManifest);

  if (report.benchmarkVersion === 1 && typeof report.sourceHash === "string") {
    const corpus = record(report.corpus, "corpus");
    const measured = record(report.measuredEffects, "measuredEffects");
    const retry = record(report.latencyAndRetry, "latencyAndRetry");
    const decision = record(report.decision, "decision");
    const latency = measured.p95LatencyMs;
    return validateEvaluationManifest({
      manifestVersion: 1,
      evaluation: { id: "second-pass-reviewer", kind: "provider-backed" },
      corpus: { sha256: report.sourceHash, cases: corpus.labeledCases, sourceAuthority: corpus.sourceAuthority },
      thresholds: report.acceptanceCriteria,
      dependencies: { legacyReport: "1" },
      provider: {
        identityState: "unavailable",
        name: null,
        model: null,
        reason: "legacy report did not retain provider identity",
      },
      performance: {
        inputTokens: unavailable("legacy report did not retain complete token counts"),
        outputTokens: unavailable("legacy report did not retain complete token counts"),
        cost: unavailable("legacy report did not retain measured cost"),
        latencyP95: latency === null ? unavailable("legacy report did not retain latency") : { state: "measured", value: latency, unit: "ms" },
      },
      execution: { retries: retry.reviewerRetries, seed: null },
      privacy: {
        mode: "metadata-only",
        rawProviderPayloadsRetained: false,
        retainedEvaluationContent: "none",
      },
      outcome: { state: decision.retain === true ? "passed" : "failed", reason: decision.reason },
      provenance: {
        sourceSha256: report.sourceHash,
        evidence: {
          state: "unavailable",
          reason: "legacy report object does not retain its original artifact bytes",
        },
        evidenceType: "legacy-source-reconciliation",
        evaluator: { state: "unavailable", reason: "legacy report did not retain evaluator identity" },
      },
    });
  }
  if (
    report.provider === "gemini"
    && typeof report.model === "string"
    && report.metrics
    && Array.isArray(report.results)
  ) {
    if (!legacySource) {
      throw new Error("legacy Gemini reports require source metadata to preserve corpus binding");
    }
    const results = report.results.map((item, index) => record(item, `results[${index}]`));
    if (results.length > legacySource.cases) {
      throw new Error("legacy Gemini result count exceeds declared corpus cases");
    }
    const statuses = results.map((item) => item.status);
    const allUnavailable = statuses.length > 0 && statuses.every((status) => status === "provider_unavailable");
    const hasFailure = statuses.some((status) =>
      status === "provider_failure" || status === "invalid_output" || status === "provider_unavailable",
    );
    const evaluatedRows = results.filter((item) =>
      item.status === "included" || item.status === "disagreement",
    );
    const evaluated = evaluatedRows.length;
    const correct = evaluatedRows.filter((item) =>
      typeof item.expected === "string" && item.decision === item.expected,
    ).length;
    const accuracy = evaluated === 0 ? null : correct / evaluated;
    const coverage = legacySource.cases === 0 ? 0 : evaluated / legacySource.cases;
    const qualityPassed =
      evaluated >= 1
      && coverage >= 0.8
      && typeof accuracy === "number"
      && accuracy >= 0.8;
    const zeroCaseRun = legacySource.cases === 0 && results.length === 0;
    const state: EvaluationState = zeroCaseRun || allUnavailable
      ? "unavailable"
      : hasFailure || !qualityPassed
        ? "failed"
        : "passed";
    return validateEvaluationManifest({
      manifestVersion: 1,
      evaluation: { id: "gemini-skill-trigger", kind: "provider-backed" },
      corpus: {
        sha256: legacySource.sourceSha256,
        cases: legacySource.cases,
        sourceAuthority: legacySource.sourceAuthority,
      },
      thresholds: {
        minimumEvaluatedCases: 1,
        minimumCoverage: 0.8,
        minimumAccuracy: 0.8,
      },
      dependencies: { legacyReport: "pre-manifest" },
      provider: { identityState: "identified", name: "gemini", model: report.model },
      performance: {
        inputTokens: unavailable("legacy report did not retain input token counts"),
        outputTokens: unavailable("legacy report did not retain output token counts"),
        cost: unavailable("legacy report did not retain measured cost"),
        latencyP95: unavailable("legacy report did not retain per-case latency"),
      },
      execution: {
        retries: Math.max(0, ...results.map((item) => Math.max(0, Number(item.attempts ?? 1) - 1))),
        seed: null,
      },
      privacy: {
        mode: "content-retained",
        rawProviderPayloadsRetained: false,
        retainedEvaluationContent: "queries-and-model-output",
      },
      outcome: {
        state,
        reason: zeroCaseRun || allUnavailable
          ? zeroCaseRun
            ? "corpus contained no evaluation cases"
            : "provider configuration was unavailable"
          : hasFailure
            ? "one or more provider calls or structured outputs failed"
            : qualityPassed
              ? null
              : "legacy benchmark quality or coverage thresholds failed",
      },
      provenance: {
        sourceSha256: legacySource.sourceSha256,
        evidence: {
          state: "unavailable",
          reason: "legacy report object does not retain its original artifact bytes",
        },
        evidenceType: "caller-bound-legacy-trigger-corpus",
        evaluator: { state: "unavailable", reason: "legacy report did not retain evaluator identity" },
      },
    });
  }
  throw new Error("unrecognized evaluation report shape");
}

function compareValues(
  before: unknown,
  after: unknown,
  path: string,
): EvaluationManifestChange[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) =>
      compareValues(before[index], after[index], `${path}[${index}]`)
    ).flat();
  }
  if (
    before !== null
    && after !== null
    && typeof before === "object"
    && typeof after === "object"
    && !Array.isArray(before)
    && !Array.isArray(after)
  ) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
      .sort()
      .flatMap((key) =>
        compareValues(
          beforeRecord[key],
          afterRecord[key],
          path ? `${path}.${key}` : key,
        )
      );
  }
  return Object.is(before, after) ? [] : [{ path, before, after }];
}

function requireComparisonBinding(
  manifest: EvaluationManifest,
  label: "baseline" | "candidate",
): void {
  if (manifest.provenance.evidence.state !== "hashed") {
    throw new Error(
      `${label} manifest is unbound: provenance evidence hash is unavailable (${manifest.provenance.evidence.reason})`,
    );
  }
}

export function compareEvaluationManifests(
  baselineValue: unknown,
  candidateValue: unknown,
): EvaluationManifestComparison {
  const baseline = validateEvaluationManifest(baselineValue);
  const candidate = validateEvaluationManifest(candidateValue);
  requireComparisonBinding(baseline, "baseline");
  requireComparisonBinding(candidate, "candidate");

  if (baseline.evaluation.id !== candidate.evaluation.id) {
    throw new Error(
      `incompatible evaluation manifests: evaluation.id changed from "${baseline.evaluation.id}" to "${candidate.evaluation.id}"`,
    );
  }
  if (baseline.evaluation.kind !== candidate.evaluation.kind) {
    throw new Error(
      `incompatible evaluation manifests: evaluation.kind changed from "${baseline.evaluation.kind}" to "${candidate.evaluation.kind}"`,
    );
  }
  const limitations = ([
    ["baseline", baseline],
    ["candidate", candidate],
  ] as const).flatMap(([label, manifest]) =>
    manifest.provenance.evaluator.state === "unavailable"
      ? [`${label} evaluator identity is unavailable: ${manifest.provenance.evaluator.reason}`]
      : []
  );

  const identityChanges = compareValues(
    {
      manifestVersion: baseline.manifestVersion,
      evaluation: baseline.evaluation,
      corpus: baseline.corpus,
      thresholds: baseline.thresholds,
      dependencies: baseline.dependencies,
      provider: baseline.provider,
      execution: baseline.execution,
      privacy: baseline.privacy,
      provenance: baseline.provenance,
    },
    {
      manifestVersion: candidate.manifestVersion,
      evaluation: candidate.evaluation,
      corpus: candidate.corpus,
      thresholds: candidate.thresholds,
      dependencies: candidate.dependencies,
      provider: candidate.provider,
      execution: candidate.execution,
      privacy: candidate.privacy,
      provenance: candidate.provenance,
    },
    "",
  );
  const metricChanges = compareValues(
    baseline.performance,
    candidate.performance,
    "performance",
  );
  const outcomeChanges = compareValues(
    baseline.outcome,
    candidate.outcome,
    "outcome",
  );
  const total = identityChanges.length + metricChanges.length + outcomeChanges.length;
  const summary = total === 0
    ? `No changes: ${baseline.evaluation.id} manifests are identical.`
    : `${total} change${total === 1 ? "" : "s"}: ${identityChanges.length} identity, ${metricChanges.length} metric, ${outcomeChanges.length} outcome.`;

  return {
    format: "evaluation-manifest-comparison",
    formatVersion: 1,
    compatible: true,
    limitations,
    identityChanges,
    metricChanges,
    outcomeChanges,
    summary,
  };
}

export type EvaluationComparabilityRequirements = {
  evaluationId: string;
  kind: EvaluationManifest["evaluation"]["kind"];
  source: EvaluationSourceIdentity;
  thresholds: Record<string, number>;
  dependencies: Record<string, string>;
  provider: EvaluationManifest["provider"];
  evidence: Extract<
    EvaluationManifest["provenance"]["evidence"],
    { state: "hashed" }
  >;
  evidenceType: string;
  evaluator: Extract<
    EvaluationManifest["provenance"]["evaluator"],
    { state: "hashed" }
  >;
  requirePassedOutcome?: boolean;
};

export const QLORA_PROMOTION_POLICY = {
  overallGainMarginPercentagePoints: 5,
  criticalGainMarginPercentagePoints: 3,
  minimumPower: 0.8,
  confidenceLevel: 0.95,
  bootstrapReplicates: 10_000,
} as const;

export const QLORA_PROMOTION_POWER_METHOD =
  "seeded-empirical-brand-cluster-simulation-normal-bound-v1" as const;
export type QloraPromotionSystemIdentity = {
  modelSha256: string;
  tokenizerSha256: string;
  generationSettingsSha256: string;
  retryPolicySha256: string;
};

export type QloraPromotionIdentities =
  | {
      state: "identified";
      sourceRevisionSha256: string;
      promptParseCacheSha256: string;
      outputSchemaSha256: string;
      sanitizerSha256: string;
      caseInputManifestSha256: string;
      goldLabelManifestSha256: string;
      fieldScoringRulesSha256: string;
      scoringImplementationSha256: string;
      expectedCases: number;
      candidate: QloraPromotionSystemIdentity;
      promptedBase: QloraPromotionSystemIdentity;
      gemini: {
        provider: string;
        model: string;
        generationSettingsSha256: string;
        retryPolicySha256: string;
      };
    }
  | { state: "unavailable"; reason: string };

type QloraPromotionPowerMetadata = {
  developmentEvidenceSha256: string;
  method: typeof QLORA_PROMOTION_POWER_METHOD;
  seed: number;
  confidenceLevel: number;
  minimumPower: number;
  overallTargetMarginPercentagePoints: number;
  criticalTargetMarginPercentagePoints: number;
  developmentCaseCount: number;
  developmentBrandClusterCount: number;
  simulationReplicates: number;
};
export type QloraPromotionPowerAnalysis =
  | (QloraPromotionPowerMetadata & {
      state: "qualified";
      plannedBrandClusters: number;
      overallPower: number;
      criticalPower: number;
    })
  | (QloraPromotionPowerMetadata & {
      state: "insufficient";
      reason: string;
      maximumEvaluatedBrandClusters: number;
      overallPower: number;
      criticalPower: number;
    })
  | { state: "unavailable"; reason: string };

export type QloraPromotionDevelopmentPowerInput = {
  evidenceScope: "development-only";
  seed: number;
  results: {
    candidate: QloraPromotionCaseResult[];
    promptedBase: QloraPromotionCaseResult[];
  };
};
export type QloraPromotionCaseResult = {
  caseId: string;
  brandClusterId: string;
  eligibleFields: string[];
  criticalFields: string[];
  /** Missing entries are scored as incorrect; extra entries are ignored. */
  fieldCorrectness: Record<string, boolean>;
  schemaValid: boolean;
  blankPoison: boolean;
  emptyOutput: boolean;
  systematicMissingRequiredFields: boolean;
};

export type QloraPromotionInput = {
  identities: QloraPromotionIdentities;
  powerAnalysis: QloraPromotionPowerAnalysis;
  bootstrapSeed: number;
  results: {
    candidate: QloraPromotionCaseResult[];
    promptedBase: QloraPromotionCaseResult[];
    gemini: QloraPromotionCaseResult[];
  };
};

export type QloraPromotionAgreement = {
  overall: number;
  critical: number;
};

export type QloraPromotionGainBounds = {
  estimatePercentagePoints: number;
  lowerBoundPercentagePoints: number;
  upperBoundPercentagePoints: number;
};

export type QloraPromotionSafetyGates = {
  schemaValidity: boolean;
  criticalFieldAgreement: boolean;
  criticalFieldHardFailure: boolean;
  overallFieldAgreement: boolean;
  zeroBlankPoisonCases: boolean;
  emptyOutputRate: boolean;
  noSystematicMissingRequiredFields: boolean;
};

export type QloraPromotionDecision =
  | "promotion-recommended"
  | "no-go"
  | "inconclusive";

export type QloraPromotionBootstrap = {
  method: "seeded-brand-cluster-percentile";
  confidenceLevel: typeof QLORA_PROMOTION_POLICY.confidenceLevel;
  replicates: typeof QLORA_PROMOTION_POLICY.bootstrapReplicates;
  seed: number | null;
};

export type QloraPromotionEvaluationSummary = {
  decision: QloraPromotionDecision;
  reasonCodes: string[];
  reasons: string[];
  caseCount: number;
  brandClusterCount: number;
  bootstrap: QloraPromotionBootstrap;
  agreements: {
    candidate: QloraPromotionAgreement;
    promptedBase: QloraPromotionAgreement;
    gemini: QloraPromotionAgreement;
  } | null;
  gains: {
    overall: QloraPromotionGainBounds;
    critical: QloraPromotionGainBounds;
  } | null;
  safetyGates: QloraPromotionSafetyGates | null;
};

export type QloraPromotionIdentifiedSystems = Extract<
  QloraPromotionIdentities,
  { state: "identified" }
>;

export type QloraPromotionQualifiedPowerAnalysis = Extract<
  QloraPromotionPowerAnalysis,
  { state: "qualified" }
>;

export type QloraPromotionResultManifest = QloraPromotionEvaluationSummary & {
  format: "qlora-promotion-result-manifest";
  formatVersion: 1;
  privacy: {
    mode: "metadata-only";
    rawProviderPayloadsRetained: false;
    retainedEvaluationContent: "none";
  };
  identities: QloraPromotionIdentifiedSystems;
  powerAnalysis: QloraPromotionQualifiedPowerAnalysis;
};

export type QloraPromotionResultManifestBindings = {
  identities: QloraPromotionIdentities;
  powerAnalysis: QloraPromotionPowerAnalysis;
  bootstrapSeed: number;
};

export type QloraPromotionResultComparisonInput = {
  manifest: unknown;
  bindings: QloraPromotionResultManifestBindings;
};
export type QloraPromotionEvaluation = QloraPromotionEvaluationSummary & {
  format: "qlora-promotion-evaluation";
  formatVersion: 1;
  /** Null when identity, power, or bootstrap preconditions are unavailable. */
  manifest: QloraPromotionResultManifest | null;
};

type PairedQloraCase = {
  candidate: QloraPromotionCaseResult;
  promptedBase: QloraPromotionCaseResult;
  gemini: QloraPromotionCaseResult;
};

type QloraCaseScores = {
  overall: number;
  critical: number;
};

const QLORA_SHA256_RE = /^[a-f0-9]{64}$/;
const QLORA_RATE_EPSILON = 1e-12;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && QLORA_SHA256_RE.test(value);
}

function qloraInconclusive(
  reasonCode: string,
  reason: string,
  seed: number | null,
  counts: { caseCount?: number; brandClusterCount?: number } = {},
): QloraPromotionEvaluation {
  return {
    format: "qlora-promotion-evaluation",
    formatVersion: 1,
    manifest: null,
    decision: "inconclusive",
    reasonCodes: [reasonCode],
    reasons: [reason],
    caseCount: counts.caseCount ?? 0,
    brandClusterCount: counts.brandClusterCount ?? 0,
    bootstrap: {
      method: "seeded-brand-cluster-percentile",
      confidenceLevel: QLORA_PROMOTION_POLICY.confidenceLevel,
      replicates: QLORA_PROMOTION_POLICY.bootstrapReplicates,
      seed,
    },
    agreements: null,
    gains: null,
    safetyGates: null,
  };
}

function validateQloraIdentities(value: unknown): string | null {
  if (!isObjectRecord(value)) return "evaluation identities are missing or malformed";
  if (value.state === "unavailable") {
    return isNonEmptyString(value.reason)
      ? `evaluation identities are unavailable: ${value.reason}`
      : "evaluation identities are unavailable without a reason";
  }
  if (value.state !== "identified") return "evaluation identity state is not identified";

  const sharedHashes = [
    "sourceRevisionSha256",
    "promptParseCacheSha256",
    "outputSchemaSha256",
    "sanitizerSha256",
    "caseInputManifestSha256",
    "goldLabelManifestSha256",
    "fieldScoringRulesSha256",
    "scoringImplementationSha256",
  ];
  for (const key of sharedHashes) {
    if (!isSha256(value[key])) return `evaluation identity ${key} is unavailable or invalid`;
  }
  if (
    typeof value.expectedCases !== "number"
    || !Number.isSafeInteger(value.expectedCases)
    || value.expectedCases < 1
  ) {
    return "evaluation identity expectedCases must be a positive integer";
  }

  for (const systemName of ["candidate", "promptedBase"] as const) {
    const system = value[systemName];
    if (!isObjectRecord(system)) return `${systemName} model identity is unavailable`;
    for (const key of [
      "modelSha256",
      "tokenizerSha256",
      "generationSettingsSha256",
      "retryPolicySha256",
    ]) {
      if (!isSha256(system[key])) {
        return `${systemName} ${key} is unavailable or invalid`;
      }
    }
  }
  const candidate = value.candidate as Record<string, unknown>;
  const promptedBase = value.promptedBase as Record<string, unknown>;
  if (candidate.modelSha256 === promptedBase.modelSha256) {
    return "candidate and prompted-base model identities must be distinct";
  }

  const gemini = value.gemini;
  if (!isObjectRecord(gemini)) return "Gemini model identity is unavailable";
  if (!isNonEmptyString(gemini.provider) || !isNonEmptyString(gemini.model)) {
    return "Gemini provider and model identities must be non-empty";
  }
  if (!isSha256(gemini.generationSettingsSha256) || !isSha256(gemini.retryPolicySha256)) {
    return "Gemini generation settings or retry-policy identity is unavailable or invalid";
  }
  return null;
}

function validateQloraPowerAnalysis(value: unknown): string | null {
  if (!isObjectRecord(value)) return "pre-holdout power analysis is missing or malformed";
  if (value.state === "unavailable" || value.state === "insufficient") {
    return isNonEmptyString(value.reason)
      ? `pre-holdout power analysis is ${value.state}: ${value.reason}`
      : `pre-holdout power analysis is ${value.state} without a reason`;
  }
  if (value.state !== "qualified") return "pre-holdout power analysis is not qualified";
  if (!isSha256(value.developmentEvidenceSha256)) {
    return "development-only power-analysis evidence hash is unavailable or invalid";
  }
  if (
    value.method !== QLORA_PROMOTION_POWER_METHOD
    || typeof value.seed !== "number"
    || !Number.isSafeInteger(value.seed)
    || value.seed < 0
    || value.seed > 0xffff_ffff
  ) {
    return "pre-holdout power analysis method or seed is unavailable or invalid";
  }
  if (
    value.confidenceLevel !== QLORA_PROMOTION_POLICY.confidenceLevel
    || value.minimumPower !== QLORA_PROMOTION_POLICY.minimumPower
    || value.overallTargetMarginPercentagePoints
      !== QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints
    || value.criticalTargetMarginPercentagePoints
      !== QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints
  ) {
    return "power analysis does not use the frozen confidence level and both approved gain margins";
  }
  if (
    typeof value.developmentCaseCount !== "number"
    || !Number.isSafeInteger(value.developmentCaseCount)
    || value.developmentCaseCount < 2
    || typeof value.developmentBrandClusterCount !== "number"
    || !Number.isSafeInteger(value.developmentBrandClusterCount)
    || value.developmentBrandClusterCount < 2
    || value.developmentCaseCount < value.developmentBrandClusterCount
    || value.simulationReplicates !== QLORA_POWER_SIMULATION_REPLICATES
  ) {
    return "pre-holdout power analysis development sample metadata is invalid";
  }
  if (
    typeof value.plannedBrandClusters !== "number"
    || !Number.isSafeInteger(value.plannedBrandClusters)
    || value.plannedBrandClusters < 2
  ) {
    return "pre-holdout power analysis must require at least two independent brand clusters";
  }
  if (
    typeof value.overallPower !== "number"
    || !Number.isFinite(value.overallPower)
    || value.overallPower < 0
    || typeof value.criticalPower !== "number"
    || !Number.isFinite(value.criticalPower)
    || value.criticalPower < 0
    || value.overallPower < QLORA_PROMOTION_POLICY.minimumPower
    || value.criticalPower < QLORA_PROMOTION_POLICY.minimumPower
    || value.overallPower > 1
    || value.criticalPower > 1
  ) {
    return "pre-holdout power analysis does not establish at least 80% power for both gains";
  }
  return null;
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported metadata fields`);
  }
}

function normalizeQloraPromotionIdentities(
  value: unknown,
  label: string,
): QloraPromotionIdentifiedSystems {
  const error = validateQloraIdentities(value);
  if (error) throw new Error(`${label} are invalid: ${error}`);
  const root = value as Record<string, unknown>;
  onlyKeys(root, [
    "state",
    "sourceRevisionSha256",
    "promptParseCacheSha256",
    "outputSchemaSha256",
    "sanitizerSha256",
    "caseInputManifestSha256",
    "goldLabelManifestSha256",
    "fieldScoringRulesSha256",
    "scoringImplementationSha256",
    "expectedCases",
    "candidate",
    "promptedBase",
    "gemini",
  ], label);
  const normalizeSystem = (
    systemValue: unknown,
    systemLabel: string,
  ): QloraPromotionSystemIdentity => {
    const system = record(systemValue, systemLabel);
    onlyKeys(system, [
      "modelSha256",
      "tokenizerSha256",
      "generationSettingsSha256",
      "retryPolicySha256",
    ], systemLabel);
    return {
      modelSha256: system.modelSha256 as string,
      tokenizerSha256: system.tokenizerSha256 as string,
      generationSettingsSha256: system.generationSettingsSha256 as string,
      retryPolicySha256: system.retryPolicySha256 as string,
    };
  };
  const candidate = normalizeSystem(root.candidate, `${label}.candidate`);
  const promptedBase = normalizeSystem(root.promptedBase, `${label}.promptedBase`);
  const gemini = record(root.gemini, `${label}.gemini`);
  onlyKeys(gemini, [
    "provider",
    "model",
    "generationSettingsSha256",
    "retryPolicySha256",
  ], `${label}.gemini`);
  return {
    state: "identified",
    sourceRevisionSha256: root.sourceRevisionSha256 as string,
    promptParseCacheSha256: root.promptParseCacheSha256 as string,
    outputSchemaSha256: root.outputSchemaSha256 as string,
    sanitizerSha256: root.sanitizerSha256 as string,
    caseInputManifestSha256: root.caseInputManifestSha256 as string,
    goldLabelManifestSha256: root.goldLabelManifestSha256 as string,
    fieldScoringRulesSha256: root.fieldScoringRulesSha256 as string,
    scoringImplementationSha256: root.scoringImplementationSha256 as string,
    expectedCases: root.expectedCases as number,
    candidate,
    promptedBase,
    gemini: {
      provider: gemini.provider as string,
      model: gemini.model as string,
      generationSettingsSha256: gemini.generationSettingsSha256 as string,
      retryPolicySha256: gemini.retryPolicySha256 as string,
    },
  };
}

function normalizeQloraPowerAnalysis(
  value: unknown,
  label: string,
): QloraPromotionQualifiedPowerAnalysis {
  const error = validateQloraPowerAnalysis(value);
  if (error) throw new Error(`${label} is invalid: ${error}`);
  const power = record(value, label);
  onlyKeys(power, [
    "state",
    "developmentEvidenceSha256",
    "method",
    "seed",
    "confidenceLevel",
    "minimumPower",
    "overallTargetMarginPercentagePoints",
    "criticalTargetMarginPercentagePoints",
    "developmentCaseCount",
    "developmentBrandClusterCount",
    "simulationReplicates",
    "plannedBrandClusters",
    "overallPower",
    "criticalPower",
  ], label);
  return {
    state: "qualified",
    developmentEvidenceSha256: power.developmentEvidenceSha256 as string,
    method: power.method as typeof QLORA_PROMOTION_POWER_METHOD,
    seed: power.seed as number,
    confidenceLevel: power.confidenceLevel as number,
    minimumPower: power.minimumPower as number,
    overallTargetMarginPercentagePoints: power.overallTargetMarginPercentagePoints as number,
    criticalTargetMarginPercentagePoints: power.criticalTargetMarginPercentagePoints as number,
    developmentCaseCount: power.developmentCaseCount as number,
    developmentBrandClusterCount: power.developmentBrandClusterCount as number,
    simulationReplicates: power.simulationReplicates as number,
    plannedBrandClusters: power.plannedBrandClusters as number,
    overallPower: power.overallPower as number,
    criticalPower: power.criticalPower as number,
  };
}

function validateQloraRate(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 1
  ) {
    throw new Error(`${label} must be a finite rate from zero to one`);
  }
  return value;
}

function validateQloraAgreement(
  value: unknown,
  label: string,
): QloraPromotionAgreement {
  const agreement = record(value, label);
  onlyKeys(agreement, ["overall", "critical"], label);
  return {
    overall: validateQloraRate(agreement.overall, `${label}.overall`),
    critical: validateQloraRate(agreement.critical, `${label}.critical`),
  };
}

function validateQloraGain(
  value: unknown,
  label: string,
): QloraPromotionGainBounds {
  const gain = record(value, label);
  onlyKeys(gain, [
    "estimatePercentagePoints",
    "lowerBoundPercentagePoints",
    "upperBoundPercentagePoints",
  ], label);
  const estimatePercentagePoints = finite(
    gain.estimatePercentagePoints,
    `${label}.estimatePercentagePoints`,
  ) as number;
  const lowerBoundPercentagePoints = finite(
    gain.lowerBoundPercentagePoints,
    `${label}.lowerBoundPercentagePoints`,
  ) as number;
  const upperBoundPercentagePoints = finite(
    gain.upperBoundPercentagePoints,
    `${label}.upperBoundPercentagePoints`,
  ) as number;
  if (
    lowerBoundPercentagePoints > estimatePercentagePoints
    || estimatePercentagePoints > upperBoundPercentagePoints
  ) {
    throw new Error(`${label} confidence bounds must contain the estimate`);
  }
  return {
    estimatePercentagePoints,
    lowerBoundPercentagePoints,
    upperBoundPercentagePoints,
  };
}

function validateQloraGates(value: unknown): QloraPromotionSafetyGates {
  const gates = record(value, "manifest.safetyGates");
  const keys: (keyof QloraPromotionSafetyGates)[] = [
    "schemaValidity",
    "criticalFieldAgreement",
    "criticalFieldHardFailure",
    "overallFieldAgreement",
    "zeroBlankPoisonCases",
    "emptyOutputRate",
    "noSystematicMissingRequiredFields",
  ];
  onlyKeys(gates, keys, "manifest.safetyGates");
  for (const key of keys) {
    if (typeof gates[key] !== "boolean") {
      throw new Error(`manifest.safetyGates.${key} must be boolean`);
    }
  }
  return Object.fromEntries(keys.map((key) => [key, gates[key]])) as QloraPromotionSafetyGates;
}

function qloraDecisionReason(
  summary: QloraPromotionEvaluationSummary,
): string {
  if (summary.reasonCodes.length !== 1) {
    throw new Error("manifest must contain exactly one decision reason code");
  }
  const [reasonCode] = summary.reasonCodes;
  switch (reasonCode) {
    case "PAIRED_EVIDENCE_INVALID":
      return "paired case evidence did not satisfy the frozen case and metadata contract";
    case "POWER_ANALYSIS_CLUSTER_COUNT_NOT_MET":
      return "scored evidence has fewer brand clusters than the pre-holdout power analysis requires";
    case "SAFETY_GATE_FAILED": {
      if (!summary.safetyGates) throw new Error("safety-gate decision requires gate outcomes");
      const failed = Object.entries(summary.safetyGates)
        .filter(([name, passed]) => name !== "criticalFieldHardFailure" && passed === false)
        .map(([name]) => name);
      if (failed.length === 0) throw new Error("safety-gate decision requires a failed gate");
      return `non-compensatory safety gate(s) failed: ${failed.join(", ")}`;
    }
    case "REQUIRED_GAIN_RULED_OUT": {
      if (!summary.gains) throw new Error("gain decision requires confidence bounds");
      const ruledOut = [
        summary.gains.overall.upperBoundPercentagePoints
          <= QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints
          ? "overall"
          : null,
        summary.gains.critical.upperBoundPercentagePoints
          <= QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints
          ? "critical-field"
          : null,
      ].filter((entry): entry is string => entry !== null);
      if (ruledOut.length === 0) throw new Error("gain decision must rule out a required gain");
      return `the upper confidence bound rules out the required gain for ${ruledOut.join(" and ")}`;
    }
    case "ALL_PROMOTION_GATES_PASSED":
      return "both one-sided 95% lower confidence bounds strictly exceed their approved margins and every safety gate passed";
    case "REQUIRED_GAIN_NOT_ESTABLISHED": {
      if (!summary.gains) throw new Error("gain decision requires confidence bounds");
      const crossing = [
        summary.gains.overall.lowerBoundPercentagePoints
          <= QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints
          ? "overall"
          : null,
        summary.gains.critical.lowerBoundPercentagePoints
          <= QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints
          ? "critical-field"
          : null,
      ].filter((entry): entry is string => entry !== null);
      if (crossing.length === 0) throw new Error("inconclusive decision must name a margin not established");
      return `the lower confidence bound does not strictly clear the required margin for ${crossing.join(" and ")}`;
    }
    default:
      throw new Error("manifest decision reason code is unsupported");
  }
}

function validateQloraPromotionSummary(value: unknown): QloraPromotionEvaluationSummary {
  const summary = record(value, "manifest");
  if (
    summary.decision !== "promotion-recommended"
    && summary.decision !== "no-go"
    && summary.decision !== "inconclusive"
  ) {
    throw new Error("manifest.decision is unsupported");
  }
  if (!Array.isArray(summary.reasonCodes) || summary.reasonCodes.some((code) => !isNonEmptyString(code))) {
    throw new Error("manifest.reasonCodes must contain non-empty codes");
  }
  if (!Array.isArray(summary.reasons) || summary.reasons.length !== 1 || !isNonEmptyString(summary.reasons[0])) {
    throw new Error("manifest.reasons must contain one non-empty aggregate explanation");
  }
  const caseCount = summary.caseCount;
  const brandClusterCount = summary.brandClusterCount;
  if (
    typeof caseCount !== "number"
    || !Number.isSafeInteger(caseCount)
    || caseCount < 0
    || typeof brandClusterCount !== "number"
    || !Number.isSafeInteger(brandClusterCount)
    || brandClusterCount < 0
    || brandClusterCount > caseCount
  ) {
    throw new Error("manifest case and brand-cluster counts are invalid");
  }
  const bootstrap = record(summary.bootstrap, "manifest.bootstrap");
  onlyKeys(bootstrap, ["method", "confidenceLevel", "replicates", "seed"], "manifest.bootstrap");
  if (
    bootstrap.method !== "seeded-brand-cluster-percentile"
    || bootstrap.confidenceLevel !== QLORA_PROMOTION_POLICY.confidenceLevel
    || bootstrap.replicates !== QLORA_PROMOTION_POLICY.bootstrapReplicates
    || typeof bootstrap.seed !== "number"
    || !Number.isSafeInteger(bootstrap.seed)
    || bootstrap.seed < 0
    || bootstrap.seed > 0xffff_ffff
  ) {
    throw new Error("manifest.bootstrap does not match the frozen bootstrap contract");
  }

  let agreements: QloraPromotionEvaluationSummary["agreements"] = null;
  if (summary.agreements !== null) {
    const input = record(summary.agreements, "manifest.agreements");
    onlyKeys(input, ["candidate", "promptedBase", "gemini"], "manifest.agreements");
    agreements = {
      candidate: validateQloraAgreement(input.candidate, "manifest.agreements.candidate"),
      promptedBase: validateQloraAgreement(input.promptedBase, "manifest.agreements.promptedBase"),
      gemini: validateQloraAgreement(input.gemini, "manifest.agreements.gemini"),
    };
  }

  let gains: QloraPromotionEvaluationSummary["gains"] = null;
  if (summary.gains !== null) {
    const input = record(summary.gains, "manifest.gains");
    onlyKeys(input, ["overall", "critical"], "manifest.gains");
    gains = {
      overall: validateQloraGain(input.overall, "manifest.gains.overall"),
      critical: validateQloraGain(input.critical, "manifest.gains.critical"),
    };
  }

  const safetyGates = summary.safetyGates === null
    ? null
    : validateQloraGates(summary.safetyGates);
  const validated: QloraPromotionEvaluationSummary = {
    decision: summary.decision,
    reasonCodes: [...summary.reasonCodes] as string[],
    reasons: [...summary.reasons] as string[],
    caseCount,
    brandClusterCount,
    bootstrap: {
      method: "seeded-brand-cluster-percentile",
      confidenceLevel: QLORA_PROMOTION_POLICY.confidenceLevel,
      replicates: QLORA_PROMOTION_POLICY.bootstrapReplicates,
      seed: bootstrap.seed,
    },
    agreements,
    gains,
    safetyGates,
  };
  if (validated.reasons[0] !== qloraDecisionReason(validated)) {
    throw new Error("manifest decision reason does not match its aggregate outcome");
  }
  return validated;
}

/**
 * Validate a detached QLoRA result manifest and bind it to the caller's
 * frozen identities and pre-holdout power evidence. Only allowlisted metadata
 * is returned; case rows, case identifiers, and provider payloads are rejected.
 */
export function validateQloraPromotionResultManifest(
  value: unknown,
  expected: QloraPromotionResultManifestBindings,
): QloraPromotionResultManifest {
  const root = record(value, "QLoRA result manifest");
  onlyKeys(root, [
    "format",
    "formatVersion",
    "privacy",
    "identities",
    "powerAnalysis",
    "decision",
    "reasonCodes",
    "reasons",
    "caseCount",
    "brandClusterCount",
    "bootstrap",
    "agreements",
    "gains",
    "safetyGates",
  ], "QLoRA result manifest");
  if (root.format !== "qlora-promotion-result-manifest" || root.formatVersion !== 1) {
    throw new Error("unsupported QLoRA result manifest format or version");
  }
  const privacy = record(root.privacy, "manifest.privacy");
  onlyKeys(privacy, [
    "mode",
    "rawProviderPayloadsRetained",
    "retainedEvaluationContent",
  ], "manifest.privacy");
  if (
    privacy.mode !== "metadata-only"
    || privacy.rawProviderPayloadsRetained !== false
    || privacy.retainedEvaluationContent !== "none"
  ) {
    throw new Error("QLoRA result manifest must be metadata-only and retain no provider payloads");
  }

  const identities = normalizeQloraPromotionIdentities(root.identities, "manifest.identities");
  const expectedIdentities = normalizeQloraPromotionIdentities(expected?.identities, "expected identities");
  if (JSON.stringify(identities) !== JSON.stringify(expectedIdentities)) {
    throw new Error("QLoRA result manifest identities do not match the frozen identities");
  }
  const powerAnalysis = normalizeQloraPowerAnalysis(root.powerAnalysis, "manifest.powerAnalysis");
  const expectedPowerAnalysis = normalizeQloraPowerAnalysis(
    expected?.powerAnalysis,
    "expected pre-holdout power analysis",
  );
  if (JSON.stringify(powerAnalysis) !== JSON.stringify(expectedPowerAnalysis)) {
    throw new Error("QLoRA result manifest power analysis does not match the frozen evidence");
  }

  const summary = validateQloraPromotionSummary(root);
  if (
    !Number.isSafeInteger(expected?.bootstrapSeed)
    || expected.bootstrapSeed < 0
    || expected.bootstrapSeed > 0xffff_ffff
    || summary.bootstrap.seed !== expected.bootstrapSeed
  ) {
    throw new Error("QLoRA result manifest bootstrap seed does not match the frozen input");
  }
  if (
    summary.reasonCodes[0] === "PAIRED_EVIDENCE_INVALID"
    && (
      summary.decision !== "inconclusive"
      || summary.caseCount !== 0
      || summary.brandClusterCount !== 0
      || summary.agreements !== null
      || summary.gains !== null
      || summary.safetyGates !== null
    )
  ) {
    throw new Error("invalid paired evidence must not contain aggregate scores");
  }
  if (
    summary.reasonCodes[0] === "POWER_ANALYSIS_CLUSTER_COUNT_NOT_MET"
    && (
      summary.decision !== "inconclusive"
      || summary.caseCount !== identities.expectedCases
      || summary.brandClusterCount >= powerAnalysis.plannedBrandClusters
      || summary.agreements !== null
      || summary.gains !== null
      || summary.safetyGates !== null
    )
  ) {
    throw new Error("cluster-count decision does not match its pre-holdout power requirement");
  }
  if (
    summary.reasonCodes[0] === "SAFETY_GATE_FAILED"
    && (
      summary.decision !== "no-go"
      || summary.caseCount !== identities.expectedCases
      || summary.brandClusterCount < powerAnalysis.plannedBrandClusters
      || !summary.agreements
      || !summary.gains
      || !summary.safetyGates
    )
  ) {
    throw new Error("safety-gate no-go must include complete aggregate evidence");
  }
  if (
    summary.reasonCodes[0] === "REQUIRED_GAIN_RULED_OUT"
    && (
      summary.decision !== "no-go"
      || summary.caseCount !== identities.expectedCases
      || summary.brandClusterCount < powerAnalysis.plannedBrandClusters
      || !summary.agreements
      || !summary.gains
      || !summary.safetyGates
      || summary.safetyGates.criticalFieldHardFailure
      || Object.entries(summary.safetyGates).some(([name, passed]) =>
        name !== "criticalFieldHardFailure" && passed === false,
      )
    )
  ) {
    throw new Error("ruled-out gain decision must include complete aggregate evidence");
  }
  if (
    summary.reasonCodes[0] === "ALL_PROMOTION_GATES_PASSED"
    && (
      summary.decision !== "promotion-recommended"
      || summary.caseCount !== identities.expectedCases
      || summary.brandClusterCount < powerAnalysis.plannedBrandClusters
      || !summary.agreements
      || !summary.gains
      || !summary.safetyGates
      || summary.safetyGates.criticalFieldHardFailure
      || Object.entries(summary.safetyGates).some(([name, passed]) =>
        name !== "criticalFieldHardFailure" && passed === false,
      )
      || summary.gains.overall.lowerBoundPercentagePoints
        <= QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints
      || summary.gains.critical.lowerBoundPercentagePoints
        <= QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints
    )
  ) {
    throw new Error("promotion recommendation does not satisfy every frozen gate and gain margin");
  }
  if (
    summary.reasonCodes[0] === "REQUIRED_GAIN_NOT_ESTABLISHED"
    && (
      summary.decision !== "inconclusive"
      || summary.caseCount !== identities.expectedCases
      || summary.brandClusterCount < powerAnalysis.plannedBrandClusters
      || !summary.agreements
      || !summary.gains
      || !summary.safetyGates
      || summary.safetyGates.criticalFieldHardFailure
      || Object.entries(summary.safetyGates).some(([name, passed]) =>
        name !== "criticalFieldHardFailure" && passed === false,
      )
    )
  ) {
    throw new Error("inconclusive gain decision must include complete aggregate evidence");
  }

  return {
    format: "qlora-promotion-result-manifest",
    formatVersion: 1,
    privacy: {
      mode: "metadata-only",
      rawProviderPayloadsRetained: false,
      retainedEvaluationContent: "none",
    },
    identities,
    powerAnalysis,
    ...summary,
  };
}

/**
 * Compare two detached QLoRA result manifests after binding each to its own
 * caller-supplied frozen identities, power analysis, and bootstrap seed.
 * Changed comparison contracts are reported explicitly and make the aggregate
 * metrics incompatible for direct improvement claims.
 */
export function compareQloraPromotionResultManifests(
  baselineInput: QloraPromotionResultComparisonInput,
  candidateInput: QloraPromotionResultComparisonInput,
): QloraPromotionResultManifestComparison {
  const baseline = validateQloraPromotionResultManifest(
    baselineInput.manifest,
    baselineInput.bindings,
  );
  const candidate = validateQloraPromotionResultManifest(
    candidateInput.manifest,
    candidateInput.bindings,
  );

  const identityChanges = compareValues(
    baseline.identities,
    candidate.identities,
    "identities",
  );
  const powerAnalysisChanges = compareValues(
    baseline.powerAnalysis,
    candidate.powerAnalysis,
    "powerAnalysis",
  );
  const bootstrapChanges = compareValues(
    baseline.bootstrap,
    candidate.bootstrap,
    "bootstrap",
  );
  const aggregateMetricChanges = compareValues(
    {
      caseCount: baseline.caseCount,
      brandClusterCount: baseline.brandClusterCount,
      agreements: baseline.agreements,
      gains: baseline.gains,
    },
    {
      caseCount: candidate.caseCount,
      brandClusterCount: candidate.brandClusterCount,
      agreements: candidate.agreements,
      gains: candidate.gains,
    },
    "",
  );
  const safetyGateChanges = compareValues(
    baseline.safetyGates,
    candidate.safetyGates,
    "safetyGates",
  );
  const decisionChanges = compareValues(
    {
      decision: baseline.decision,
      reasonCodes: baseline.reasonCodes,
      reasons: baseline.reasons,
    },
    {
      decision: candidate.decision,
      reasonCodes: candidate.reasonCodes,
      reasons: candidate.reasons,
    },
    "",
  );

  const limitations = [
    identityChanges.length > 0
      ? "frozen QLoRA identities differ; aggregate metrics are not directly comparable"
      : null,
    powerAnalysisChanges.length > 0
      ? "pre-holdout power analysis differs; promotion evidence is not directly comparable"
      : null,
    bootstrapChanges.length > 0
      ? "bootstrap contract or seed differs; confidence-bound evidence is not directly comparable"
      : null,
  ].filter((entry): entry is string => entry !== null);
  const compatible = limitations.length === 0;
  const changeCounts = [
    identityChanges.length,
    powerAnalysisChanges.length,
    bootstrapChanges.length,
    aggregateMetricChanges.length,
    safetyGateChanges.length,
    decisionChanges.length,
  ];
  const total = changeCounts.reduce((sum, count) => sum + count, 0);
  const summary = total === 0
    ? "No changes: QLoRA result manifests are identical and comparable."
    : `${total} change${total === 1 ? "" : "s"}: ${identityChanges.length} identity, ${powerAnalysisChanges.length} power analysis, ${bootstrapChanges.length} bootstrap, ${aggregateMetricChanges.length} aggregate metric, ${safetyGateChanges.length} safety gate, ${decisionChanges.length} decision${compatible ? "." : "; not directly comparable."}`;

  return {
    format: "qlora-promotion-result-comparison",
    formatVersion: 1,
    compatible,
    limitations,
    identityChanges,
    powerAnalysisChanges,
    bootstrapChanges,
    aggregateMetricChanges,
    safetyGateChanges,
    decisionChanges,
    summary,
  };
}
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function validateQloraCaseResult(value: unknown): value is QloraPromotionCaseResult {
  if (!isObjectRecord(value)) return false;
  if (!isNonEmptyString(value.caseId) || !isNonEmptyString(value.brandClusterId)) return false;
  const eligibleFields = value.eligibleFields;
  const criticalFields = value.criticalFields;
  if (!isStringList(eligibleFields) || eligibleFields.length === 0) return false;
  if (!isStringList(criticalFields) || criticalFields.length === 0) return false;
  if (
    new Set(eligibleFields).size !== eligibleFields.length
    || new Set(criticalFields).size !== criticalFields.length
    || !criticalFields.every((field) => eligibleFields.includes(field))
  ) {
    return false;
  }
  if (
    !isObjectRecord(value.fieldCorrectness)
    || Object.values(value.fieldCorrectness).some((correct) => typeof correct !== "boolean")
  ) {
    return false;
  }
  return [
    value.schemaValid,
    value.blankPoison,
    value.emptyOutput,
    value.systematicMissingRequiredFields,
  ].every((flag) => typeof flag === "boolean");
}

function pairQloraRuns(
  value: unknown,
  expectedCases: number,
): { cases: PairedQloraCase[]; error: string | null } {
  if (!isObjectRecord(value)) return { cases: [], error: "evaluation results are missing or malformed" };
  const names = ["candidate", "promptedBase", "gemini"] as const;
  const runs = {} as Record<(typeof names)[number], QloraPromotionCaseResult[]>;
  for (const name of names) {
    const run = value[name];
    if (!Array.isArray(run) || run.some((row) => !validateQloraCaseResult(row))) {
      return { cases: [], error: `${name} case results are missing or malformed` };
    }
    if (run.length !== expectedCases) {
      return { cases: [], error: `${name} result count does not match the frozen case count` };
    }
    const ids = run.map((row) => row.caseId);
    if (new Set(ids).size !== ids.length) {
      return { cases: [], error: `${name} contains duplicate case identities` };
    }
    runs[name] = run;
  }

  const caseMaps = Object.fromEntries(
    names.map((name) => [name, new Map(runs[name].map((row) => [row.caseId, row]))]),
  ) as Record<(typeof names)[number], Map<string, QloraPromotionCaseResult>>;
  const referenceIds = [...caseMaps.candidate.keys()].sort();
  if (
    !sameStringSet(referenceIds, [...caseMaps.promptedBase.keys()])
    || !sameStringSet(referenceIds, [...caseMaps.gemini.keys()])
  ) {
    return { cases: [], error: "candidate, prompted base, and Gemini did not score the same cases" };
  }

  const paired: PairedQloraCase[] = [];
  for (const caseId of referenceIds) {
    const candidate = caseMaps.candidate.get(caseId) as QloraPromotionCaseResult;
    const promptedBase = caseMaps.promptedBase.get(caseId) as QloraPromotionCaseResult;
    const gemini = caseMaps.gemini.get(caseId) as QloraPromotionCaseResult;
    for (const row of [promptedBase, gemini]) {
      if (
        row.brandClusterId !== candidate.brandClusterId
        || !sameStringSet(row.eligibleFields, candidate.eligibleFields)
        || !sameStringSet(row.criticalFields, candidate.criticalFields)
      ) {
        return { cases: [], error: "paired case metadata does not match the frozen contract" };
      }
    }
    paired.push({ candidate, promptedBase, gemini });
  }
  return { cases: paired, error: null };
}

type PairedQloraDevelopmentCase = {
  candidate: QloraPromotionCaseResult;
  promptedBase: QloraPromotionCaseResult;
};
function scoreQloraCase(row: QloraPromotionCaseResult): QloraCaseScores {
  const correct = (field: string): number => row.fieldCorrectness[field] === true ? 1 : 0;
  return {
    overall: row.eligibleFields.reduce((total, field) => total + correct(field), 0) / row.eligibleFields.length,
    critical: row.criticalFields.reduce((total, field) => total + correct(field), 0) / row.criticalFields.length,
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function seededQloraRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(sortedValues: number[], probability: number): number {
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const fraction = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - fraction) + sortedValues[upperIndex] * fraction;
}

function bootstrapQloraGain(
  cases: PairedQloraCase[],
  metric: keyof QloraCaseScores,
  seed: number,
): QloraPromotionGainBounds {
  const clusters = new Map<string, { gainSum: number; cases: number }>();
  const caseGains = cases.map(({ candidate, promptedBase }) => {
    const candidateScore = scoreQloraCase(candidate)[metric];
    const baseScore = scoreQloraCase(promptedBase)[metric];
    const gain = candidateScore - baseScore;
    const cluster = clusters.get(candidate.brandClusterId) ?? { gainSum: 0, cases: 0 };
    cluster.gainSum += gain;
    cluster.cases += 1;
    clusters.set(candidate.brandClusterId, cluster);
    return gain;
  });
  const orderedClusters = [...clusters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, cluster]) => cluster);
  const random = seededQloraRandom(seed);
  const bootstrapMeans = new Array<number>(QLORA_PROMOTION_POLICY.bootstrapReplicates);
  for (let replicate = 0; replicate < bootstrapMeans.length; replicate += 1) {
    let gainSum = 0;
    let sampledCaseCount = 0;
    for (let draw = 0; draw < orderedClusters.length; draw += 1) {
      const cluster = orderedClusters[Math.floor(random() * orderedClusters.length)];
      gainSum += cluster.gainSum;
      sampledCaseCount += cluster.cases;
    }
    bootstrapMeans[replicate] = gainSum / sampledCaseCount;
  }
  bootstrapMeans.sort((left, right) => left - right);
  return {
    estimatePercentagePoints: mean(caseGains) * 100,
    lowerBoundPercentagePoints: percentile(bootstrapMeans, 1 - QLORA_PROMOTION_POLICY.confidenceLevel) * 100,
    upperBoundPercentagePoints: percentile(bootstrapMeans, QLORA_PROMOTION_POLICY.confidenceLevel) * 100,
  };
}

function modelAgreement(
  cases: PairedQloraCase[],
  system: keyof PairedQloraCase,
): QloraPromotionAgreement {
  const scores = cases.map((item) => scoreQloraCase(item[system]));
  return {
    overall: mean(scores.map((score) => score.overall)),
    critical: mean(scores.map((score) => score.critical)),
  };
}

function rate(cases: PairedQloraCase[], system: keyof PairedQloraCase, flag: keyof QloraPromotionCaseResult): number {
  return cases.filter((item) => item[system][flag] === true).length / cases.length;
}

function evaluateQloraSafetyGates(
  cases: PairedQloraCase[],
  agreements: NonNullable<QloraPromotionEvaluation["agreements"]>,
): QloraPromotionSafetyGates {
  const candidateSchema = rate(cases, "candidate", "schemaValid");
  const geminiSchema = rate(cases, "gemini", "schemaValid");
  const candidateEmpty = rate(cases, "candidate", "emptyOutput");
  const geminiEmpty = rate(cases, "gemini", "emptyOutput");
  const criticalGap = (agreements.candidate.critical - agreements.gemini.critical) * 100;
  const overallGap = (agreements.candidate.overall - agreements.gemini.overall) * 100;
  return {
    schemaValidity:
      candidateSchema + QLORA_RATE_EPSILON >= geminiSchema - 0.01
      || candidateSchema + QLORA_RATE_EPSILON >= 0.99,
    criticalFieldAgreement: criticalGap + QLORA_RATE_EPSILON >= -3,
    criticalFieldHardFailure: criticalGap < -5 - QLORA_RATE_EPSILON,
    overallFieldAgreement: overallGap + QLORA_RATE_EPSILON >= -5,
    zeroBlankPoisonCases: !cases.some((item) => item.candidate.blankPoison),
    emptyOutputRate: candidateEmpty <= geminiEmpty + 0.01 + QLORA_RATE_EPSILON,
    noSystematicMissingRequiredFields: !cases.some(
      (item) => item.candidate.systematicMissingRequiredFields,
    ),
  };
}

function finishQloraEvaluation(
  decision: QloraPromotionEvaluation["decision"],
  reasonCodes: string[],
  reasons: string[],
  seed: number,
  cases: PairedQloraCase[],
): QloraPromotionEvaluation {
  const agreements = {
    candidate: modelAgreement(cases, "candidate"),
    promptedBase: modelAgreement(cases, "promptedBase"),
    gemini: modelAgreement(cases, "gemini"),
  };
  const gains = {
    overall: bootstrapQloraGain(cases, "overall", seed),
    critical: bootstrapQloraGain(cases, "critical", seed),
  };
  const safetyGates = evaluateQloraSafetyGates(cases, agreements);
  return {
    format: "qlora-promotion-evaluation",
    formatVersion: 1,
    manifest: null,
    decision,
    reasonCodes,
    reasons,
    caseCount: cases.length,
    brandClusterCount: new Set(cases.map((item) => item.candidate.brandClusterId)).size,
    bootstrap: {
      method: "seeded-brand-cluster-percentile",
      confidenceLevel: QLORA_PROMOTION_POLICY.confidenceLevel,
      replicates: QLORA_PROMOTION_POLICY.bootstrapReplicates,
      seed,
    },
    agreements,
    gains,
    safetyGates,
  };
}

function summarizeQloraEvaluation(
  evaluation: QloraPromotionEvaluation,
): QloraPromotionEvaluationSummary {
  return {
    decision: evaluation.decision,
    reasonCodes: [...evaluation.reasonCodes],
    reasons: [...evaluation.reasons],
    caseCount: evaluation.caseCount,
    brandClusterCount: evaluation.brandClusterCount,
    bootstrap: { ...evaluation.bootstrap },
    agreements: evaluation.agreements
      ? {
        candidate: { ...evaluation.agreements.candidate },
        promptedBase: { ...evaluation.agreements.promptedBase },
        gemini: { ...evaluation.agreements.gemini },
      }
      : null,
    gains: evaluation.gains
      ? {
        overall: { ...evaluation.gains.overall },
        critical: { ...evaluation.gains.critical },
      }
      : null,
    safetyGates: evaluation.safetyGates
      ? { ...evaluation.safetyGates }
      : null,
  };
}

function attachQloraResultManifest(
  evaluation: QloraPromotionEvaluation,
  identities: QloraPromotionIdentifiedSystems,
  powerAnalysis: QloraPromotionQualifiedPowerAnalysis,
): QloraPromotionEvaluation {
  const manifest = validateQloraPromotionResultManifest({
    format: "qlora-promotion-result-manifest",
    formatVersion: 1,
    privacy: {
      mode: "metadata-only",
      rawProviderPayloadsRetained: false,
      retainedEvaluationContent: "none",
    },
    identities,
    powerAnalysis,
    ...summarizeQloraEvaluation(evaluation),
  }, {
    identities,
    powerAnalysis,
    bootstrapSeed: evaluation.bootstrap.seed as number,
  });
  return { ...evaluation, manifest };
}

/**
 * Evaluate a frozen, paired QLoRA comparison without provider calls.
 * The function scores missing eligible values as incorrect, resamples complete
 * brand clusters, and can recommend promotion only when both strict lower-bound
 * margins and every independent safety gate pass.
 */
export function evaluateConditionalQloraPromotion(
  input: QloraPromotionInput,
): QloraPromotionEvaluation {
  const seed = Number.isSafeInteger(input?.bootstrapSeed)
    && input.bootstrapSeed >= 0
    && input.bootstrapSeed <= 0xffff_ffff
    ? input.bootstrapSeed
    : null;
  const identityError = validateQloraIdentities(input?.identities);
  if (identityError) {
    return qloraInconclusive(
      identityError.startsWith("evaluation identities are unavailable")
        ? "IDENTITIES_UNAVAILABLE"
        : "IDENTITIES_INVALID",
      identityError,
      seed,
    );
  }
  const identities = input.identities as QloraPromotionIdentifiedSystems;

  const powerError = validateQloraPowerAnalysis(input?.powerAnalysis);
  if (powerError) {
    const unavailable = powerError.includes("unavailable") || powerError.includes("missing");
    return qloraInconclusive(
      unavailable ? "POWER_ANALYSIS_UNAVAILABLE" : "POWER_ANALYSIS_INSUFFICIENT",
      powerError,
      seed,
    );
  }
  if (seed === null) {
    return qloraInconclusive(
      "BOOTSTRAP_SEED_INVALID",
      "a predeclared unsigned 32-bit bootstrap seed is required",
      null,
    );
  }

  const power = input.powerAnalysis as QloraPromotionQualifiedPowerAnalysis;
  const withManifest = (evaluation: QloraPromotionEvaluation) =>
    attachQloraResultManifest(evaluation, identities, power);
  const paired = pairQloraRuns(input.results, identities.expectedCases);
  if (paired.error) {
    return withManifest(qloraInconclusive(
      "PAIRED_EVIDENCE_INVALID",
      "paired case evidence did not satisfy the frozen case and metadata contract",
      seed,
    ));
  }
  const brandClusterCount = new Set(paired.cases.map((item) => item.candidate.brandClusterId)).size;
  if (brandClusterCount < power.plannedBrandClusters) {
    return withManifest(qloraInconclusive(
      "POWER_ANALYSIS_CLUSTER_COUNT_NOT_MET",
      "scored evidence has fewer brand clusters than the pre-holdout power analysis requires",
      seed,
      { caseCount: paired.cases.length, brandClusterCount },
    ));
  }

  const evaluation = finishQloraEvaluation(
    "inconclusive",
    [],
    [],
    seed,
    paired.cases,
  );
  const gates = evaluation.safetyGates as QloraPromotionSafetyGates;
  const failedGates = Object.entries(gates)
    .filter(([name, passed]) => name !== "criticalFieldHardFailure" && passed === false)
    .map(([name]) => name);
  if (failedGates.length > 0) {
    return withManifest({
      ...evaluation,
      decision: "no-go",
      reasonCodes: ["SAFETY_GATE_FAILED"],
      reasons: [`non-compensatory safety gate(s) failed: ${failedGates.join(", ")}`],
    });
  }

  const overallRuledOut =
    evaluation.gains!.overall.upperBoundPercentagePoints
    <= QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints;
  const criticalRuledOut =
    evaluation.gains!.critical.upperBoundPercentagePoints
    <= QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints;
  if (overallRuledOut || criticalRuledOut) {
    const ruledOut = [
      overallRuledOut ? "overall" : null,
      criticalRuledOut ? "critical-field" : null,
    ].filter((entry): entry is string => entry !== null);
    return withManifest({
      ...evaluation,
      decision: "no-go",
      reasonCodes: ["REQUIRED_GAIN_RULED_OUT"],
      reasons: [`the upper confidence bound rules out the required gain for ${ruledOut.join(" and ")}`],
    });
  }

  const overallClears =
    evaluation.gains!.overall.lowerBoundPercentagePoints
    > QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints;
  const criticalClears =
    evaluation.gains!.critical.lowerBoundPercentagePoints
    > QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints;
  if (overallClears && criticalClears) {
    return withManifest({
      ...evaluation,
      decision: "promotion-recommended",
      reasonCodes: ["ALL_PROMOTION_GATES_PASSED"],
      reasons: [
        "both one-sided 95% lower confidence bounds strictly exceed their approved margins and every safety gate passed",
      ],
    });
  }
  const crossing = [
    !overallClears ? "overall" : null,
    !criticalClears ? "critical-field" : null,
  ].filter((entry): entry is string => entry !== null);
  return withManifest({
    ...evaluation,
    decision: "inconclusive",
    reasonCodes: ["REQUIRED_GAIN_NOT_ESTABLISHED"],
    reasons: [`the lower confidence bound does not strictly clear the required margin for ${crossing.join(" and ")}`],
  });
}

function simulateQloraPowerCurve(
  clusters: QloraPowerCluster[],
  maximumBrandCount: number,
  seed: number,
): QloraPowerAtSize[] {
  const overallSuccesses = new Array<number>(maximumBrandCount + 1).fill(0);
  const criticalSuccesses = new Array<number>(maximumBrandCount + 1).fill(0);
  for (let replicate = 0; replicate < QLORA_POWER_SIMULATION_REPLICATES; replicate += 1) {
    const random = seededQloraRandom(
      (seed ^ Math.imul(replicate + 1, 0x9e3779b1)) >>> 0,
    );
    let cases = 0;
    let overallGain = 0;
    let overallGainSquared = 0;
    let overallGainCases = 0;
    let criticalGain = 0;
    let criticalGainSquared = 0;
    let criticalGainCases = 0;
    let caseSquared = 0;

    for (let brandCount = 1; brandCount <= maximumBrandCount; brandCount += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      const overallCases = cluster.cases;
      const criticalCases = cluster.cases;
      cases += cluster.cases;
      overallGain += cluster.overallGainSum;
      overallGainSquared += cluster.overallGainSum * cluster.overallGainSum;
      overallGainCases += cluster.overallGainSum * overallCases;
      criticalGain += cluster.criticalGainSum;
      criticalGainSquared += cluster.criticalGainSum * cluster.criticalGainSum;
      criticalGainCases += cluster.criticalGainSum * criticalCases;
      caseSquared += cluster.cases * cluster.cases;

      if (brandCount < 2) continue;
      const overallLowerBound = clusterNormalLowerBound(
        overallGain,
        overallGainSquared,
        overallGainCases,
        caseSquared,
        cases,
        brandCount,
      );
      const criticalLowerBound = clusterNormalLowerBound(
        criticalGain,
        criticalGainSquared,
        criticalGainCases,
        caseSquared,
        cases,
        brandCount,
      );
      if (
        overallLowerBound * 100
        > QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints + QLORA_RATE_EPSILON
      ) {
        overallSuccesses[brandCount] += 1;
      }
      if (
        criticalLowerBound * 100
        > QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints + QLORA_RATE_EPSILON
      ) {
        criticalSuccesses[brandCount] += 1;
      }
    }
  }

  const curve = new Array<QloraPowerAtSize>(maximumBrandCount + 1);
  for (let brandCount = 2; brandCount <= maximumBrandCount; brandCount += 1) {
    curve[brandCount] = {
      overallPower: overallSuccesses[brandCount] / QLORA_POWER_SIMULATION_REPLICATES,
      criticalPower: criticalSuccesses[brandCount] / QLORA_POWER_SIMULATION_REPLICATES,
      qualified:
        wilsonLowerBound(overallSuccesses[brandCount], QLORA_POWER_SIMULATION_REPLICATES)
          >= QLORA_PROMOTION_POLICY.minimumPower
        && wilsonLowerBound(criticalSuccesses[brandCount], QLORA_POWER_SIMULATION_REPLICATES)
          >= QLORA_PROMOTION_POLICY.minimumPower,
    };
  }
  return curve;
}

/**
 * Calculate the minimum planned independent brand count from paired,
 * development-only case results. The result contains metadata and a hash only;
 * this function makes no provider calls and never accepts holdout data.
 */
export function calculateQloraPromotionPower(
  input: unknown,
): QloraPromotionPowerAnalysis {
  if (!isObjectRecord(input)) {
    return unavailableQloraPower("development-only power input is missing or malformed");
  }
  if (input.evidenceScope !== "development-only") {
    return unavailableQloraPower("power input must be explicitly scoped to development-only evidence");
  }
  if (
    typeof input.seed !== "number"
    || !Number.isSafeInteger(input.seed)
    || input.seed < 0
    || input.seed > 0xffff_ffff
  ) {
    return unavailableQloraPower("development-only power analysis requires an unsigned 32-bit seed");
  }
  const seed = input.seed as number;

  const paired = pairQloraDevelopmentRuns(input.results);
  if (paired.error) return unavailableQloraPower(paired.error);
  const clusters = qloraPowerClusters(paired.cases);
  const metadata: QloraPromotionPowerMetadata = {
    developmentEvidenceSha256: qloraDevelopmentEvidenceHash(paired.cases),
    method: QLORA_PROMOTION_POWER_METHOD,
    seed,
    confidenceLevel: QLORA_PROMOTION_POLICY.confidenceLevel,
    minimumPower: QLORA_PROMOTION_POLICY.minimumPower,
    overallTargetMarginPercentagePoints: QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints,
    criticalTargetMarginPercentagePoints: QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints,
    developmentCaseCount: paired.cases.length,
    developmentBrandClusterCount: clusters.length,
    simulationReplicates: QLORA_POWER_SIMULATION_REPLICATES,
  };

  if (clusters.length < 2) {
    return unavailableQloraPower(
      "at least two independent development brand clusters are required for power analysis",
    );
  }

  const approximateN = Math.max(
    2,
    estimatedQloraRequiredClusters(
      clusters,
      "overallGainSum",
      QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints,
    ),
    estimatedQloraRequiredClusters(
      clusters,
      "criticalGainSum",
      QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints,
    ),
  );
  let horizon = Number.isFinite(approximateN)
    ? Math.min(QLORA_POWER_MAX_BRAND_CLUSTERS, approximateN)
    : QLORA_POWER_MAX_BRAND_CLUSTERS;
  let powerCurve = simulateQloraPowerCurve(clusters, horizon, seed);
  let plannedBrandClusters: number | null = null;
  while (true) {
    for (let brandCount = 2; brandCount <= horizon; brandCount += 1) {
      if (powerCurve[brandCount].qualified) {
        plannedBrandClusters = brandCount;
        break;
      }
    }
    if (plannedBrandClusters !== null || horizon === QLORA_POWER_MAX_BRAND_CLUSTERS) break;
    horizon = Math.min(QLORA_POWER_MAX_BRAND_CLUSTERS, horizon * 2);
    powerCurve = simulateQloraPowerCurve(clusters, horizon, seed);
  }

  if (plannedBrandClusters === null) {
    const maximumPower = powerCurve[QLORA_POWER_MAX_BRAND_CLUSTERS];
    return {
      ...metadata,
      state: "insufficient",
      reason:
        `both approved gains did not reach ${Math.round(QLORA_PROMOTION_POLICY.minimumPower * 100)}% ` +
        `estimated power by ${QLORA_POWER_MAX_BRAND_CLUSTERS} planned brand clusters`,
      maximumEvaluatedBrandClusters: QLORA_POWER_MAX_BRAND_CLUSTERS,
      overallPower: maximumPower.overallPower,
      criticalPower: maximumPower.criticalPower,
    };
  }

  const minimumPower = powerCurve[plannedBrandClusters];
  return {
    ...metadata,
    state: "qualified",
    plannedBrandClusters,
    overallPower: minimumPower.overallPower,
    criticalPower: minimumPower.criticalPower,
  };
}

const QLORA_POWER_80_Z = 0.8416212335729143;

function qloraPowerClusters(cases: PairedQloraDevelopmentCase[]): QloraPowerCluster[] {
  const clusters = new Map<string, QloraPowerCluster>();
  for (const { candidate, promptedBase } of cases) {
    const candidateScore = scoreQloraCase(candidate);
    const baseScore = scoreQloraCase(promptedBase);
    const cluster = clusters.get(candidate.brandClusterId) ?? {
      cases: 0,
      overallGainSum: 0,
      criticalGainSum: 0,
    };
    cluster.cases += 1;
    cluster.overallGainSum += candidateScore.overall - baseScore.overall;
    cluster.criticalGainSum += candidateScore.critical - baseScore.critical;
    clusters.set(candidate.brandClusterId, cluster);
  }
  return [...clusters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, cluster]) => cluster);
}

function unavailableQloraPower(reason: string): QloraPromotionPowerAnalysis {
  return { state: "unavailable", reason };
}

type QloraPowerCluster = {
  cases: number;
  overallGainSum: number;
  criticalGainSum: number;
};

const QLORA_POWER_SIMULATION_REPLICATES = 5_000;

const QLORA_POWER_MONTE_CARLO_Z = 1.959963984540054;

function pairQloraDevelopmentRuns(
  value: unknown,
): { cases: PairedQloraDevelopmentCase[]; error: string | null } {
  if (!isObjectRecord(value)) {
    return { cases: [], error: "development paired results are missing or malformed" };
  }
  const names = ["candidate", "promptedBase"] as const;
  const runs = {} as Record<(typeof names)[number], QloraPromotionCaseResult[]>;
  for (const name of names) {
    const run = value[name];
    if (!Array.isArray(run) || run.some((row) => !validateQloraCaseResult(row))) {
      return { cases: [], error: `${name} development case results are missing or malformed` };
    }
    if (run.length === 0) {
      return { cases: [], error: `${name} development case results are empty` };
    }
    const ids = run.map((row) => row.caseId);
    if (new Set(ids).size !== ids.length) {
      return { cases: [], error: `${name} development results contain duplicate case identities` };
    }
    runs[name] = run;
  }

  const caseMaps = Object.fromEntries(
    names.map((name) => [name, new Map(runs[name].map((row) => [row.caseId, row]))]),
  ) as Record<(typeof names)[number], Map<string, QloraPromotionCaseResult>>;
  const referenceIds = [...caseMaps.candidate.keys()].sort();
  if (!sameStringSet(referenceIds, [...caseMaps.promptedBase.keys()])) {
    return { cases: [], error: "candidate and prompted base did not score the same development cases" };
  }

  const paired: PairedQloraDevelopmentCase[] = [];
  for (const caseId of referenceIds) {
    const candidate = caseMaps.candidate.get(caseId) as QloraPromotionCaseResult;
    const promptedBase = caseMaps.promptedBase.get(caseId) as QloraPromotionCaseResult;
    if (
      promptedBase.brandClusterId !== candidate.brandClusterId
      || !sameStringSet(promptedBase.eligibleFields, candidate.eligibleFields)
      || !sameStringSet(promptedBase.criticalFields, candidate.criticalFields)
    ) {
      return { cases: [], error: "paired development case metadata does not match" };
    }
    paired.push({ candidate, promptedBase });
  }
  return { cases: paired, error: null };
}

function wilsonLowerBound(successes: number, trials: number): number {
  const z = QLORA_POWER_MONTE_CARLO_Z;
  const observed = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = observed + zSquared / (2 * trials);
  const margin = z * Math.sqrt(
    (observed * (1 - observed) / trials) + (zSquared / (4 * trials * trials)),
  );
  return (center - margin) / denominator;
}

function qloraDevelopmentEvidenceHash(cases: PairedQloraDevelopmentCase[]): string {
  const pairedCases = cases.map(({ candidate, promptedBase }) => {
    const eligibleFields = [...candidate.eligibleFields].sort();
    const criticalFields = [...candidate.criticalFields].sort();
    return {
      caseId: candidate.caseId,
      brandClusterId: candidate.brandClusterId,
      eligibleFields,
      criticalFields,
      candidateCorrectness: eligibleFields.map((field) => candidate.fieldCorrectness[field] === true),
      promptedBaseCorrectness: eligibleFields.map((field) => promptedBase.fieldCorrectness[field] === true),
    };
  });
  return createHash("sha256")
    .update(JSON.stringify({
      format: "qlora-development-paired-power-evidence",
      version: 1,
      evidenceScope: "development-only",
      pairedCases,
    }))
    .digest("hex");
}

const QLORA_POWER_MAX_BRAND_CLUSTERS = 1_000;

function clusterNormalLowerBound(
  gainSum: number,
  gainSquaredSum: number,
  gainCaseProductSum: number,
  caseSquaredSum: number,
  caseCount: number,
  sampledBrandCount: number,
): number {
  const estimate = gainSum / caseCount;
  const residualSumSquares = Math.max(
    0,
    gainSquaredSum
      - 2 * estimate * gainCaseProductSum
      + estimate * estimate * caseSquaredSum,
  );
  const residualVariance = residualSumSquares / Math.max(1, sampledBrandCount - 1);
  const standardError = Math.sqrt(
    (sampledBrandCount * residualVariance) / (caseCount * caseCount),
  );
  return estimate - QLORA_POWER_ONE_SIDED_95_Z * standardError;
}

function estimatedQloraRequiredClusters(
  clusters: QloraPowerCluster[],
  metric: "overallGainSum" | "criticalGainSum",
  targetPercentagePoints: number,
): number {
  const brandCount = clusters.length;
  const totalCases = clusters.reduce((total, cluster) => total + cluster.cases, 0);
  const totalGain = clusters.reduce((total, cluster) => total + cluster[metric], 0);
  const estimatedGain = totalGain / totalCases;
  const target = targetPercentagePoints / 100;
  const difference = estimatedGain - target;
  if (difference * 100 <= QLORA_RATE_EPSILON) return Number.POSITIVE_INFINITY;

  const meanCasesPerBrand = totalCases / brandCount;
  const influenceVariance = clusters.reduce((total, cluster) => {
    const influence = cluster[metric] - estimatedGain * cluster.cases;
    return total + influence * influence;
  }, 0) / brandCount;
  const standardErrorAtOneBrand = Math.sqrt(influenceVariance) / meanCasesPerBrand;
  const targetN =
    ((QLORA_POWER_ONE_SIDED_95_Z + QLORA_POWER_80_Z) * standardErrorAtOneBrand / difference) ** 2;
  return Number.isFinite(targetN) ? Math.max(2, Math.ceil(targetN)) : Number.POSITIVE_INFINITY;
}

const QLORA_POWER_ONE_SIDED_95_Z = 1.6448536269514722;

type QloraPowerAtSize = {
  overallPower: number;
  criticalPower: number;
  qualified: boolean;
};

export type QloraPromotionResultManifestComparison = {
  format: "qlora-promotion-result-comparison";
  formatVersion: 1;
  compatible: boolean;
  limitations: string[];
  identityChanges: EvaluationManifestChange[];
  powerAnalysisChanges: EvaluationManifestChange[];
  bootstrapChanges: EvaluationManifestChange[];
  aggregateMetricChanges: EvaluationManifestChange[];
  safetyGateChanges: EvaluationManifestChange[];
  decisionChanges: EvaluationManifestChange[];
  summary: string;
};
