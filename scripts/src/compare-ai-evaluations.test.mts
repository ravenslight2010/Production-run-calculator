import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runComparisonCli } from "./compare-ai-evaluations.mts";

const digest = "a".repeat(64);
const manifest = {
  manifestVersion: 1,
  evaluation: { id: "fixture", kind: "deterministic" },
  corpus: { sha256: digest, cases: 2, sourceAuthority: "fixture" },
  thresholds: { minimumAccuracy: 1 },
  dependencies: { evaluator: "1" },
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-comparison-"));
try {
  const baseline = path.join(dir, "baseline.json");
  const candidate = path.join(dir, "candidate.json");
  fs.writeFileSync(baseline, JSON.stringify({ evaluationManifest: manifest }));
  fs.writeFileSync(candidate, JSON.stringify({
    evaluationManifest: {
      ...manifest,
      performance: {
        ...manifest.performance,
        latencyP95: { state: "measured", value: 8, unit: "ms" },
      },
    },
  }));

  const json = JSON.parse(runComparisonCli([baseline, candidate]));
  assert.equal(json.metricChanges[0].path, "performance.latencyP95.value");
  assert.match(runComparisonCli([baseline, candidate, "--human"]), /1 change: 0 identity, 1 metric, 0 outcome/);
  const retained = path.resolve(
    import.meta.dirname,
    "../../docs/second-pass-reviewer-benchmark-2026-09-05.json",
  );
  const retainedComparison = JSON.parse(runComparisonCli([retained, retained]));
  assert.match(retainedComparison.summary, /^No changes:/);
  assert.match(retainedComparison.limitations[0], /evaluator identity is unavailable/);
  assert.throws(() => runComparisonCli([baseline]), /usage:/);
  console.log("AI evaluation comparison CLI tests passed");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}