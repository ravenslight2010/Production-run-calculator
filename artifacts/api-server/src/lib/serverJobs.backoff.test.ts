import { afterEach, describe, expect, it, vi } from "vitest";

const backgroundMocks = vi.hoisted(() => ({
  runBackgroundOperation: vi.fn(),
  backoffOptions: [] as Array<{ jitter?: boolean }>,
}));

vi.mock("./backgroundOperations", async () => {
  const actual = await vi.importActual<typeof import("./backgroundOperations")>("./backgroundOperations");
  return {
    ...actual,
    createBackgroundOperationBackoff: (options: { jitter?: boolean } = {}) => {
      backgroundMocks.backoffOptions.push(options);
      return actual.createBackgroundOperationBackoff(options);
    },
    runBackgroundOperation: backgroundMocks.runBackgroundOperation,
  };
});

const { serverJobBackgroundFailureFields, startServerJobWorkerLoop } = await import("./serverJobs");

describe("server job scheduler backoff", () => {
  afterEach(() => {
    vi.useRealTimers();
    backgroundMocks.runBackgroundOperation.mockReset();
    backgroundMocks.backoffOptions = [];
  });

  it("suppresses a poll after repeated failed passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    backgroundMocks.runBackgroundOperation.mockRejectedValue(new Error("database unavailable"));
    const loop = startServerJobWorkerLoop({
      worker: { runOnce: vi.fn(async () => false) },
      prune: vi.fn(async () => 0),
      concurrency: 2,
      intervalMs: 1_000,
      pruneIntervalMs: 60_000,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(backgroundMocks.runBackgroundOperation).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(backgroundMocks.runBackgroundOperation).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(backgroundMocks.runBackgroundOperation).toHaveBeenCalledTimes(4);
    } finally {
      loop.stop();
    }
  });

  it("reports the failed worker stage with bounded elapsed time", async () => {
    vi.useFakeTimers();
    const failure = new Error("private database details");
    const onError = vi.fn();
    const monotonicNow = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(2_600);
    backgroundMocks.runBackgroundOperation.mockRejectedValue(failure);
    const loop = startServerJobWorkerLoop({
      worker: { runOnce: vi.fn(async () => false) },
      prune: vi.fn(async () => 0),
      concurrency: 1,
      intervalMs: 60_000,
      pruneIntervalMs: 60_000,
      now: () => 0,
      monotonicNow,
      onError,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledWith(failure, "run", 2_500);
    } finally {
      loop.stop();
    }
  });

  it("uses jittered worker retries and emits only bounded failure fields", async () => {
    vi.useFakeTimers();
    const failure = Object.assign(new Error("private database details"), { code: "57014" });
    backgroundMocks.runBackgroundOperation.mockResolvedValue(false);
    const loop = startServerJobWorkerLoop({
      worker: { runOnce: vi.fn(async () => false) },
      prune: vi.fn(async () => 0),
      concurrency: 1,
      now: () => 0,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(backgroundMocks.backoffOptions).toEqual([{ jitter: true }, { jitter: true }]);
    } finally {
      loop.stop();
    }

    const fields = serverJobBackgroundFailureFields(failure, "run", 10);
    expect(fields).toEqual({
      operation: "run",
      outcome: "degraded",
      errorCode: "server_job_run_failed",
      failureStage: "run",
      failureReason: "database-timeout",
      durationMs: 10,
    });
    expect(JSON.stringify(fields)).not.toContain("private database details");
  });
});