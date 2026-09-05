import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ACCEPTANCE,
  buildReviewerBenchmark,
  evaluateReviewerEvidence,
} from "./second-pass-reviewer-benchmark.mts";

const root = path.resolve(import.meta.dirname, "../..");
const actual = buildReviewerBenchmark(root);
const expected = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/second-pass-reviewer-benchmark-2026-09-05.json"),
    "utf8",
  ),
);

assert.deepEqual(actual, expected, "checked-in reviewer evidence must match the pinned source and observations");
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
assert.equal(actual.pairedOutcome.reviewer.duplicateWarnings, 3);
assert.equal(actual.pairedOutcome.reviewer.reviewerFailures, 301);
assert.equal(actual.pairedOutcome.reviewer.falseWarningRate, null);
assert.equal(actual.measuredEffects.p95LatencyMs, 24_169);
assert.match(actual.decision.authority, /human confirmation/);

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