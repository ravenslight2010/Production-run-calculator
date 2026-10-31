import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFieldCheckObserver,
  emitFieldCheckSignal,
  FIELD_CHECK_SIGNAL_EVENT,
  FIELD_CHECK_QUEUE_EVENT,
  getFieldCheckQueueStatus,
  FIELD_CHECK_QUEUE_MAX_AGE_MS,
  FIELD_CHECK_CATALOG,
  productionRunSaveFailureLabel,
  PRODUCTION_RUN_SAVE_FAILURE_CODES,
  SYNC_ACK_FAILURE_CODES,
  fieldCheckDiagnosticLabel,
} from "./fieldChecks";
import { recordPerformance } from "./performanceDiagnostics";
import { recordStaleAssetRecoveryAttempt } from "./pwaUpdateRecovery";

const submit = vi.hoisted(() => vi.fn().mockResolvedValue({ accepted: 1, duplicate: 0 }));
const TEST_SCOPE = "live:test-user";
vi.mock("./inventoryShared", () => ({ submitFieldCheckObservations: submit }));

describe("field-check observer", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    submit.mockReset().mockImplementation(async (observations: unknown[]) => ({
      accepted: observations.length,
      duplicate: 0,
    }));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("records naturally occurring signals without duplicating a ten-minute bucket", async () => {
    const stop = createFieldCheckObserver("test-build", TEST_SCOPE);
    emitFieldCheckSignal("sync-acknowledgment", "success", { latencyMs: 12.345 });
    emitFieldCheckSignal("sync-acknowledgment", "success", { latencyMs: 12.345 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit).toHaveBeenCalled();
    const observations = submit.mock.calls.flatMap((call) => call[0]);
    expect(observations).toHaveLength(2);
    expect(observations.every((item: { appBuild: string }) => item.appBuild === "test-build")).toBe(true);
    expect(observations.every((item: { originScope?: string }) => item.originScope === undefined)).toBe(true);
    const syncObservations = observations.filter((item: { checkName: string }) =>
      item.checkName === "sync-acknowledgment",
    );
    expect(syncObservations).toHaveLength(1);
    expect(syncObservations[0].metrics).toEqual({});
    stop();
  });

  it("keeps offline observations with their originating account across a scope switch", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const stopLive = createFieldCheckObserver("test-build", "live:account-a");
    emitFieldCheckSignal("offline-queue-replay", "failure");
    const liveQueue = JSON.parse(localStorage.getItem("run-calc-field-check-queue") ?? "[]");
    const queuedLiveId = liveQueue.find((item: { checkName: string }) =>
      item.checkName === "offline-queue-replay",
    )?.observationId;
    expect(queuedLiveId).toBeTruthy();
    expect(liveQueue.find((item: { observationId: string }) =>
      item.observationId === queuedLiveId,
    )).toMatchObject({ originScope: "live:account-a" });
    stopLive();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const stopSandbox = createFieldCheckObserver("test-build", "sandbox:account-b");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sandboxUploads = submit.mock.calls.flatMap((call) => call[0]);
    expect(sandboxUploads.length).toBeGreaterThan(0);
    expect(sandboxUploads.some((item: { observationId: string }) =>
      item.observationId === queuedLiveId,
    )).toBe(false);
    expect(JSON.parse(localStorage.getItem("run-calc-field-check-queue") ?? "[]"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          observationId: queuedLiveId,
          originScope: "live:account-a",
        }),
      ]));
    stopSandbox();

    submit.mockClear();
    const stopLiveAgain = createFieldCheckObserver("test-build", "live:account-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const liveUploads = submit.mock.calls.flatMap((call) => call[0]);
    expect(liveUploads.some((item: { observationId: string }) =>
      item.observationId === queuedLiveId,
    )).toBe(true);
    expect(getFieldCheckQueueStatus()).toMatchObject({ count: 0 });
    stopLiveAgain();
  });

  it("retains pre-scope queued evidence without sending it under a later account", async () => {
    const now = Date.now();
    localStorage.setItem("run-calc-field-check-queue", JSON.stringify([{
      observationId: "client:startup:legacy-unscoped",
      checkName: "startup",
      checkVersion: "3",
      outcome: "success",
      observedAt: new Date(now).toISOString(),
      appBuild: "older-build",
      deviceCategory: "desktop-chrome",
      metrics: {},
    }]));

    const stop = createFieldCheckObserver("test-build", "sandbox:account-b");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const submittedIds = submit.mock.calls.flatMap((call) => call[0])
      .map((item: { observationId: string }) => item.observationId);
    expect(submittedIds).not.toContain("client:startup:legacy-unscoped");
    expect(getFieldCheckQueueStatus()).toMatchObject({ count: 1, retryableCount: 1 });
    expect(JSON.parse(localStorage.getItem("run-calc-field-check-queue") ?? "[]"))
      .toEqual([expect.objectContaining({
        observationId: "client:startup:legacy-unscoped",
      })]);
    stop();
  });

  it("does not collect unsupported hardware checks", () => {
    const stop = createFieldCheckObserver("test-build", TEST_SCOPE);
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
    const stop = createFieldCheckObserver("test-build", TEST_SCOPE);
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
    expect(saveFailure?.observationId).toContain(":production-run-save-sync:v4:");
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

  it("reports bounded current-browser queue count and oldest age", () => {
    const now = Date.now();
    localStorage.setItem("run-calc-field-check-queue", JSON.stringify([
      {
        observationId: "client:startup:old",
        checkName: "startup",
        checkVersion: "3",
        outcome: "success",
        observedAt: new Date(now - 90_000).toISOString(),
        appBuild: "test-build",
        deviceCategory: "desktop-chrome",
        metrics: {},
      },
      {
        observationId: "client:sync:expired",
        checkName: "sync-acknowledgment",
        checkVersion: "3",
        outcome: "success",
        observedAt: new Date(now - FIELD_CHECK_QUEUE_MAX_AGE_MS).toISOString(),
        appBuild: "test-build",
        deviceCategory: "desktop-chrome",
        metrics: {},
      },
    ]));
    expect(getFieldCheckQueueStatus(now)).toEqual({
      available: true,
      count: 2,
      retryableCount: 2,
      expiredCount: 0,
      displacedCount: 0,
      oldestAgeMs: FIELD_CHECK_QUEUE_MAX_AGE_MS,
    });
  });

  it("matches the server's inclusive clock-window boundary in both directions", () => {
    const now = Date.now();
    const makeObservation = (offsetMs: number, observationId: string) => ({
      observationId,
      checkName: "startup",
      checkVersion: "3",
      outcome: "success",
      observedAt: new Date(now + offsetMs).toISOString(),
      appBuild: "test-build",
      deviceCategory: "desktop-chrome",
      metrics: {},
    });
    localStorage.setItem("run-calc-field-check-queue", JSON.stringify([
      makeObservation(-FIELD_CHECK_QUEUE_MAX_AGE_MS, "client:past-boundary"),
      makeObservation(FIELD_CHECK_QUEUE_MAX_AGE_MS, "client:future-boundary"),
      makeObservation(-FIELD_CHECK_QUEUE_MAX_AGE_MS - 1, "client:past-outside"),
      makeObservation(FIELD_CHECK_QUEUE_MAX_AGE_MS + 1, "client:future-outside"),
    ]));

    expect(getFieldCheckQueueStatus(now)).toMatchObject({
      count: 4,
      retryableCount: 2,
      expiredCount: 2,
    });
  });

  it("never submits queued diagnostics outside the server's clock window", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const outOfWindow = [
      {
        observationId: "client:past-outside",
        checkName: "startup",
        checkVersion: "3",
        outcome: "success",
        observedAt: new Date(now - FIELD_CHECK_QUEUE_MAX_AGE_MS - 1).toISOString(),
        appBuild: "test-build",
        deviceCategory: "desktop-chrome",
        metrics: {},
      },
      {
        observationId: "client:future-outside",
        checkName: "startup",
        checkVersion: "3",
        outcome: "success",
        observedAt: new Date(now + FIELD_CHECK_QUEUE_MAX_AGE_MS + 1).toISOString(),
        appBuild: "test-build",
        deviceCategory: "desktop-chrome",
        metrics: {},
      },
    ];
    localStorage.setItem("run-calc-field-check-queue", JSON.stringify(outOfWindow));
    let stop = () => {};

    try {
      stop = createFieldCheckObserver("test-build", TEST_SCOPE);
      await vi.advanceTimersByTimeAsync(0);

      const submittedIds = submit.mock.calls.flatMap((call) => call[0])
        .map((item: { observationId: string }) => item.observationId);
      expect(submittedIds).not.toContain("client:past-outside");
      expect(submittedIds).not.toContain("client:future-outside");
      expect(getFieldCheckQueueStatus()).toMatchObject({ expiredCount: 2 });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("keeps the local queue bounded and reports observations displaced by its cap", () => {
    const now = Date.now();
    localStorage.setItem("run-calc-field-check-queue", JSON.stringify(
      Array.from({ length: 80 }, (_, index) => ({
        observationId: `client:startup:${index}`,
        checkName: "startup",
        checkVersion: "3",
        outcome: "success",
        observedAt: new Date(now - index * 1_000).toISOString(),
        appBuild: "test-build",
        deviceCategory: "desktop-chrome",
        metrics: {},
      })),
    ));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const stop = createFieldCheckObserver("test-build", TEST_SCOPE);
    const stored = JSON.parse(localStorage.getItem("run-calc-field-check-queue") ?? "[]");

    expect(stored).toHaveLength(80);
    expect(stored.some((item: { observationId: string }) => item.observationId === "client:startup:0")).toBe(false);
    expect(getFieldCheckQueueStatus()).toMatchObject({
      available: true,
      count: 80,
      displacedCount: 1,
    });

    stop();
  });

  it("announces queue changes and confirms recovery only after a different-build authenticated startup", async () => {
    const changed = vi.fn();
    window.addEventListener(FIELD_CHECK_QUEUE_EVENT, changed);
    recordStaleAssetRecoveryAttempt("old-build", sessionStorage, Date.now() - 1000);
    const stop = createFieldCheckObserver("new-build", TEST_SCOPE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    window.removeEventListener(FIELD_CHECK_QUEUE_EVENT, changed);

    const observations = submit.mock.calls.flatMap((call) => call[0]);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkName: "stale-deployment-recovery", outcome: "success", metrics: {} }),
    ]));
    expect(changed).toHaveBeenCalled();
    expect(sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1")).toBeNull();
  });

  it.each(["read", "remove"] as const)(
    "does not report stale-deployment recovery success when session storage %s fails",
    async (failurePoint) => {
      const pendingMarker = new Map<string, string>();
      recordStaleAssetRecoveryAttempt("old-build", {
        getItem: (key) => pendingMarker.get(key) ?? null,
        setItem: (key, value) => void pendingMarker.set(key, value),
        removeItem: (key) => void pendingMarker.delete(key),
      }, Date.now() - 1000);
      const marker = pendingMarker.get("run-calc:stale-asset-recovery-pending:v1");
      expect(marker).toBeDefined();

      const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
      const unavailableStorage = {
        getItem: () => {
          if (failurePoint === "read") throw new Error("session storage is unavailable");
          return marker ?? null;
        },
        setItem: vi.fn(),
        removeItem: () => {
          if (failurePoint === "remove") throw new Error("session storage is unavailable");
        },
      };
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: unavailableStorage,
      });

      let stop = () => {};
      try {
        stop = createFieldCheckObserver("new-build", TEST_SCOPE);
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        stop();
        if (sessionStorageDescriptor) {
          Object.defineProperty(globalThis, "sessionStorage", sessionStorageDescriptor);
        } else {
          delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
        }
      }

      const observations = submit.mock.calls.flatMap((call) => call[0]);
      expect(observations.some((item: { checkName: string; outcome: string }) =>
        item.checkName === "stale-deployment-recovery" && item.outcome === "success",
      )).toBe(false);
    },
  );

  it("retains distinct sync causes, recovery and builds, without raw diagnostics", async () => {
    const stop = createFieldCheckObserver("local", TEST_SCOPE);
    for (const failureCode of Object.values(SYNC_ACK_FAILURE_CODES)) {
      emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode, runId: 123, response: 403 });
      emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode });
    }
    emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode: 99 });
    emitFieldCheckSignal("sync-acknowledgment", "success");
    emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    const stopNextBuild = createFieldCheckObserver("identified-build", TEST_SCOPE);
    emitFieldCheckSignal("sync-acknowledgment", "failure", { failureCode: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopNextBuild();
    const sync = submit.mock.calls.flatMap((call) => call[0])
      .filter((item: { checkName: string }) => item.checkName === "sync-acknowledgment");
    expect(sync).toHaveLength(7);
    expect(sync.slice(0, 4).map((item: { metrics: unknown }) => item.metrics)).toEqual([
      { failureCode: 1 }, { failureCode: 2 }, { failureCode: 3 }, { failureCode: 4 },
    ]);
    expect(sync[4].outcome).toBe("success");
    expect(sync[5].metrics).toEqual({ failureCode: 3 });
    expect(sync[5].observationId).not.toBe(sync[2].observationId);
    expect(sync[6].appBuild).toBe("identified-build");
    expect(new Set(sync.map((item: { observationId: string }) => item.observationId)).size).toBe(7);
    expect(JSON.stringify(sync)).not.toMatch(/runId|response/);
  });

  it("classifies page timings and ignores deprecated path-bearing API timing names", async () => {
    const stop = createFieldCheckObserver("local", TEST_SCOPE);
    recordPerformance("startup:home-chunk-load", 10_000, "load");
    recordPerformance("startup:home-chunk-load", 10_001, "load");
    recordPerformance("browser:navigation-to-load", 1500, "load");
    recordPerformance("browser:navigation-to-load", 1501, "load");
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
    ]);
    expect(fieldCheckDiagnosticLabel("performance", {})).toContain("older evidence");
    expect(fieldCheckDiagnosticLabel("sync-acknowledgment", { failureCode: 2 })).toContain("out of date or came after a reset");
    expect(fieldCheckDiagnosticLabel("sync-acknowledgment", { failureCode: 4 })).toContain("rejected the sync request");
  });

  it("queues a quick HTTP 500 with operation, elapsed time, observation, background and correlation evidence", async () => {
    const stop = createFieldCheckObserver("app-build:abc123", TEST_SCOPE);
    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "sync",
        requestOutcome: "http_server_error",
        elapsedMs: 52,
        observedAt: "2026-10-16T22:49:00.000Z",
        backgroundObserved: true,
        connectivity: "online",
        httpStatus: 500,
        correlationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    const sample = submit.mock.calls.flatMap((call) => call[0])
      .find((item: { checkName: string }) => item.checkName === "performance");
    expect(sample).toMatchObject({
      checkName: "performance",
      checkVersion: "4",
      outcome: "failure",
      appBuild: "app-build:abc123",
      reportedRequestCorrelationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
      metrics: {
        durationMs: 52,
        sourceCode: 5,
        outcomeCode: 1,
        operationCode: 6,
        backgroundCode: 1,
        httpStatusCode: 500,
      },
    });
    expect(fieldCheckDiagnosticLabel("performance", sample.metrics))
      .toContain("Server returned an error · syncing · server error · HTTP 500");
    expect(fieldCheckDiagnosticLabel("performance", sample.metrics))
      .toContain("Browser wait is not server processing time.");
  });

  it("stores cancelled and uncorrelated transport failures distinctly without inventing references", async () => {
    const stop = createFieldCheckObserver("app-build:abc123", TEST_SCOPE);
    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "authentication",
        requestRoute: "authentication",
        requestOutcome: "cancelled",
        cancellationClassification: "expected_auth_lifecycle",
        elapsedMs: 20,
        observedAt: new Date().toISOString(),
        backgroundObserved: false,
        connectivity: "online",
      },
    }));
    window.dispatchEvent(new CustomEvent("app:api-failure", {
      detail: {
        operationCategory: "inventory",
        requestOutcome: "cancelled",
        elapsedMs: 40,
        observedAt: new Date().toISOString(),
        backgroundObserved: false,
        connectivity: "online",
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    const sample = submit.mock.calls.flatMap((call) => call[0])
      .find((item: { checkName: string }) => item.checkName === "performance");
    expect(sample).toMatchObject({
      outcome: "incomplete",
      metrics: { sourceCode: 6, outcomeCode: 7, operationCode: 4, backgroundCode: 0 },
    });
    expect(fieldCheckDiagnosticLabel("performance", sample.metrics))
      .toContain("Request ended before a reply · loading inventory · cancelled before a reply");
    expect(fieldCheckDiagnosticLabel("performance", sample.metrics))
      .toContain("operating-system pause is unknown");
    expect(
      submit.mock.calls.flatMap((call) => call[0])
        .filter((item: { checkName: string }) => item.checkName === "performance"),
    ).toHaveLength(1);
    expect(sample).not.toHaveProperty("reportedRequestCorrelationId");
  });

  it("retains a very slow event as a capped duration instead of dropping its failure", async () => {
    const stop = createFieldCheckObserver("local", TEST_SCOPE);
    recordPerformance("browser:navigation-to-load", 10_000_001, "load");
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    const sample = submit.mock.calls.flatMap((call) => call[0])
      .find((item: { checkName: string }) => item.checkName === "performance");
    expect(sample).toMatchObject({ outcome: "failure", metrics: { durationMs: 10_000_000, sourceCode: 2 } });
    expect(fieldCheckDiagnosticLabel("performance", sample.metrics)).toContain("at least 10000000 ms");
  });

  it("backs off a failed delivery instead of retrying in a hot loop", async () => {
    vi.useFakeTimers();
    submit.mockRejectedValue(Object.assign(new Error("rate limited"), {
      retryAfterMs: 5_000,
    }));
    const stop = createFieldCheckObserver("test-build", TEST_SCOPE);

    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(submit).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });

  it("keeps queued evidence when no valid delivery confirmation is available", async () => {
    vi.useFakeTimers();
    submit.mockRejectedValue(new Error("delivery confirmation unavailable"));
    const stop = createFieldCheckObserver("unconfirmed-build", TEST_SCOPE);

    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledOnce();
    expect(getFieldCheckQueueStatus()).toMatchObject({ available: true, count: 1 });

    stop();
    vi.useRealTimers();
  });

  it("retries through the inclusive timestamp boundary and keeps expired evidence locally", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const stop = createFieldCheckObserver("test-build", TEST_SCOPE);
    await vi.advanceTimersByTimeAsync(0);

    submit.mockReset().mockRejectedValue(new Error("delivery confirmation unavailable"));
    localStorage.setItem("run-calc-field-check-queue", JSON.stringify([
      {
        observationId: "client:startup:near-expiry",
        originScope: TEST_SCOPE,
        checkName: "startup",
        checkVersion: "3",
        outcome: "success",
        observedAt: new Date(now - FIELD_CHECK_QUEUE_MAX_AGE_MS + 3 * 60_000).toISOString(),
        appBuild: "test-build",
        deviceCategory: "desktop-chrome",
        metrics: {},
      },
    ]));

    // First attempt occurs on the observer's two-minute interval. Its retry
    // runs before expiry; the following timer retries at the inclusive boundary.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(submit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(submit).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(submit).toHaveBeenCalledTimes(3);
    expect(getFieldCheckQueueStatus()).toMatchObject({
      available: true,
      count: 1,
      retryableCount: 0,
      expiredCount: 1,
    });
    expect(JSON.parse(localStorage.getItem("run-calc-field-check-queue") ?? "[]"))
      .toEqual([expect.objectContaining({ observationId: "client:startup:near-expiry" })]);

    stop();
    vi.useRealTimers();
  });

  it("recovers delivery for an old but still-valid queued observation", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem("run-calc-field-check-queue", JSON.stringify([
      {
        observationId: "client:startup:still-valid",
        originScope: TEST_SCOPE,
        checkName: "startup",
        checkVersion: "3",
        outcome: "success",
        observedAt: new Date(now - FIELD_CHECK_QUEUE_MAX_AGE_MS + 60_000).toISOString(),
        appBuild: "test-build",
        deviceCategory: "desktop-chrome",
        metrics: {},
      },
    ]));
    submit.mockRejectedValue(new Error("temporary delivery failure"));
    const stop = createFieldCheckObserver("test-build", TEST_SCOPE);

    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledOnce();
    submit.mockImplementation(async (observations: unknown[]) => ({
      accepted: observations.length,
      duplicate: 0,
    }));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ observationId: "client:startup:still-valid" }),
    ]));
    expect(getFieldCheckQueueStatus()).toMatchObject({
      available: true,
      count: 0,
      retryableCount: 0,
      expiredCount: 0,
    });

    stop();
    vi.useRealTimers();
  });
});