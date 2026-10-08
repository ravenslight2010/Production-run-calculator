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
    });
    expect(JSON.stringify(transition.diagnostics)).not.toMatch(/scope|idempotency|input|result/i);
  });
});
