import { describe, expect, it, vi } from "vitest";
import {
  clearScheduledEvaluationQueueMonitorForTests,
  getScheduledEvaluationQueueDiagnostics,
  getServerJobDefinition,
  ScheduledEvaluationQueueReadError,
} from "./serverJobs";

const mocks = vi.hoisted(() => ({
  calc: vi.fn(),
  elapsed: vi.fn(),
  dbSelect: vi.fn(),
  enqueueServerJob: vi.fn(),
  backoffOptions: [] as Array<{ jitter?: boolean }>,
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.dbSelect },
  dailySyncTable: { scope: { name: "scope" }, date: { name: "date" } },
  usersTable: {}, webPushDeliveriesTable: {}, webPushSubscriptionsTable: {},
}));
vi.mock("@workspace/live-calc", () => ({ computeServerCalc: mocks.calc, computeAutoTrackElapsedMs: mocks.elapsed }));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
vi.mock("./serverJobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./serverJobs")>();
  return { ...actual, enqueueServerJob: mocks.enqueueServerJob };
});
vi.mock("./backgroundOperations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backgroundOperations")>();
  return {
    ...actual,
    createBackgroundOperationBackoff: (options: { jitter?: boolean } = {}) => {
      mocks.backoffOptions.push(options);
      return actual.createBackgroundOperationBackoff(options);
    },
  };
});

const {
  alertCandidates,
  classifyPushSubscription,
  deferredCandidate,
  enqueueScheduledWebPushAlerts,
  freezerCandidates,
  pendingFreezerArms,
  scheduledEvaluationIdempotencyKey,
  sendPushNotification,
  startWebPushAlertScheduler,
  validPushEndpoint,
  validSubscription,
} = await import("./webPush");

describe("web-push endpoint validation", () => {
  const subscription = (endpoint: unknown) => ({
    endpoint,
    keys: { p256dh: "a".repeat(32), auth: "b".repeat(16) },
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/registration-token",
    "https://updates.push.services.mozilla.com/wpush/v2/endpoint-token",
    "https://push.services.mozilla.com/wpush/v2/endpoint-token",
    "https://web.push.apple.com/endpoint-token",
  ])("accepts supported browser push endpoint %s", (endpoint) => {
    expect(validPushEndpoint(endpoint)).toBe(true);
    expect(validSubscription(subscription(endpoint))).toBe(true);
  });

  it.each([
    "not a url",
    "http://fcm.googleapis.com/fcm/send/token",
    "https://user:password@fcm.googleapis.com/fcm/send/token",
    "https://@fcm.googleapis.com/fcm/send/token",
    "https://fcm.googleapis.com:8443/fcm/send/token",
    "https://127.0.0.1/fcm/send/token",
    "https://[::1]/fcm/send/token",
    "https://10.1.2.3/fcm/send/token",
    "https://localhost/fcm/send/token",
    "https://fcm.googleapis.com.attacker.example/fcm/send/token",
    "https://attackerfcm.googleapis.com/fcm/send/token",
    "https://push.services.mozilla.com.attacker.example/wpush/v2/token",
    "https://example.com/push/token",
  ])("rejects unsupported or unsafe endpoint %s", (endpoint) => {
    expect(validPushEndpoint(endpoint)).toBe(false);
    expect(validSubscription(subscription(endpoint))).toBe(false);
  });

  it("permits only the default HTTPS port and enforces the endpoint size cap", () => {
    expect(validPushEndpoint("https://fcm.googleapis.com:443/fcm/send/token")).toBe(true);
    expect(validPushEndpoint(`https://fcm.googleapis.com/${"a".repeat(2048)}`)).toBe(false);
  });

  it("returns only bounded rejection reasons and provider families", () => {
    expect(classifyPushSubscription(subscription("https://fcm-eu.googleapis.com/endpoint-token"))).toEqual({
      reason: "unsupported_provider",
      provider: "google",
    });
    expect(classifyPushSubscription(subscription("https://web.push.apple.com.attacker.example/endpoint-token"))).toEqual({
      reason: "unsupported_provider",
      provider: "other",
    });
    expect(classifyPushSubscription(subscription("http://fcm.googleapis.com/endpoint-token"))).toEqual({
      reason: "unsafe_endpoint",
      provider: "google",
    });
    expect(classifyPushSubscription(subscription("not a url"))).toEqual({
      reason: "invalid_endpoint",
      provider: "unknown",
    });
    expect(classifyPushSubscription(subscription("https://push.apple.com/endpoint-token"))).toEqual({
      reason: "unsupported_provider",
      provider: "apple",
    });
    expect(classifyPushSubscription({ endpoint: "https://fcm.googleapis.com/token", keys: { p256dh: "short", auth: "short" } })).toEqual({
      reason: "invalid_keys",
      provider: "google",
    });
    expect(classifyPushSubscription({
      ...subscription("https://fcm.googleapis.com/token"),
      expirationTime: "invalid",
    })).toEqual({
      reason: "invalid_expiration",
      provider: "google",
    });
    expect(classifyPushSubscription(null)).toEqual({ reason: "invalid_subscription", provider: "unknown" });
  });

  it("never sends to an endpoint that is not in the supported service set", async () => {
    const { default: webpushMock } = await import("web-push");
    vi.mocked(webpushMock.sendNotification).mockClear();

    await expect(sendPushNotification({
      endpoint: "https://fcm.googleapis.com.attacker.example/push/token",
      keys: { p256dh: "a".repeat(32), auth: "b".repeat(16) },
    }, "payload")).rejects.toThrow("Invalid push endpoint");

    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });
});

