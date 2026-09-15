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
  beforeEach(() => clearBackgroundOperationDiagnosticsForTests());

  it("characterizes terminated PostgreSQL and network connections as transient", () => {
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("terminating connection"), { code: "57P01" }))).toBe(true);
    expect(isTransientDatabaseConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientDatabaseConnectionError(Object.assign(new Error("bad query"), { code: "23505" }))).toBe(false);
  });

  it("retries once on a fresh pool checkout and clears degradation after recovery", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Connection terminated unexpectedly"), { code: "57P01" }))
      .mockResolvedValueOnce("recovered");
    const delay = vi.fn(async () => {});

    await expect(runBackgroundOperation("daily-rollover", operation, { delay })).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(getBackgroundOperationDiagnostics()["daily-rollover"]).toMatchObject({
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
    expect(backgroundOperationsDegraded()).toBe(true);
    expect(getBackgroundOperationDiagnostics()["web-push-schedule"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      errorCode: "23505",
    });
    expect(getBackgroundOperationDiagnostics(Date.now() + BACKGROUND_OPERATION_FAILURE_WINDOW_MS + 1)
      ["web-push-schedule"]).toMatchObject({ status: "ok", recentFailureCount: 0 });
  });
});