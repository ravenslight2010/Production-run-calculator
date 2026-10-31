import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  handlers: new Map<string, Function>(),
  client: { on: vi.fn(), removeListener: vi.fn(), release: vi.fn(), query: vi.fn() },
  backoffUntil: 0,
  backoffOptions: [] as Array<{ jitter?: boolean }>,
}));
vi.mock("@workspace/db", () => ({
  pool: { query: mocks.query, connect: async () => mocks.client },
  db: {},
  syncOutboxCursorsTable: {},
  syncOutboxEventsTable: {},
}));
vi.mock("./backgroundOperations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backgroundOperations")>();
  return {
    ...actual,
    createBackgroundOperationBackoff: (options: { jitter?: boolean } = {}) => {
      mocks.backoffOptions.push(options);
      return {
        isReady: () => Date.now() >= mocks.backoffUntil,
        nextRetryAt: () => mocks.backoffUntil,
        recordSuccess: () => { mocks.backoffUntil = 0; },
        recordFailure: () => { mocks.backoffUntil = Date.now() + 1000; },
      };
    },
    runBackgroundOperation: async (_name: string, run: () => Promise<void>) => run(),
  };
});
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
import { clearSyncOutboxProcessCursorsForTests, startSyncOutboxListener, syncOutboxFailureReason } from "./syncOutbox";
import { startDatabasePhaseCheckout } from "./databasePhaseTelemetry";

describe("durable outbox wake scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("SYNC_OUTBOX_LISTENER_TEST_ENABLED", "1");
    mocks.backoffUntil = 0;
    mocks.backoffOptions = [];
    clearSyncOutboxProcessCursorsForTests();
    mocks.handlers.clear();
    mocks.client.on.mockImplementation((name, handler) => { mocks.handlers.set(name, handler); });
    mocks.client.query.mockResolvedValue({ rows: [] });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("retains a notification received during a drain, without waiting five seconds", async () => {
    let calls = 0;
    let release!: () => void;
    mocks.query.mockImplementation(async () => {
      calls++;
      if (calls === 3) await new Promise<void>((resolve) => { release = resolve; });
      return { rows: [] };
    });
    const stop = startSyncOutboxListener(async () => {}, async () => {});
    await vi.advanceTimersByTimeAsync(0);
    const notify = () => mocks.handlers.get("notification")!({ channel: "sync_outbox" });
    notify();
    await vi.advanceTimersByTimeAsync(1);
    notify();
    release();
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(4);
    stop();
  });

  it("schedules a failed pass at its backoff deadline without another notification", async () => {
    let calls = 0;
    const { logger } = await import("./logger");
    vi.mocked(logger.warn).mockClear();
    mocks.query.mockImplementation(async () => {
      calls++;
      if (calls === 2) throw Object.assign(new Error("private SQL"), { code: "42501" });
      return { rows: [] };
    });
    const stop = startSyncOutboxListener(async () => {}, async () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sync_outbox_drain",
        outcome: "retry",
        failureReason: "database-permission",
        failureStage: "scope-list",
        durationMs: expect.any(Number),
      }),
      expect.any(String),
    );
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain("private SQL");
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
  });

  it("enables bounded jitter for outbox recovery retries", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const stop = startSyncOutboxListener(async () => {}, async () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.backoffOptions).toContainEqual({ jitter: true });
    } finally {
      stop();
    }
  });

  it("keeps a failed delivery pending and advances only after the same event succeeds", async () => {
    const { logger } = await import("./logger");
    vi.mocked(logger.info).mockClear();
    const scope = "private-scope";
    const row = {
      scope, cursor: 1, kind: "configuration", date: null, sender_id: "private-sender",
      payload: { origin: "peer", family: "profiles" }, created_at: new Date(),
    };
    mocks.query.mockImplementation(async (sql: string) => {
      startDatabasePhaseCheckout(900)();
      if (sql.startsWith("SELECT scope, cursor FROM")) return { rows: [{ scope, cursor: 0 }] };
      if (sql.startsWith("SELECT scope FROM")) return { rows: [{ scope }] };
      if (sql.startsWith("SELECT cursor FROM")) return { rows: [{ cursor: 1 }] };
      return { rows: [row] };
    });
    const deliveryError = new Error("private delivery failure");
    const deliver = vi.fn().mockRejectedValueOnce(deliveryError).mockResolvedValue(undefined);
    const gap = vi.fn();
    const stop = startSyncOutboxListener(deliver, gap);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(deliver).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1001);
      expect(deliver).toHaveBeenCalledTimes(2);
      expect(deliver.mock.calls[0]![0].cursor).toBe(1);
      expect(deliver.mock.calls[1]![0].cursor).toBe(1);
      await vi.advanceTimersByTimeAsync(5001);
      expect(deliver).toHaveBeenCalledTimes(2);
      expect(gap).not.toHaveBeenCalled();
      const phases = vi.mocked(logger.info).mock.calls.map(([fields]) => fields)
        .filter((fields) => fields !== null && typeof fields === "object" &&
          "event" in fields && fields.event === "background_database_phase");
      expect(phases).toHaveLength(3);
      expect(phases).toEqual(expect.arrayContaining([
        expect.objectContaining({ databasePhase: expect.objectContaining({
          stage: "outbox_events_read", outcome: "success", coverage: "complete",
        }) }),
      ]));
      // The read succeeded even though the delivery failed. Never attribute
      // handler failure to SQL, and never log scope, sender or event payloads.
      expect(JSON.stringify(phases)).not.toMatch(/private|profiles/);
    } finally { stop(); }
  });

  it("does not skip a retention gap when canonical reconciliation fails", async () => {
    const scope = "private-scope";
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT scope, cursor FROM")) return { rows: [{ scope, cursor: 0 }] };
      if (sql.startsWith("SELECT scope FROM")) return { rows: [{ scope }] };
      if (sql.startsWith("SELECT cursor FROM")) return { rows: [{ cursor: 3 }] };
      return { rows: [] };
    });
    const gap = vi.fn().mockRejectedValueOnce(new Error("reconcile failed")).mockResolvedValue(undefined);
    const deliver = vi.fn();
    const stop = startSyncOutboxListener(deliver, gap);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(gap).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1001);
      expect(gap).toHaveBeenCalledTimes(2);
      expect(gap.mock.calls).toEqual([[scope, 3], [scope, 3]]);
      await vi.advanceTimersByTimeAsync(5001);
      expect(gap).toHaveBeenCalledTimes(2);
      expect(deliver).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it("classifies only fixed reasons, including nested database errors", () => {
    expect(syncOutboxFailureReason({ cause: { code: "42501" } })).toBe("database-permission");
    expect(syncOutboxFailureReason({ code: "53300" })).toBe("database-capacity");
    expect(syncOutboxFailureReason({ code: "57014" })).toBe("database-timeout");
    expect(syncOutboxFailureReason({ code: "ECONNRESET" })).toBe("database-connection");
    expect(syncOutboxFailureReason({ code: "40P01" })).toBe("database-conflict");
    expect(syncOutboxFailureReason({ code: "private-user-data" })).toBe("delivery-failed");
    expect(syncOutboxFailureReason(new Error("private SQL"))).toBe("delivery-failed");
  });
});