describe("server web-push alert candidates", () => {
  it("uses jittered retry timing for scheduled alert enqueue", async () => {
    vi.useFakeTimers();
    mocks.backoffOptions = [];
    const scheduler = startWebPushAlertScheduler({
      enqueue: async () => ({ examined: 0, enqueued: 0 }),
      sampleQueue: async () => ({
        started: [],
        cleared: [],
        diagnostics: getScheduledEvaluationQueueDiagnostics(),
      }),
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.backoffOptions).toContainEqual({ jitter: true });
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it("keeps one scheduling timestamp across a transient connection retry", async () => {
    vi.useFakeTimers();
    const now = vi.fn()
      .mockReturnValueOnce(59_999)
      .mockReturnValueOnce(60_001);
    const enqueue = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("connection terminated"), { code: "57P01" }))
      .mockResolvedValueOnce({ examined: 1, enqueued: 0 });
    const sampleQueue = vi.fn(async () => ({
      started: [],
      cleared: [],
      diagnostics: getScheduledEvaluationQueueDiagnostics(),
    }));
    const scheduler = startWebPushAlertScheduler({ now, enqueue, sampleQueue });

    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }

    expect(now).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map(([scheduledAt]) => scheduledAt)).toEqual([59_999, 59_999]);
  });

  it("logs only the transition into a scheduled-queue warning with aggregate counts", async () => {
    vi.useFakeTimers();
    const diagnostic = {
      ...getScheduledEvaluationQueueDiagnostics(),
      status: "warning" as const,
      queued: 3,
      running: 1,
      warningCodes: ["backlog_stalled" as const],
    };
    const sampleQueue = vi.fn()
      .mockResolvedValueOnce({
        started: ["backlog_stalled" as const],
        cleared: [],
        diagnostics: diagnostic,
      })
      .mockResolvedValue({
        started: [],
        cleared: [],
        diagnostics: diagnostic,
      });
    const enqueue = vi.fn(async () => ({ examined: 0, enqueued: 0 }));
    const scheduler = startWebPushAlertScheduler({ enqueue, sampleQueue });

    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }

    const { logger } = await import("../lib/logger");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toMatch(/scheduled_evaluation_queue_monitor/);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/scope|idempotency|customer-visible-label/i);
  });

  it("marks queue diagnostics unavailable when its scheduled sample fails", async () => {
    vi.useFakeTimers();
    clearScheduledEvaluationQueueMonitorForTests();
    const sampleQueue = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const enqueue = vi.fn(async () => ({ examined: 0, enqueued: 0 }));
    const scheduler = startWebPushAlertScheduler({ enqueue, sampleQueue });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(sampleQueue).toHaveBeenCalledTimes(1);
      expect(getScheduledEvaluationQueueDiagnostics()).toMatchObject({
        sampleAvailability: "unavailable",
        sampleCount: 0,
      });
    } finally {
      scheduler.stop();
      clearScheduledEvaluationQueueMonitorForTests();
      vi.useRealTimers();
    }
  });

  it("logs a bounded queue-sample stage and timeout class without the error message", async () => {
    vi.useFakeTimers();
    clearScheduledEvaluationQueueMonitorForTests();
    const { logger } = await import("../lib/logger");
    vi.mocked(logger.warn).mockClear();
    const sampleQueue = vi.fn().mockRejectedValue(new ScheduledEvaluationQueueReadError(
      "duplicate_group_scan",
      80,
      125,
      Object.assign(new Error("private query details"), { code: "57014" }),
    ));
    const scheduler = startWebPushAlertScheduler({
      enqueue: async () => ({ examined: 0, enqueued: 0 }),
      sampleQueue,
      monotonicNow: () => 500,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "scheduled_evaluation_queue_monitor",
          outcome: "sample_unavailable",
          failureStage: "duplicate_group_scan",
          failureReason: "database-timeout",
          durationMs: 125,
          queryDurationMs: 80,
        }),
        expect.any(String),
      );
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain("private query details");
    } finally {
      scheduler.stop();
      clearScheduledEvaluationQueueMonitorForTests();
      vi.useRealTimers();
    }
  });

  it("logs slow queue samples with per-query timing only", async () => {
    vi.useFakeTimers();
    const { logger } = await import("../lib/logger");
    vi.mocked(logger.warn).mockClear();
    const sampleQueue = vi.fn().mockResolvedValue({
      started: [],
      cleared: [],
      diagnostics: getScheduledEvaluationQueueDiagnostics(),
      sampleTiming: {
        durationMs: 1_250,
        queryDurationsMs: { status_aggregate: 100, duplicate_group_scan: 1_100 },
      },
    });
    const scheduler = startWebPushAlertScheduler({
      enqueue: async () => ({ examined: 0, enqueued: 0 }),
      sampleQueue,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "scheduled_evaluation_queue_monitor",
          outcome: "slow_sample",
          durationMs: 1_250,
          queryDurationsMs: { status_aggregate: 100, duplicate_group_scan: 1_100 },
        }),
        expect.any(String),
      );
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it("does not emit live timing alerts while paused or ended", () => {
    mocks.calc.mockReturnValue({ runId: "run-a", calc: { ppm: 20, adjustedTimeSec: 300, pressDone: false, timePerBatchSec: 1, pressCasesLeft: 1 } });
    const base = { dayState: { currentIndex: 0, runs: [{ id: "run-a", startedAt: 1, pausedAt: 2 }] }, runValues: { "run-a": { freezerTime: 0 } } };
    expect(alertCandidates(base, "2026-01-01", 100_000)).toEqual([]);
    expect(alertCandidates({ ...base, dayState: { currentIndex: 0, runs: [{ id: "run-a", startedAt: 1, endedAt: 2 }] } }, "2026-01-01", 100_000)).toEqual([]);
  });

  it("uses bounded opaque stable ids for canonical timing milestones", () => {
    mocks.calc.mockReturnValue({ runId: "customer-visible-label", calc: { ppm: 20, adjustedTimeSec: 900, pressDone: true, timePerBatchSec: 0, pressCasesLeft: 0 } });
    const data = { dayState: { currentIndex: 0, runs: [{ id: "customer-visible-label", startedAt: 1 }] }, runValues: { "customer-visible-label": { freezerTime: 0 } } };
    const alerts = alertCandidates(data, "2026-01-01", 100_000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "fifteenMin" });
    expect(alerts[0]!.id).not.toContain("customer-visible-label");
    expect(alerts[0]!.id.length).toBeLessThan(96);
  });

  it("uses pause-aware shared elapsed time for batches and changes identity for a replacement run", () => {
    mocks.elapsed.mockReturnValue(2_000);
    mocks.calc.mockReturnValue({ runId: "first", calc: { ppm: 20, adjustedTimeSec: 2_000, pressDone: false, timePerBatchSec: 1, pressCasesLeft: 99 } });
    const first = { dayState: { currentIndex: 0, runs: [{ id: "first", startedAt: 1, autoTrackDisabled: true }] }, runValues: { first: { freezerTime: 0 } } };
    expect(alertCandidates(first, "2026-01-01", 100_000).some((a) => a.kind === "batchDue")).toBe(true);
    expect(mocks.elapsed).toHaveBeenCalled();
    expect(alertCandidates({ ...first, dayState: { currentIndex: 0, runs: [{ id: "first", startedAt: 1, pausedAt: 50_000 }] } }, "2026-01-01", 100_000)).toEqual([]);
    const old = { dayState: { currentIndex: 1, runs: [{ id: "first", endedAt: 1 }, { id: "second", startedAt: 2 }] }, runValues: { first: { freezerTime: 1 } } };
    const replacement = { ...old, dayState: { currentIndex: 1, runs: [{ id: "replacement", endedAt: 1 }, { id: "second", startedAt: 2 }] }, runValues: { replacement: { freezerTime: 1 } } };
    expect(freezerCandidates(old, "2026-01-01", 61_000)[0]!.id).not.toEqual(freezerCandidates(replacement, "2026-01-01", 61_000)[0]!.id);
  });

  it("suppresses dough batch pushes while canonical automatic tracking is enabled", () => {
    mocks.elapsed.mockReturnValue(2_000);
    mocks.calc.mockReturnValue({
      runId: "auto",
      calc: {
        ppm: 20,
        adjustedTimeSec: 2_000,
        pressDone: false,
        timePerBatchSec: 1,
        pressCasesLeft: 99,
      },
    });
    const data = {
      dayState: {
        currentIndex: 0,
        runs: [{ id: "auto", startedAt: 1, autoTrackDisabled: false }],
      },
      runValues: { auto: { freezerTime: 0 } },
    };

    expect(
      alertCandidates(data, "2026-01-01", 100_000)
        .some((candidate) => candidate.kind === "batchDue"),
    ).toBe(false);
    expect(mocks.elapsed).not.toHaveBeenCalled();
  });

  it("finds a freezer-empty milestone for an ended non-current run", () => {
    const data = {
      dayState: { currentIndex: 1, runs: [{ id: "old", endedAt: 1_000 }, { id: "current", startedAt: 2_000 }] },
      runValues: { old: { freezerTime: 1 }, current: { freezerTime: 0 } },
    };
    expect(freezerCandidates(data, "2026-01-01", 62_000)).toEqual([
      expect.objectContaining({ kind: "freezerEmpty" }),
    ]);
  });

  it("arms freezer completion only while the canonical drain is pending", () => {
    const data = {
      dayState: { currentIndex: 1, runs: [{ id: "old", startedAt: 100, endedAt: 1_000 }, { id: "current", startedAt: 2_000 }] },
      runValues: { old: { freezerTime: 1 }, current: { freezerTime: 0 } },
    };
    expect(pendingFreezerArms(data, 60_000)).toHaveLength(1);
    expect(pendingFreezerArms(data, 62_000)).toEqual([]);
    expect(freezerCandidates(data, "2026-01-01", 62_000)[0]).toMatchObject({
      kind: "freezerEmpty",
      dueAt: 61_000,
    });
  });

  it("deduplicates scheduled evaluation by scope and time bucket, not date", () => {
    const first = scheduledEvaluationIdempotencyKey("live", 120_001, 60_000);
    expect(scheduledEvaluationIdempotencyKey("live", 179_999, 60_000)).toBe(first);
    expect(scheduledEvaluationIdempotencyKey("live", 180_000, 60_000)).not.toBe(first);
    expect(scheduledEvaluationIdempotencyKey("sandbox", 120_001, 60_000)).not.toBe(first);
  });

  it("coalesces repeated time-bucketed scheduled evaluations for each distinct scope", async () => {
    const grouped = vi.fn().mockResolvedValue([{ scope: "live" }, { scope: "sandbox" }]);
    const from = vi.fn().mockReturnValue({ groupBy: grouped });
    mocks.dbSelect.mockReturnValue({ from });
    mocks.enqueueServerJob
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false })
      .mockResolvedValueOnce({ created: false });

    await expect(enqueueScheduledWebPushAlerts(120_001, 60_000))
      .resolves.toEqual({ examined: 2, enqueued: 2 });
    await expect(enqueueScheduledWebPushAlerts(179_999, 60_000))
      .resolves.toEqual({ examined: 2, enqueued: 0 });

    expect(grouped).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueServerJob).toHaveBeenCalledTimes(4);
    expect(mocks.enqueueServerJob.mock.calls.map(([job]) => ({
      scope: job.scope,
      idempotencyKey: job.idempotencyKey,
      scheduledFor: job.input.scheduledFor,
    }))).toEqual([
      { scope: "live", idempotencyKey: scheduledEvaluationIdempotencyKey("live", 120_001, 60_000), scheduledFor: 120_001 },
      { scope: "sandbox", idempotencyKey: scheduledEvaluationIdempotencyKey("sandbox", 120_001, 60_000), scheduledFor: 120_001 },
      { scope: "live", idempotencyKey: scheduledEvaluationIdempotencyKey("live", 179_999, 60_000), scheduledFor: 179_999 },
      { scope: "sandbox", idempotencyKey: scheduledEvaluationIdempotencyKey("sandbox", 179_999, 60_000), scheduledFor: 179_999 },
    ]);
  });

  it("registers scheduled evaluation as an executable bounded server job", () => {
    const definition = getServerJobDefinition("scheduled-evaluation");
    expect(definition?.handler).toBeTypeOf("function");
    expect(definition).toMatchObject({ maxAttempts: 3, timeoutMs: 60_000 });
  });

  it("preserves a quiet-hour alert's deliverable identity for later delivery", () => {
    expect(deferredCandidate({
      alertId: "opaque-alert",
      alertKind: "freezerEmpty",
      dueAt: new Date(123_000),
    })).toEqual({ id: "opaque-alert", kind: "freezerEmpty", dueAt: 123_000 });
    expect(deferredCandidate({ alertId: "opaque-alert", alertKind: "unknown", dueAt: null })).toBeNull();
  });
});
