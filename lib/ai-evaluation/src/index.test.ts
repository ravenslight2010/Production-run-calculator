import { describe, expect, it } from "vitest";
import {
  compareEvaluationManifests,
  readEvaluationManifest,
  validateEvaluationManifest,
  type EvaluationManifest,
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