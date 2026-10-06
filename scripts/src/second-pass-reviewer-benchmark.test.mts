import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ACCEPTANCE,
  buildReviewerBenchmark,
  evaluateReviewerEvidence,
  reviewerEvaluatorProvenance,
} from "./second-pass-reviewer-benchmark.mts";
import {
  buildReviewPrompt,
  normalizeReviewItems,
  sanitizeReviewVerdicts,
} from "./second-pass-reviewer-evaluator.mts";

const root = path.resolve(import.meta.dirname, "../..");
const actual = buildReviewerBenchmark(root);
const expected = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/second-pass-reviewer-benchmark-2026-09-05.json"),
    "utf8",
  ),
);

assert.deepEqual(actual, expected, "checked-in reviewer evidence must match the pinned source and observations");
assert.match(expected.evaluationManifest.dependencies.pnpmLockSha256, /^[a-f0-9]{64}$/u);
const liveObservations = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/second-pass-reviewer-live-observations-2026-09-05.json"),
    "utf8",
  ),
);
assert.equal(liveObservations.formatVersion, 2);
assert.equal(liveObservations.environment, "candidate-workspace");
assert.equal(liveObservations.toolchain.nodeVersion, "24.21.0");
assert.equal(liveObservations.toolchain.pnpmVersion, "12.8.1");
assert.equal(
  liveObservations.toolchain.pnpmLockSha256,
  expected.evaluationManifest.dependencies.pnpmLockSha256,
);
assert.match(liveObservations.evaluatorSha256, /^[a-f0-9]{64}$/u);
assert.equal(expected.evaluationManifest.provenance.evaluator.sha256, liveObservations.evaluatorSha256);
assert.equal(
  Object.values(liveObservations.operations).filter(
    (observation: { failureClass?: string }) => observation.failureClass === "SyntaxError",
  ).length,
  4,
);
assert.equal(ACCEPTANCE.minimumUniqueMaterialCatchRate, 0.2);
assert.equal(actual.decision.retain, false);
assert.deepEqual(actual.decision.thresholdPasses, {
  uniqueMaterialCatchCount: false,
  uniqueMaterialCatchRate: false,
  falseWarningRate: false,
  addedCostRatio: false,
  addedLatencyP95: false,
  reviewerFailureRate: false,
});
assert.equal(actual.pairedOutcome.reviewer.uniqueMaterialCatches, 0);
assert.equal(actual.pairedOutcome.reviewer.duplicateWarnings, 2);
assert.equal(actual.pairedOutcome.reviewer.reviewerFailures, 301);
assert.equal(actual.pairedOutcome.reviewer.noOpVerdicts, 302);
assert.equal(actual.pairedOutcome.reviewer.falseWarningRate, null);
assert.equal(actual.measuredEffects.p95LatencyMs, 17_001);
assert.match(actual.decision.authority, /human confirmation/);
assert.deepEqual(
  reviewerEvaluatorProvenance("a".repeat(64)),
  { state: "hashed", sha256: "a".repeat(64) },
);
assert.deepEqual(reviewerEvaluatorProvenance(undefined), {
  state: "unavailable",
  reason: "retained historical observations predate evaluator source binding",
});
assert.throws(() => reviewerEvaluatorProvenance("not-a-digest"), /lowercase evaluator SHA-256/u);

const normalizedItems = normalizeReviewItems([
  { id: " row-1 ", text: "  first record  " },
  { id: "row-1", text: "duplicate id" },
  { id: "row-2", text: `  ${"x".repeat(610)}  ` },
  { id: " ", text: "ignored blank id" },
]);
assert.deepEqual(normalizedItems, [
  { id: "row-1", text: "first record" },
  { id: "row-2", text: "x".repeat(600) },
]);
assert.deepEqual(normalizeReviewItems(normalizedItems), normalizedItems);
const prompt = buildReviewPrompt("merge review", "check for wrong targets", normalizedItems);
assert.match(prompt.system, /human reviews your flags/u);
assert.match(prompt.user, /id=row-1: first record/u);

const sanitizedVerdicts = sanitizeReviewVerdicts(
  {
    verdicts: [
      { id: " row-1 ", status: "warning", reason: "  verify target  " },
      { id: "unknown", status: "reject", reason: "not accepted" },
      { id: "row-1", status: "reject", reason: "duplicate id" },
    ],
  },
  ["row-1"],
);
assert.deepEqual(sanitizedVerdicts, [
  { id: "row-1", status: "warn", reason: "verify target" },
]);
assert.deepEqual(sanitizeReviewVerdicts(sanitizedVerdicts, ["row-1"]), sanitizedVerdicts);

const source = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
    ),
    "utf8",
  ),
);
const tampered = structuredClone(expected.measuredEffects.observationsByOperation);
tampered["match-import"].materialCases -= 1;
tampered["match-import"].nonMaterialCases += 1;
assert.throws(
  () => evaluateReviewerEvidence(source.findings, tampered),
  /labels do not match source/,
);

console.log("second-pass reviewer benchmark tests passed");