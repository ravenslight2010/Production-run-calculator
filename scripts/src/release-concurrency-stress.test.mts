import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compareConcurrencyStressReports,
  formatConcurrencyStressMarkdown,
  formatConcurrencyComparisonMarkdown,
  formatConcurrencyTrendMarkdown,
  runConcurrencyStress,
  summarizeConcurrencyStressTrend,
  validateStressEnvironment,
  type StressRunStep,
} from "./release-concurrency-stress.mts";
import {
  API_SHARD_TIMEOUT_MS,
  RELEASE_CHECK_API_SHARD_STEPS,
  releaseGateLabelsForMode,
} from "./release-check.mts";

const steps = [
  { label: "shard one", args: [] },
  { label: "shard two", args: [] },
  { label: "shard three", args: [] },
  { label: "shard four", args: [] },
];

async function run(): Promise<void> {
  assert.equal(RELEASE_CHECK_API_SHARD_STEPS.length, 6);
  assert.ok(
    RELEASE_CHECK_API_SHARD_STEPS.every(
      (step) =>
        step.group === "api-test-shards" &&
        step.timeoutMs === API_SHARD_TIMEOUT_MS,
    ),
    "the disposable lane must reuse the exact bounded API release shard definitions",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").every(
      (label) => !label.includes("concurrency stress"),
    ),
    "the disposable lane must not alter the production release gate inventory",
  );
  assert.ok(
    releaseGateLabelsForMode("full").every(
      (label) => !label.includes("concurrency stress"),
    ),
    "the disposable lane must not alter the full release gate inventory",
  );

  let active = 0;
  let peak = 0;
  const healthyRunner: StressRunStep = async (_step, options) => {
    active += 1;
    peak = Math.max(peak, active);
    options?.onOutput?.("vitest setup complete\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { exitCode: 0, elapsedMs: 20, status: "PASS", output: "" };
  };
  const healthyOutputDirectory = await mkdtemp(
    join(tmpdir(), "release-concurrency-test-"),
  );
  const healthy = await runConcurrencyStress(steps, {
    concurrencyCap: 2,
    runStepFn: healthyRunner,
    outputDirectory: healthyOutputDirectory,
  });
  await access(join(healthyOutputDirectory, "release-concurrency-trend.json"));
  await access(join(healthyOutputDirectory, "release-concurrency-trend.md"));
  assert.equal(healthy.safe, true);
  assert.equal(healthy.peakActiveShards, 2);
  assert.equal(peak, 2);
  assert.equal(healthy.allShardsStarted, true);
  assert.equal(healthy.timeoutFailures, 0);
  assert.equal(healthy.lockFailures, 0);
  assert.match(
    formatConcurrencyStressMarkdown(healthy, "tmp/stress"),
    /Setup time: \d+ms/,
  );
  assert.match(
    formatConcurrencyStressMarkdown(healthy, "tmp/stress"),
    /Peak active shards: 2/,
  );
  const noBaseline = compareConcurrencyStressReports(healthy);
  assert.equal(noBaseline.status, "NO BASELINE");
  assert.equal(noBaseline.setup, null);
  assert.match(
    formatConcurrencyComparisonMarkdown(noBaseline),
    /No comparison was possible/,
  );
  const baseline = {
    ...healthy,
    setupElapsedMs: 100_000,
    totalElapsedMs: 200_000,
  };
  const regressed = compareConcurrencyStressReports(
    {
      ...healthy,
      setupElapsedMs: 130_000,
      totalElapsedMs: 250_000,
    },
    baseline,
  );
  assert.equal(regressed.status, "REGRESSION");
  assert.equal(regressed.setup?.meaningfulRegression, true);
  assert.equal(regressed.totalWallClock?.meaningfulRegression, true);
  assert.match(
    formatConcurrencyComparisonMarkdown(regressed),
    /ALERT: setup time and total wall-clock time/,
  );
  const trend = summarizeConcurrencyStressTrend(
    { ...healthy, setupElapsedMs: 140_000, totalElapsedMs: 240_000 },
    [
      {
        runId: "newest-healthy",
        createdAt: "2026-09-02T10:00:00Z",
        report: {
          ...healthy,
          setupElapsedMs: 120_000,
          totalElapsedMs: 220_000,
        },
      },
      { runId: "malformed", report: { ...healthy, setupElapsedMs: "slow" } },
      {
        runId: "oldest-healthy",
        createdAt: "2026-09-01T10:00:00Z",
        report: {
          ...healthy,
          setupElapsedMs: 100_000,
          totalElapsedMs: 200_000,
        },
      },
      { runId: "unsafe", report: { ...healthy, safe: false } },
    ],
  );
  assert.equal(trend.historicalSampleCount, 2);
  assert.equal(trend.ignoredHistoricalArtifactCount, 2);
  assert.equal(trend.currentRunIncluded, true);
  assert.equal(trend.points.length, 3);
  assert.deepEqual(
    trend.points.map((point) => point.setupMs),
    [100_000, 120_000, 140_000],
  );
  assert.equal(trend.setup?.averageMs, 120_000);
  assert.equal(trend.totalWallClock?.changeMs, 40_000);
  assert.match(
    formatConcurrencyTrendMarkdown(trend),
    /Informational trend only/,
  );
  const boundedTrend = summarizeConcurrencyStressTrend(
    healthy,
    Array.from({ length: 7 }, (_, index) => ({
      runId: `healthy-${index}`,
      report: healthy,
    })),
  );
  assert.equal(boundedTrend.historicalSampleCount, 5);
  assert.equal(boundedTrend.ignoredHistoricalArtifactCount, 2);
  const withinNoise = compareConcurrencyStressReports(
    { ...healthy, setupElapsedMs: 129_999, totalElapsedMs: 249_999 },
    baseline,
  );
  assert.equal(withinNoise.status, "PASS");
  assert.doesNotThrow(() =>
    validateStressEnvironment({
      DATABASE_URL: "postgresql://disposable.example/test",
      NODE_ENV: "test",
      RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB: "1",
    }),
  );
  assert.throws(
    () =>
      validateStressEnvironment({
        DATABASE_URL: "postgresql://unconfirmed.example/test",
        NODE_ENV: "test",
      }),
    /APPROVED_DISPOSABLE_DB=1/,
  );

  const unsafeRunner: StressRunStep = async (step, options) => {
    options?.onOutput?.("vitest setup complete\n");
    return step.label === "shard two"
      ? {
          exitCode: 124,
          elapsedMs: 5,
          status: "INFRASTRUCTURE TIMEOUT",
          output: "deadlock detected while waiting for lock",
        }
      : { exitCode: 0, elapsedMs: 5, status: "PASS", output: "" };
  };
  const unsafe = await runConcurrencyStress(steps.slice(0, 2), {
    concurrencyCap: 2,
    runStepFn: unsafeRunner,
  });
  assert.equal(unsafe.safe, false);
  assert.equal(unsafe.timeoutFailures, 1);
  assert.equal(unsafe.lockFailures, 1);
  assert.match(unsafe.unsafeReasons.join("\n"), /timeout|lock/i);

  console.log(
    "Release concurrency stress tests passed (cap, peak tracking, metrics, unsafe diagnostics).",
  );
}

await run();
