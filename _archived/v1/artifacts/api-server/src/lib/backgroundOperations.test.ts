import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_OPERATION_FAILURE_THRESHOLD,
  BACKGROUND_OPERATION_FAILURE_WINDOW_MS,
  AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP,
  backgroundOperationsDegraded,
  classifyBackgroundFailure,
  clearBackgroundOperationDiagnosticsForTests,
  createBackgroundOperationBackoff,
  getAutoTrackDeferredDiagnostic,
  getBackgroundOperationDiagnostics,
  isTransientDatabaseConnectionError,
  recordAutoTrackDeferredRetries,
  runBackgroundOperation,
} from "./backgroundOperations";

describe("background operation connection recovery", () => {
  beforeEach(async () => clearBackgroundOperationDiagnosticsForTests());

  it("backs off repeated scheduler failures and resets after a successful pass", () => {
    const backoff = createBackgroundOperationBackoff({ baseDelayMs: 100, maxDelayMs: 250 });

    expect(backoff.isReady(0)).toBe(true);
    backoff.recordFailure(0);
    expect(backoff.isReady(99)).toBe(false);
    expect(backoff.nextRetryAt(99)).toBe(100);
    expect(backoff.isReady(100)).toBe(true);
    expect(backoff.nextRetryAt(100)).toBeUndefined();
    backoff.recordFailure(100);
    expect(backoff.isReady(299)).toBe(false);
    expect(backoff.isReady(300)).toBe(true);
    backoff.recordFailure(300);
    expect(backoff.isReady(549)).toBe(false);
    expect(backoff.isReady(550)).toBe(true);

    backoff.recordSuccess(550);
    expect(backoff.isReady(550)).toBe(true);
    backoff.recordFailure(550);
    expect(backoff.isReady(649)).toBe(false);
    expect(backoff.isReady(650)).toBe(true);
  });

  it("reports only a bounded aggregate and advances its next eligible time", () => {
    const now = Date.parse("2030-01-01T00:00:00.000Z");
    const retryTimes = Array.from(
      { length: AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP + 3 },
      (_, index) => now + (index + 1) * 1_000,
    );
    recordAutoTrackDeferredRetries(retryTimes);

    expect(getAutoTrackDeferredDiagnostic(now)).toEqual({
      deferredDateCount: AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP,
      deferredDateCountCapped: true,
      nextEligibleRetryAt: new Date(now + 1_000).toISOString(),
    });
    expect(getAutoTrackDeferredDiagnostic(now + 5_000)).toEqual({
      deferredDateCount: AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP - 2,
      deferredDateCountCapped: false,
      nextEligibleRetryAt: new Date(now + 6_000).toISOString(),
    });
    expect(getAutoTrackDeferredDiagnostic(now + 103_000)).toEqual({
      deferredDateCount: 0,
      deferredDateCountCapped: false,
      nextEligibleRetryAt: null,
    });
  });

  it("characterizes terminated PostgreSQL and network connections as transient", () => {
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("terminating connection"), { code: "57P01" }))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("Timeout exceeded when trying to connect"))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("query failed", {
      cause: new Error("transaction failed", {
        cause: Object.assign(new Error("pool checkout timed out"), { code: "08006" }),
      }),
    }))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("Job execution timed out"))).toBe(false);
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("bad query"), { code: "23505" }))).toBe(false);
  });

  it("classifies operational failures with fixed safe labels", () => {
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "53300" })))
      .toBe("database-capacity");
    expect(classifyBackgroundFailure(new Error("query failed", {
      cause: Object.assign(new Error("private"), { code: "57014" }),
    }))).toBe("database-timeout");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "ECONNRESET" })))
      .toBe("dependency-connection");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "ECONNRESET" }), {
      assumeDatabase: true,
    })).toBe("database-connection");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "42501" })))
      .toBe("database-permission");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "42P01" })))
      .toBe("database-schema");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "40P01" })))
      .toBe("database-conflict");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "23505" })))
      .toBe("database-error");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "private-user-data" })))
      .toBe("unexpected");
    expect(classifyBackgroundFailure(new Error("timeout exceeded when trying to connect")))
      .toBe("database-timeout");
    expect(classifyBackgroundFailure(Object.assign(new Error("private"), { code: "ETIMEDOUT" })))
      .toBe("dependency-timeout");
  });

  it("recovers a wrapped pool-acquisition timeout without degrading readiness", async () => {
    const timeout = new Error("timeout exceeded when trying to connect");
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("database operation failed", { cause: timeout }))
      .mockResolvedValueOnce("recovered");

    await expect(runBackgroundOperation("daily-rollover", operation, {
      delay: async () => {},
    })).resolves.toBe("recovered");

    expect(operation).toHaveBeenCalledTimes(2);
    expect((await getBackgroundOperationDiagnostics())["daily-rollover"]).toMatchObject({
      status: "ok",
      recentFailureCount: 0,
    });
  });

  it("reports persistent pool-acquisition timeouts after one bounded retry per pass", async () => {
    const timeout = new Error("timeout exceeded when trying to connect");
    const operation = vi.fn(async () => { throw timeout; });
    for (let pass = 0; pass < BACKGROUND_OPERATION_FAILURE_THRESHOLD; pass += 1) {
      await expect(runBackgroundOperation("web-push-schedule", operation, {
        delay: async () => {},
      })).rejects.toBe(timeout);
    }

    expect(operation).toHaveBeenCalledTimes(BACKGROUND_OPERATION_FAILURE_THRESHOLD * 2);
    expect((await getBackgroundOperationDiagnostics())["web-push-schedule"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
    });
  });

  it("retries a bounded pool-acquisition timeout once and clears degradation after recovery", async () => {
    const timeout = new Error("timeout exceeded when trying to connect");
    const operation = vi.fn()
      .mockRejectedValueOnce(timeout)
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

  it("spreads retries with bounded equal jitter", () => {
    const samples = [0, 0.5, 0.99];
    const retryAt = samples.map((sample) => {
      const backoff = createBackgroundOperationBackoff({
        baseDelayMs: 1_000,
        maxDelayMs: 2_500,
        jitter: true,
        random: () => sample,
      });
      backoff.recordFailure(10_000);
      return backoff.nextRetryAt(10_000);
    });
    expect(retryAt).toEqual([10_500, 10_750, 10_995]);

    const cappedBackoff = createBackgroundOperationBackoff({
      baseDelayMs: 1_000,
      maxDelayMs: 2_500,
      jitter: true,
      random: () => 1,
    });
    for (let failure = 0; failure < 4; failure += 1) cappedBackoff.recordFailure(0);
    expect(cappedBackoff.nextRetryAt(0)).toBe(2_500);
  });

  it("does not retry non-transient failures and exposes sustained degradation", async () => {
    const failure = Object.assign(new Error("invalid operation"), { code: "23505" });
    const operation = vi.fn(async () => { throw failure; });
    for (let attempt = 1; attempt <= BACKGROUND_OPERATION_FAILURE_THRESHOLD; attempt += 1) {
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
    for (let attempt = 1; attempt <= BACKGROUND_OPERATION_FAILURE_THRESHOLD; attempt += 1) {
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
    const recoveredAt = Date.parse("2030-01-01T00:00:00.000Z");
    const failure = Object.assign(new Error("worker unavailable"), { code: "57P03" });
    for (let attempt = 1; attempt <= BACKGROUND_OPERATION_FAILURE_THRESHOLD; attempt += 1) {
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
