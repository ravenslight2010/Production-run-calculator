import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFieldCheckObserver,
  emitFieldCheckSignal,
  FIELD_CHECK_SIGNAL_EVENT,
  FIELD_CHECK_CATALOG,
  productionRunSaveFailureLabel,
  PRODUCTION_RUN_SAVE_FAILURE_CODES,
  SYNC_ACK_FAILURE_CODES,
  fieldCheckDiagnosticLabel,
} from "./fieldChecks";
import { recordPerformance } from "./performanceDiagnostics";

const submit = vi.hoisted(() => vi.fn().mockResolvedValue({ accepted: 1, duplicate: 0 }));
vi.mock("./inventoryShared", () => ({ submitFieldCheckObservations: submit }));

describe("field-check observer", () => {
  beforeEach(() => {
    localStorage.clear();
    submit.mockReset().mockResolvedValue({ accepted: 1, duplicate: 0 });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("records naturally occurring signals without duplicating a ten-minute bucket", async () => {
    const stop = createFieldCheckObserver("test-build");
    emitFieldCheckSignal("sync-acknowledgment", "success", { latencyMs: 12.345 });
    emitFieldCheckSignal("sync-acknowledgment", "success", { latencyMs: 12.345 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit).toHaveBeenCalled();
    const observations = submit.mock.calls.flatMap((call) => call[0]);
    expect(observations).toHaveLength(2);
    expect(observations.every((item: { appBuild: string }) => item.appBuild === "test-build")).toBe(true);
    const syncObservations = observations.filter((item: { checkName: string }) =>
      item.checkName === "sync-acknowledgment",
    );
    expect(syncObservations).toHaveLength(1);
    expect(syncObservations[0].metrics).toEqual({});
    stop();
  });

  it("does not collect unsupported hardware checks", () => {
    const stop = createFieldCheckObserver("test-build");
    emitFieldCheckSignal("touch-accuracy", "success");
    expect(window.dispatchEvent).toBeDefined();
    expect(localStorage.getItem("run-calc-field-check-queue")).not.toContain("touch-accuracy");
    stop();
  });

  it("uses a browser event boundary for sync signals", () => {
    const listener = vi.fn();
    window.addEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);
    emitFieldCheckSignal("foreground-recovery", "success");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);
  });

  it("keeps workflow metrics bounded and includes only allowlisted save failure causes", async () => {
    const stop = createFieldCheckObserver("test-build");
    emitFieldCheckSignal("spec-import-review-commit", "incomplete", {
      durationMs: 12.345,
      fileCount: 2,
      recipeCount: 7,
    });
    emitFieldCheckSignal("production-run-save-sync", "failure", {
      durationMs: 80.128,
      failureCode: PRODUCTION_RUN_SAVE_FAILURE_CODES.staleOrResetWrite,
      status: 401,
    });
    emitFieldCheckSignal("production-run-save-sync", "success", {
      durationMs: 15,
      failureCode: PRODUCTION_RUN_SAVE_FAILURE_CODES.authenticationRejected,
    });
    emitFieldCheckSignal("production-run-save-sync", "failure", {
      durationMs: 25,
      failureCode: 99,
    });
    emitFieldCheckSignal("spec-import-review-commit", "failure", {
      durationMs: 15 * 60 * 1000 + 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const observations = submit.mock.calls.flatMap((call) => call[0]);
    const workflow = observations.find((item: { checkName: string }) =>
      item.checkName === "spec-import-review-commit",
    );
    expect(workflow?.outcome).toBe("incomplete");
    expect(workflow?.metrics).toEqual({ durationMs: 12.35 });
    expect(JSON.stringify(workflow)).not.toMatch(/fileCount|recipeCount/);
    const saveFailure = observations.find((item: { checkName: string; outcome: string }) =>
      item.checkName === "production-run-save-sync" && item.outcome === "failure",
    );
    expect(saveFailure?.metrics).toEqual({
      durationMs: 80.13,
      failureCode: PRODUCTION_RUN_SAVE_FAILURE_CODES.staleOrResetWrite,
    });
    expect(saveFailure?.observationId).toContain(":production-run-save-sync:v3:");
    const saveSuccess = observations.find((item: { checkName: string; outcome: string }) =>
      item.checkName === "production-run-save-sync" && item.outcome === "success",
    );
    expect(saveSuccess?.metrics).toEqual({ durationMs: 15 });
    expect(productionRunSaveFailureLabel(PRODUCTION_RUN_SAVE_FAILURE_CODES.authenticationRejected))
      .toBe("Login or permission rejected");
    expect(productionRunSaveFailureLabel(99)).toBeNull();
    expect(observations.filter((item: { checkName: string }) =>
      item.checkName === "spec-import-review-commit" && item.outcome === "failure",
    )).toHaveLength(0);
    stop();
  });

  it("keeps visual and physical checks out of passive collection", () => {
    expect(FIELD_CHECK_CATALOG.find((check) => check.name === "offline-queue-replay")?.observedBy).toBe("browser");
    for (const name of ["orientation-layout", "safe-area-clearance", "camera-file-selection", "update-handoff"]) {
      expect(FIELD_CHECK_CATALOG.find((check) => check.name === name)?.observedBy).toBe("hardware");
    }
  });

  it("retains distinct sync causes, recovery and builds, without raw diagnostics", async () => {
    const stop = createFieldCheckObserver("local");
    for (const failureCode of Object.values(SYNC_ACK_FAILURE_CODES)) {
      emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode, runId: 123, response: 403 });
      emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode });
    }
    emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode: 99 });
    emitFieldCheckSignal("sync-acknowledgment", "success");
    emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    const stopNextBuild = createFieldCheckObserver("identified-build");
    emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopNextBuild();
    const sync = submit.mock.calls.flatMap((call) => call[0])
      .filter((item: { checkName: string }) => item.checkName === "sync-acknowledgment");
    expect(sync).toHaveLength(6);
    expect(sync.slice(0, 3).map((item: { metrics: unknown }) => item.metrics)).toEqual([
      { failureCode: 1 }, { failureCode: 2 }, { failureCode: 3 },
    ]);
    expect(sync[3].outcome).toBe("success");
    expect(sync[4].metrics).toEqual({ failureCode: 3 });
    expect(sync[4].observationId).not.toBe(sync[2].observationId);
    expect(sync[5].appBuild).toBe("identified-build");
    expect(new Set(sync.map((item: { observationId: string }) => item.observationId)).size).toBe(6);
    expect(JSON.stringify(sync)).not.toMatch(/runId|response/);
  });

  it("classifies selected timings at their existing budgets and separates safe sources", async () => {
    const stop = createFieldCheckObserver("local");
    recordPerformance("startup:home-chunk-load", 10_000, "load");
    recordPerformance("startup:home-chunk-load", 10_001, "load");
    recordPerformance("browser:navigation-to-load", 1500, "load");
    recordPerformance("browser:navigation-to-load", 1501, "load");
    recordPerformance("api-failure:/api/private-run-id:timeout", 2000, "api");
    recordPerformance("api-failure:/api/private-run-id:network", 2001, "api");
    recordPerformance("api-failure:/api/private-run-id:unknown", 3000, "api");
    recordPerformance("hmr:update", 5000, "hmr");
    emitFieldCheckSignal("performance", "failure", { durationMs: 10, sourceCode: 99 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    const samples = submit.mock.calls.flatMap((call) => call[0])
      .filter((item: { checkName: string }) => item.checkName === "performance");
    expect(samples.map((item: { outcome: string; metrics: unknown }) => [item.outcome, item.metrics])).toEqual([
      ["success", { durationMs: 10_000, sourceCode: 1 }],
      ["failure", { durationMs: 10_001, sourceCode: 1 }],
      ["success", { durationMs: 1500, sourceCode: 2 }],
      ["failure", { durationMs: 1501, sourceCode: 2 }],
      ["failure", { durationMs: 2000, sourceCode: 3 }],
      ["failure", { durationMs: 2001, sourceCode: 4 }],
    ]);
    expect(JSON.stringify(samples)).not.toContain("private-run-id");
    expect(fieldCheckDiagnosticLabel("performance", {})).toContain("older evidence");
    expect(fieldCheckDiagnosticLabel("sync-acknowledgment", { failureCode: 2 })).toContain("stale/reset");
  });

  it("retains a very slow event as a capped duration instead of dropping its failure", async () => {
    const stop = createFieldCheckObserver("local");
    recordPerformance("browser:navigation-to-load", 10_000_001, "load");
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    const sample = submit.mock.calls.flatMap((call) => call[0])
      .find((item: { checkName: string }) => item.checkName === "performance");
    expect(sample).toMatchObject({ outcome: "failure", metrics: { durationMs: 10_000_000, sourceCode: 2 } });
    expect(fieldCheckDiagnosticLabel("performance", sample.metrics)).toContain("≥10000000 ms");
  });

  it("backs off a failed delivery instead of retrying in a hot loop", async () => {
    vi.useFakeTimers();
    submit.mockRejectedValue(Object.assign(new Error("rate limited"), {
      retryAfterMs: 5_000,
    }));
    const stop = createFieldCheckObserver("test-build");

    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(submit).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});