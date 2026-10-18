import test from "node:test";
import assert from "node:assert/strict";
import {
  checkOutcome,
  cleanWorktreeEnvironment,
  compareCheckMeasurements,
  parsePeakRssKiB,
} from "./node-compatibility-advisory.mjs";

test("parses GNU time peak RSS without retaining command output", () => {
  assert.equal(parsePeakRssKiB("diagnostic output\nNODE_ADVISORY_PEAK_RSS_KIB=18432\n"), 18432);
  assert.equal(parsePeakRssKiB("NODE_ADVISORY_PEAK_RSS_KIB=0\n"), 0);
  assert.equal(parsePeakRssKiB("measurement unavailable"), null);
});

test("classifies process outcomes while keeping advisory failures explicit", () => {
  assert.equal(checkOutcome({ exitCode: 0, timedOut: false }), "PASS");
  assert.equal(checkOutcome({ exitCode: 2, timedOut: false }), "FAIL");
  assert.equal(checkOutcome({ exitCode: 143, timedOut: true }), "TIMEOUT");
  assert.equal(checkOutcome({ exitCode: null, timedOut: false, spawnError: "ENOENT" }), "INFRASTRUCTURE_ERROR");
});

test("skips unrelated LFS downloads when creating comparison worktrees", () => {
  const environment = cleanWorktreeEnvironment({
    CI: "true",
    GIT_LFS_SKIP_SMUDGE: "0",
  });
  assert.equal(environment.CI, "true");
  assert.equal(environment.GIT_LFS_SKIP_SMUDGE, "1");
});

test("pairs check measurements by stable identifier and computes deltas", () => {
  const comparison = compareCheckMeasurements(
    [
      { id: "install", outcome: "PASS", elapsedMs: 1200, peakRssKiB: 90 },
      { id: "build", outcome: "PASS", elapsedMs: 2500, peakRssKiB: null },
    ],
    [
      { id: "build", outcome: "FAIL", elapsedMs: 3000, peakRssKiB: null },
      { id: "install", outcome: "PASS", elapsedMs: 1000, peakRssKiB: 110 },
    ],
  );
  assert.deepEqual(comparison, [
    {
      id: "install",
      baselineOutcome: "PASS",
      candidateOutcome: "PASS",
      elapsedDeltaMs: -200,
      peakRssDeltaKiB: 20,
    },
    {
      id: "build",
      baselineOutcome: "PASS",
      candidateOutcome: "FAIL",
      elapsedDeltaMs: 500,
      peakRssDeltaKiB: null,
    },
  ]);
  assert.throws(
    () => compareCheckMeasurements([{ id: "install" }], []),
    /missing check install/u,
  );
});
