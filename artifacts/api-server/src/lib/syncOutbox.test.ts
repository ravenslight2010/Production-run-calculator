import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  handlers: new Map<string, Function>(),
  client: { on: vi.fn(), removeListener: vi.fn(), release: vi.fn(), query: vi.fn() },
  backoffUntil: 0,
}));
vi.mock("@workspace/db", () => ({
  pool: { query: mocks.query, connect: async () => mocks.client },
  db: {},
  syncOutboxCursorsTable: {},
  syncOutboxEventsTable: {},
}));
vi.mock("./backgroundOperations", () => ({
  createBackgroundOperationBackoff: () => ({
    isReady: () => Date.now() >= mocks.backoffUntil,
    nextRetryAt: () => mocks.backoffUntil,
    recordSuccess: () => { mocks.backoffUntil = 0; },
    recordFailure: () => { mocks.backoffUntil = Date.now() + 1000; },
  }),
  runBackgroundOperation: async (_name: string, run: () => Promise<void>) => run(),
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
import { clearSyncOutboxProcessCursorsForTests, startSyncOutboxListener, syncOutboxFailureReason } from "./syncOutbox";

describe("durable outbox wake scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("SYNC_OUTBOX_LISTENER_TEST_ENABLED", "1");
    mocks.backoffUntil = 0;
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
    mocks.query.mockImplementation(async () => {
      calls++;
      if (calls === 2) throw Object.assign(new Error("private SQL"), { code: "42501" });
      return { rows: [] };
    });
    const stop = startSyncOutboxListener(async () => {}, async () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
  });

  it("classifies only fixed reasons, including nested database errors", () => {
    expect(syncOutboxFailureReason({ cause: { code: "42501" } })).toBe("database-permission");
    expect(syncOutboxFailureReason({ code: "53300" })).toBe("database-capacity");
    expect(syncOutboxFailureReason({ code: "private-user-data" })).toBe("delivery-failed");
    expect(syncOutboxFailureReason(new Error("private SQL"))).toBe("delivery-failed");
  });
});
