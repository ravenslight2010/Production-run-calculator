import { describe, expect, it } from "vitest";
import { readEvaluationManifest, validateEvaluationManifest, type EvaluationManifest } from "./index.js";

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