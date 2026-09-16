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
