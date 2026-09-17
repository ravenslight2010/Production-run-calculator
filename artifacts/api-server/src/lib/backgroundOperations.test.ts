import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_OPERATION_FAILURE_THRESHOLD,
  BACKGROUND_OPERATION_FAILURE_WINDOW_MS,
  backgroundOperationsDegraded,
  clearBackgroundOperationDiagnosticsForTests,
  getBackgroundOperationDiagnostics,
  isTransientDatabaseConnectionError,
  runBackgroundOperation,
} from "./backgroundOperations";

describe("background operation connection recovery", () => {
  beforeEach(async () => clearBackgroundOperationDiagnosticsForTests());

  it("characterizes terminated PostgreSQL and network connections as transient", () => {
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("terminating connection"), { code: "57P01" }))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("Timeout exceeded when trying to connect"))).toBe(false);
    expect(isTransientDatabaseConnectionError(new Error("Job execution timed out"))).toBe(false);
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("bad query"), { code: "23505" }))).toBe(false);
  });

  it("retries a bounded pool-acquisition timeout once and clears degradation after recovery", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"))
      .mockResolvedValueOnce("recovered");
    const delay = vi.fn(async () => {});

    await expect(runBackgroundOperation("daily-rollover", operation, { delay })).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect((await getBackgroundOperationDiagnostics())["daily-rollover"]).toMatchObject({
      status: "ok",
      recentFailureCount: 0,
    });
  });

  it("does not retry non-transient failures and exposes sustained degradation", async () => {
    const failure = Object.assign(new Error("invalid operation"), { code: "23505" });
    const operation = vi.fn(async () => { throw failure; });
    for (let attempt = 0; attempt < BACKGROUND_OPERATION_FAILURE_THRESHOLD; attempt += 1) {
      await expect(runBackgroundOperation("web-push-schedule", operation)).rejects.toBe(failure);
    }
    expect(operation).toHaveBeenCalledTimes(BACKGROUND_OPERATION_FAILURE_THRESHOLD);
    const diagnostics = await getBackgroundOperationDiagnostics();
    expect(backgroundOperationsDegraded(diagnostics)).toBe(true);
    expect(diagnostics["web-push-schedule"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      errorCode: "23505",
    });
    expect((await getBackgroundOperationDiagnostics(Date.now() + BACKGROUND_OPERATION_FAILURE_WINDOW_MS + 1))
      ["web-push-schedule"]).toMatchObject({ status: "ok", recentFailureCount: 0 });
  });

  it("retains sustained degradation after process-local diagnostics are cleared", async () => {
    const failure = Object.assign(new Error("worker unavailable"), { code: "57P03" });
    for (let attempt = 0; attempt < BACKGROUND_OPERATION_FAILURE_THRESHOLD; attempt += 1) {
      await expect(runBackgroundOperation(
        "server-job-run",
        async () => { throw failure; },
        { delay: async () => {} },
      )).rejects.toBe(failure);
    }

    await clearBackgroundOperationDiagnosticsForTests({ preserveShared: true });

    expect((await getBackgroundOperationDiagnostics())["server-job-run"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      errorCode: "57P03",
    });
  });

  it("recovers from retained failures after a later successful pass", async () => {
    const failedAt = Date.parse("2030-01-01T00:00:00.000Z");
    const recoveredAt = failedAt + 1_000;
    const failure = Object.assign(new Error("worker unavailable"), { code: "57P03" });
    for (let attempt = 0; attempt < BACKGROUND_OPERATION_FAILURE_THRESHOLD; attempt += 1) {
      await expect(runBackgroundOperation(
        "server-job-run",
        async () => { throw failure; },
        { delay: async () => {}, now: () => failedAt },
      )).rejects.toBe(failure);
    }

    await clearBackgroundOperationDiagnosticsForTests({ preserveShared: true });
    await expect(runBackgroundOperation(
      "server-job-run",
      async () => "recovered",
      { now: () => recoveredAt },
    )).resolves.toBe("recovered");

    expect((await getBackgroundOperationDiagnostics(recoveredAt))["server-job-run"]).toMatchObject({
      status: "ok",
      recentFailureCount: 0,
      lastSuccessAt: new Date(recoveredAt).toISOString(),
    });
    expect((await getBackgroundOperationDiagnostics(recoveredAt))["server-job-run"])
      .not.toHaveProperty("lastFailureAt");
    expect((await getBackgroundOperationDiagnostics(recoveredAt))["server-job-run"])
      .not.toHaveProperty("errorCode");
  });

  it("treats a success at the same timestamp as recovery from that failure", async () => {
    const now = Date.parse("2030-01-01T00:00:00.000Z");
    const failure = Object.assign(new Error("worker unavailable"), { code: "57P03" });
    await expect(runBackgroundOperation(
      "server-job-run",
      async () => { throw failure; },
      { delay: async () => {}, now: () => now },
    )).rejects.toBe(failure);
    await runBackgroundOperation("server-job-run", async () => false, { now: () => now });

    expect((await getBackgroundOperationDiagnostics(now))["server-job-run"]).toMatchObject({
      status: "ok",
      recentFailureCount: 0,
    });
  });

  it("still degrades after enough failures newer than the latest success", async () => {
    const recoveredAt = Date.parse("2030-01-01T00:00:00.000Z");
    await runBackgroundOperation(
      "server-job-run",
      async () => "healthy",
      { now: () => recoveredAt },
    );
    const failure = Object.assign(new Error("worker unavailable"), { code: "57P03" });
    for (let attempt = 1; attempt <= BACKGROUND_OPERATION_FAILURE_THRESHOLD; attempt += 1) {
      await expect(runBackgroundOperation(
        "server-job-run",
        async () => { throw failure; },
        { delay: async () => {}, now: () => recoveredAt + attempt },
      )).rejects.toBe(failure);
    }

    expect((await getBackgroundOperationDiagnostics(
      recoveredAt + BACKGROUND_OPERATION_FAILURE_THRESHOLD,
    ))["server-job-run"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      errorCode: "57P03",
    });
  });

  it("does not retain arbitrary error-code payloads", async () => {
    const unsafe = Object.assign(new Error("failed"), {
      code: "customer@example.com secret payload",
    });
    await expect(runBackgroundOperation(
      "server-job-prune",
      async () => { throw unsafe; },
    )).rejects.toBe(unsafe);

    expect((await getBackgroundOperationDiagnostics())["server-job-prune"]).toMatchObject({
      errorCode: "operation_failed",
    });
  });
});