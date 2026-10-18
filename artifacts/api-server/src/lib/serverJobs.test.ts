import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertBoundedJobInput,
  assertBoundedJobResult,
  createScheduledEvaluationQueueMonitor,
  getServerJobDefinition,
  registerServerJob,
  SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS,
  startServerJobWorkerLoop,
} from "./serverJobs";

function queueSample(queued: number, duplicateTimeBucketGroups = 0) {
  return {
    queued,
    running: 1,
    terminalLastWindow: { succeeded: 2, failed: 0, cancelled: 0 },
    duplicateTimeBucketGroups,
    duplicateGroupsTruncated: false,
    duplicateBucketInventory: [],
    duplicateBucketInventoryTruncated: false,
  };
}

describe("server job contract boundaries", () => {
  it("keeps only declared workload types and bounded JSON inputs", () => {
    expect(getServerJobDefinition("workbook-parse")?.capability).toBe("use-ai-tools");
    expect(() => registerServerJob("not valid", { capability: "manage-profiles" })).toThrow("Invalid");
    expect(() => registerServerJob("too-many-retries", { capability: "manage-profiles", maxAttempts: 6 })).toThrow("between 1 and 5");
    expect(() => assertBoundedJobInput({ content: "x".repeat(513 * 1024) })).toThrow("exceeds");
    expect(() => assertBoundedJobResult({ content: "x".repeat(513 * 1024) })).toThrow("exceeds");
    expect(() => assertBoundedJobInput({ content: "small immutable snapshot" })).not.toThrow();
    // The existing flattened workbook parse contract allows 60,000 characters;
    // its serialized snapshot must fit before a worker accepts it.
    expect(() => assertBoundedJobInput({ workbookText: "x".repeat(60_000), known: { brands: ["Factory"] } })).not.toThrow();
  });

  it("starts no more than the configured number of in-process jobs", async () => {
    const pending: Array<() => void> = [];
    const runOnce = vi.fn(() => new Promise<boolean>((resolve) => pending.push(() => resolve(false))));
    const prune = vi.fn(async () => 0);
    const loop = startServerJobWorkerLoop({
      worker: { runOnce }, prune, concurrency: 2, intervalMs: 60_000, pruneIntervalMs: 60_000,
    });
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledTimes(1);
    loop.stop();
    pending.splice(0).forEach((resolve) => resolve());
  });
});

describe("scheduled evaluation queue monitoring", () => {
  it("does not warn when the backlog shrinks across the monitoring window", () => {
    const monitor = createScheduledEvaluationQueueMonitor();
    const queued = [8, 7, 6, 5, 3, 2];

    queued.forEach((count, index) => {
      monitor.observe(queueSample(count), index * SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS);
    });

    expect(monitor.getDiagnostics()).toMatchObject({
      status: "ok",
      queued: 2,
      terminalLastWindow: { succeeded: 2, failed: 0, cancelled: 0 },
      warningCodes: [],
      sampleCount: 6,
    });
  });

  it.each([
    { trend: "stalled", values: [4, 4, 4, 4, 4, 4], warningCode: "backlog_stalled" },
    { trend: "growing", values: [2, 3, 4, 5, 6, 7], warningCode: "backlog_growing" },
  ] as const)("warns after a sustained $trend backlog", ({ values, warningCode }) => {
    const monitor = createScheduledEvaluationQueueMonitor();

    values.forEach((count, index) => {
      monitor.observe(queueSample(count), index * SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS);
    });

    expect(monitor.getDiagnostics()).toMatchObject({
      status: "warning",
      queued: values.at(-1),
      warningCodes: [warningCode],
      sampleCount: 6,
    });
  });

  it("warns when duplicate scope/time-bucket groups persist across samples", () => {
    const monitor = createScheduledEvaluationQueueMonitor();
    monitor.observe(queueSample(0, 1), 0);
    expect(monitor.getDiagnostics().warningCodes).toEqual([]);

    const transition = monitor.observe(queueSample(0, 1), SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS);

    expect(transition.started).toEqual(["duplicate_time_buckets"]);
    expect(transition.diagnostics).toMatchObject({
      status: "warning",
      duplicateTimeBucketGroups: 1,
      warningCodes: ["duplicate_time_buckets"],
      duplicateBucketReviewRules: expect.arrayContaining([
        expect.stringContaining("Preserve queued jobs"),
        expect.stringContaining("without a lease"),
      ]),
    });
    expect(JSON.stringify(transition.diagnostics)).not.toMatch(/scope|idempotency|input|result/i);
  });

  it.each([
    { direction: "increasing", values: [2, 5], change: 3 },
    { direction: "stable", values: [2, 2], change: 0 },
    { direction: "decreasing", values: [5, 2], change: -3 },
  ] as const)("reports an aggregate $direction duplicate-group trend", ({ direction, values, change }) => {
    const monitor = createScheduledEvaluationQueueMonitor();
    values.forEach((count, index) => {
      monitor.observe(queueSample(0, count), index * SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS);
    });

    expect(monitor.getDiagnostics().duplicateGroupTrend).toEqual({
      direction,
      firstCount: values[0],
      latestCount: values[1],
      change,
    });
  });

  it("uses only the retained monitoring window and restarts comparison after a long gap", () => {
    const monitor = createScheduledEvaluationQueueMonitor();
    const interval = SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS;
    for (let count = 1; count <= 8; count += 1) {
      monitor.observe(queueSample(0, count), (count - 1) * interval);
    }
    expect(monitor.getDiagnostics()).toMatchObject({
      sampleCount: 6,
      duplicateGroupTrend: {
        direction: "increasing",
        firstCount: 3,
        latestCount: 8,
        change: 5,
      },
    });

    monitor.observe(queueSample(0, 20), 11 * interval);
    expect(monitor.getDiagnostics()).toMatchObject({
      sampleCount: 1,
      duplicateGroupTrend: {
        direction: "insufficient_samples",
        firstCount: 20,
        latestCount: 20,
        change: 0,
      },
    });
  });

  it("labels unavailable samples without treating missing data as queue recovery", () => {
    const monitor = createScheduledEvaluationQueueMonitor();
    monitor.observe(queueSample(5, 2), 0);
    monitor.markUnavailable();

    expect(monitor.getDiagnostics()).toMatchObject({
      status: "ok",
      sampleAvailability: "unavailable",
      queued: 5,
      sampleCount: 1,
      duplicateGroupTrend: {
        direction: "unavailable",
        firstCount: null,
        latestCount: null,
        change: null,
      },
    });

    const recovered = monitor.observe(queueSample(3), SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS);
    expect(recovered.diagnostics).toMatchObject({
      status: "ok",
      sampleAvailability: "available",
      queued: 3,
      sampleCount: 2,
    });
  });

  it("retains exact duplicate-group totals above the bounded inventory limit", () => {
    const monitor = createScheduledEvaluationQueueMonitor();
    const sample = queueSample(50_000, 101);
    sample.duplicateGroupsTruncated = true;
    sample.duplicateBucketInventoryTruncated = true;

    const diagnostics = monitor.observe(sample, 0).diagnostics;

    expect(diagnostics).toMatchObject({
      queued: 50_000,
      duplicateTimeBucketGroups: 101,
      duplicateGroupsTruncated: true,
      duplicateBucketInventoryTruncated: true,
      sampleAvailability: "available",
    });
  });
});
