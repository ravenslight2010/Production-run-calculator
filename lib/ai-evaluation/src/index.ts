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

export type QloraPromotionPowerAnalysis =
  | {
      state: "qualified";
      developmentEvidenceSha256: string;
      confidenceLevel: number;
      overallTargetMarginPercentagePoints: number;
      criticalTargetMarginPercentagePoints: number;
      plannedBrandClusters: number;
      overallPower: number;
      criticalPower: number;
    }
  | { state: "insufficient"; reason: string }
  | { state: "unavailable"; reason: string };

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

export type QloraPromotionEvaluation = {
  format: "qlora-promotion-evaluation";
  formatVersion: 1;
  decision: "promotion-recommended" | "no-go" | "inconclusive";
  reasonCodes: string[];
  reasons: string[];
  caseCount: number;
  brandClusterCount: number;
  bootstrap: {
    method: "seeded-brand-cluster-percentile";
    confidenceLevel: typeof QLORA_PROMOTION_POLICY.confidenceLevel;
    replicates: typeof QLORA_PROMOTION_POLICY.bootstrapReplicates;
    seed: number | null;
  };
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
): QloraPromotionEvaluation {
  return {
    format: "qlora-promotion-evaluation",
    formatVersion: 1,
    decision: "inconclusive",
    reasonCodes: [reasonCode],
    reasons: [reason],
    caseCount: 0,
    brandClusterCount: 0,
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
    value.confidenceLevel !== QLORA_PROMOTION_POLICY.confidenceLevel
    || value.overallTargetMarginPercentagePoints
      !== QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints
    || value.criticalTargetMarginPercentagePoints
      !== QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints
  ) {
    return "power analysis does not use the frozen confidence level and both approved gain margins";
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
    || typeof value.criticalPower !== "number"
    || !Number.isFinite(value.criticalPower)
    || value.overallPower < QLORA_PROMOTION_POLICY.minimumPower
    || value.criticalPower < QLORA_PROMOTION_POLICY.minimumPower
    || value.overallPower > 1
    || value.criticalPower > 1
  ) {
    return "pre-holdout power analysis does not establish at least 80% power for both gains";
  }
  return null;
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
        return { cases: [], error: `paired case metadata does not match for case ${caseId}` };
      }
    }
    paired.push({ candidate, promptedBase, gemini });
  }
  return { cases: paired, error: null };
}

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
  const identities = input.identities as Extract<QloraPromotionIdentities, { state: "identified" }>;

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

  const power = input.powerAnalysis as Extract<QloraPromotionPowerAnalysis, { state: "qualified" }>;
  const paired = pairQloraRuns(input.results, identities.expectedCases);
  if (paired.error) {
    return qloraInconclusive("PAIRED_EVIDENCE_INVALID", paired.error, seed);
  }
  const brandClusterCount = new Set(paired.cases.map((item) => item.candidate.brandClusterId)).size;
  if (brandClusterCount < power.plannedBrandClusters) {
    return qloraInconclusive(
      "POWER_ANALYSIS_CLUSTER_COUNT_NOT_MET",
      `scored evidence has ${brandClusterCount} brand clusters but the pre-holdout power analysis requires ${power.plannedBrandClusters}`,
      seed,
    );
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
    return {
      ...evaluation,
      decision: "no-go",
      reasonCodes: ["SAFETY_GATE_FAILED"],
      reasons: [`non-compensatory safety gate(s) failed: ${failedGates.join(", ")}`],
    };
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
    return {
      ...evaluation,
      decision: "no-go",
      reasonCodes: ["REQUIRED_GAIN_RULED_OUT"],
      reasons: [`the upper confidence bound rules out the required gain for ${ruledOut.join(" and ")}`],
    };
  }

  const overallClears =
    evaluation.gains!.overall.lowerBoundPercentagePoints
    > QLORA_PROMOTION_POLICY.overallGainMarginPercentagePoints;
  const criticalClears =
    evaluation.gains!.critical.lowerBoundPercentagePoints
    > QLORA_PROMOTION_POLICY.criticalGainMarginPercentagePoints;
  if (overallClears && criticalClears) {
    return {
      ...evaluation,
      decision: "promotion-recommended",
      reasonCodes: ["ALL_PROMOTION_GATES_PASSED"],
      reasons: [
        "both one-sided 95% lower confidence bounds strictly exceed their approved margins and every safety gate passed",
      ],
    };
  }
  const crossing = [
    !overallClears ? "overall" : null,
    !criticalClears ? "critical-field" : null,
  ].filter((entry): entry is string => entry !== null);
  return {
    ...evaluation,
    decision: "inconclusive",
    reasonCodes: ["REQUIRED_GAIN_NOT_ESTABLISHED"],
    reasons: [`the lower confidence bound does not strictly clear the required margin for ${crossing.join(" and ")}`],
  };
}
