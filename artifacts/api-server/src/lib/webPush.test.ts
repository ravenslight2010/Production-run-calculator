import { createHash } from "node:crypto";
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
  tables: {
    dailySync: { scope: { name: "scope" }, date: { name: "date" }, data: { name: "data" } },
    freezerProjection: {
      scope: { name: "scope" }, date: { name: "date" }, runId: { name: "run_id" },
      startedAt: { name: "started_at" }, endedAt: { name: "ended_at" },
      freezerTime: { name: "freezer_time" }, dueAt: { name: "due_at" }, isActive: { name: "is_active" },
    },
    projectionStatus: { scope: { name: "scope" } },
    webPushArms: {
      scope: { name: "scope" }, runKey: { name: "run_key" },
      alertKind: { name: "alert_kind" }, expiresAt: { name: "expires_at" },
    },
    scheduledAlertRecords: {
      id: { name: "id" }, scope: { name: "scope" }, date: { name: "date" },
      alertId: { name: "alert_id" }, alertKind: { name: "alert_kind" },
      status: { name: "status" }, evaluatedAt: { name: "evaluated_at" },
      expiresAt: { name: "expires_at" }, dueAt: { name: "due_at" },
    },
    users: {},
    deliveries: {},
    subscriptions: {},
  },
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.dbSelect },
  dailySyncTable: mocks.tables.dailySync,
  freezerAlertRunProjectionTable: mocks.tables.freezerProjection,
  freezerAlertProjectionStatusTable: mocks.tables.projectionStatus,
  webPushAlertArmsTable: mocks.tables.webPushArms,
  scheduledAlertRecordsTable: mocks.tables.scheduledAlertRecords,
  usersTable: mocks.tables.users,
  webPushDeliveriesTable: mocks.tables.deliveries,
  webPushSubscriptionsTable: mocks.tables.subscriptions,
}));
vi.mock("@workspace/live-calc", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/live-calc")>(),
  computeServerCalc: mocks.calc, computeAutoTrackElapsedMs: mocks.elapsed,
}));
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
  createWebPushRetentionPruner,
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

type SchedulerDbOptions = {
  scopes?: string[];
  projectionComplete?: boolean;
  activeRunRows?: Array<Record<string, unknown>>;
  freezerRows?: Array<Record<string, unknown>>;
  armRows?: Array<Record<string, unknown>>;
  existingAlertRows?: Array<Record<string, unknown>>;
  recoverableRows?: Array<Record<string, unknown>>;
};

function configureSchedulerDb(options: SchedulerDbOptions = {}) {
  const tables = mocks.tables;
  const scopes = options.scopes ?? ["live"];
  const getRows = (source: unknown, selectedFields: string[]) => {
    if (source === tables.dailySync) return scopes.map((scope) => ({ scope }));
    if (source === tables.projectionStatus) {
      return options.projectionComplete ? [{ scope: scopes[0] ?? "live" }] : [];
    }
    if (source === tables.freezerProjection) {
      return selectedFields.includes("dueAt") ? options.freezerRows ?? [] : options.activeRunRows ?? [];
    }
    if (source === tables.webPushArms) return options.armRows ?? [];
    if (source === tables.scheduledAlertRecords) {
      return selectedFields.includes("alertId")
        ? options.existingAlertRows ?? []
        : options.recoverableRows ?? [];
    }
    return [];
  };

  mocks.dbSelect.mockImplementation((selection: Record<string, unknown> = {}) => {
    const selectedFields = Object.keys(selection);
    let source: unknown;
    type MockBuilder = {
      from: (table: unknown) => MockBuilder;
      where: (...args: unknown[]) => MockBuilder;
      groupBy: (...args: unknown[]) => Promise<Array<Record<string, unknown>>>;
      limit: (limit: number) => Promise<Array<Record<string, unknown>>>;
    };
    const builder = {} as MockBuilder;
    builder.from = vi.fn((table: unknown) => {
      source = table;
      return builder;
    });
    builder.where = vi.fn(() => builder);
    builder.groupBy = vi.fn(() => Promise.resolve(getRows(source, selectedFields)));
    builder.limit = vi.fn(() => Promise.resolve(getRows(source, selectedFields)));
    return builder;
  });
}

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

describe("web-push retention cleanup scheduling", () => {
  it("coalesces overlapping sweeps and runs again only after the interval", async () => {
    let release!: () => void;
    let calls = 0;
    const prune = vi.fn(() => {
      calls++;
      return calls === 1
        ? new Promise<void>((resolve) => { release = resolve; })
        : Promise.resolve();
    });
    const runPrune = createWebPushRetentionPruner(prune, 1_000);

    const first = runPrune(10_000);
    const overlapping = runPrune(10_500);
    await Promise.resolve();
    expect(prune).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, overlapping]);
    await runPrune(10_999);
    expect(prune).toHaveBeenCalledTimes(1);
    await runPrune(11_000);
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it("retries a failed sweep instead of starting the cooldown", async () => {
    const prune = vi.fn()
      .mockRejectedValueOnce(new Error("temporary database failure"))
      .mockResolvedValueOnce(undefined);
    const runPrune = createWebPushRetentionPruner(prune, 1_000);

    await expect(runPrune(10_000)).rejects.toThrow("temporary database failure");
    await runPrune(10_001);
    expect(prune).toHaveBeenCalledTimes(2);
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
    const databasePhase = {
      version: 1 as const, stage: "duplicate_group_scan" as const, coverage: "complete" as const,
      phase: "post_checkout" as const, outcome: "query_timeout" as const,
      observedFrom: "2026-10-25T00:00:00.000Z", observedUntil: "2026-10-25T00:00:00.125Z",
      elapsedMs: 80, acquisitionMs: 20, postCheckoutMs: 60, timeoutOverrunMs: null,
    };
    const sampleQueue = vi.fn().mockRejectedValue(new ScheduledEvaluationQueueReadError(
      "duplicate_group_scan",
      80,
      125,
      Object.assign(new Error("private query details"), { code: "57014" }),
      databasePhase,
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
          databasePhaseVersion: 1,
          databasePhase,
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
    configureSchedulerDb({ scopes: ["live", "sandbox"] });
    mocks.enqueueServerJob.mockReset();
    mocks.enqueueServerJob
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false })
      .mockResolvedValueOnce({ created: false });

    await expect(enqueueScheduledWebPushAlerts(120_001, 60_000))
      .resolves.toEqual({ examined: 2, enqueued: 2 });
    await expect(enqueueScheduledWebPushAlerts(179_999, 60_000))
      .resolves.toEqual({ examined: 2, enqueued: 0 });

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

  it("skips idle scopes only after their projection is complete", async () => {
    configureSchedulerDb({ scopes: ["live", "sandbox"], projectionComplete: true });
    mocks.enqueueServerJob.mockReset().mockResolvedValue({ created: true });

    await expect(enqueueScheduledWebPushAlerts(120_001, 60_000))
      .resolves.toEqual({ examined: 2, enqueued: 0 });
    expect(mocks.enqueueServerJob).not.toHaveBeenCalled();
  });

  it("fails open for incomplete projections and schedules active runs", async () => {
    configureSchedulerDb({ projectionComplete: false });
    mocks.enqueueServerJob.mockReset().mockResolvedValue({ created: true });
    await expect(enqueueScheduledWebPushAlerts(120_001, 60_000))
      .resolves.toEqual({ examined: 1, enqueued: 1 });

    configureSchedulerDb({ projectionComplete: true, activeRunRows: [{ runId: "active" }] });
    mocks.enqueueServerJob.mockReset().mockResolvedValue({ created: true });
    await expect(enqueueScheduledWebPushAlerts(120_001, 60_000))
      .resolves.toEqual({ examined: 1, enqueued: 1 });
  });

  it("arms upcoming freezer work, evaluates due armed alerts, and skips recorded milestones", async () => {
    const runId = "ended-run";
    const startedAt = 1_000;
    const endedAt = 2_000;
    const date = "2026-11-08";
    const runKey = createHash("sha256").update(`${runId}:${startedAt}`).digest("hex").slice(0, 24);
    const alertId = `${date}:${runKey}:freezer-empty`;
    const freezerRow = {
      date, runId, startedAt, endedAt, freezerTime: 1, dueAt: endedAt + 60_000,
    };

    configureSchedulerDb({ projectionComplete: true, freezerRows: [freezerRow] });
    mocks.enqueueServerJob.mockReset().mockResolvedValue({ created: true });
    await expect(enqueueScheduledWebPushAlerts(10_000, 60_000))
      .resolves.toMatchObject({ enqueued: 1 });

    configureSchedulerDb({
      projectionComplete: true,
      freezerRows: [freezerRow],
      armRows: [{ runKey }],
    });
    mocks.enqueueServerJob.mockReset().mockResolvedValue({ created: true });
    await expect(enqueueScheduledWebPushAlerts(10_000, 60_000))
      .resolves.toMatchObject({ enqueued: 0 });
    expect(mocks.enqueueServerJob).not.toHaveBeenCalled();

    configureSchedulerDb({
      projectionComplete: true,
      freezerRows: [freezerRow],
      armRows: [{ runKey }],
    });
    mocks.enqueueServerJob.mockReset().mockResolvedValue({ created: true });
    await expect(enqueueScheduledWebPushAlerts(63_000, 60_000))
      .resolves.toMatchObject({ enqueued: 1 });

    configureSchedulerDb({
      projectionComplete: true,
      freezerRows: [freezerRow],
      armRows: [{ runKey }],
      existingAlertRows: [{ alertId }],
    });
    mocks.enqueueServerJob.mockReset().mockResolvedValue({ created: true });
    await expect(enqueueScheduledWebPushAlerts(63_000, 60_000))
      .resolves.toMatchObject({ enqueued: 0 });
    expect(mocks.enqueueServerJob).not.toHaveBeenCalled();
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
