import { EventEmitter } from "node:events";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeDatabasePhase,
  startDatabasePhaseCheckout,
  stopDatabasePhaseObservations,
  summarizeDatabasePhaseRecords,
  type DatabasePhaseEvidence,
} from "./databasePhaseTelemetry";
import { clearCapacityTelemetryForTests, installPoolTelemetry } from "./capacityTelemetry";

vi.mock("./logger", () => ({ logger: { info: vi.fn() } }));

afterEach(() => {
  stopDatabasePhaseObservations();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearCapacityTelemetryForTests();
});

describe("scoped database phase evidence", () => {
  it("separates checkout from post-checkout elapsed work with aligned UTC boundaries", async () => {
    let clock = 10;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const publish = vi.fn();
    const result = await observeDatabasePhase("status_aggregate", async () => {
      clock = 15;
      const checkout = startDatabasePhaseCheckout(900);
      clock = 35;
      checkout();
      clock = 85;
      return { rows: [] };
    }, publish);
    expect(result).toEqual({ rows: [] });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0]![0]).toMatchObject({
      version: 1, stage: "status_aggregate", coverage: "complete",
      phase: "post_checkout", outcome: "success", elapsedMs: 75,
      acquisitionMs: 20, postCheckoutMs: 50, timeoutOverrunMs: null,
    });
    expect(Date.parse(publish.mock.calls[0]![0].observedFrom)).toBeGreaterThan(0);
    expect(Date.parse(publish.mock.calls[0]![0].observedUntil)).toBeGreaterThan(0);
  });

  it.each([
    ["timeout exceeded when trying to connect", undefined, false, "checkout_timeout"],
    ["Connection terminated due to connection timeout", undefined, false, "connection_timeout"],
    ["sensitive host/db/user", "ECONNREFUSED", false, "connection_failed"],
    ["sensitive host/db/user", "ENOTFOUND", false, "connection_failed"],
    ["ambiguous network timeout", "ETIMEDOUT", false, "acquisition_failed"],
    ["Query read timeout", undefined, true, "query_timeout"],
    ["canceling statement due to statement timeout", "57014", true, "query_timeout"],
    ["sensitive SQL and values", "57014", true, "cancelled"],
    ["cancelled", "ABORT_ERR", false, "cancelled"],
    ["unrecognized sensitive error", "INTERNAL", true, "failed"],
  ])("classifies only known phase-specific signatures (%s)", async (message, code, checkedOut, outcome) => {
    const error = Object.assign(new Error(message), { code, query: "private recipe SQL", values: ["private"] });
    const publish = vi.fn();
    const result = observeDatabasePhase("duplicate_group_scan", async () => {
      const checkout = startDatabasePhaseCheckout(900);
      checkout(checkedOut ? undefined : error);
      throw new Error("ORM wrapper with SQL", { cause: error });
    }, publish);
    await expect(result).rejects.toThrow("ORM wrapper with SQL");
    const evidence = publish.mock.calls[0]![0];
    expect(evidence).toMatchObject({ outcome, phase: checkedOut ? "post_checkout" : "acquisition" });
    expect(JSON.stringify(evidence)).not.toMatch(/sensitive|private|SQL|ECONNREFUSED|57014|ETIMEDOUT/);
    if (!checkedOut) expect(evidence.postCheckoutMs).toBeNull();
  });

  it("records elapsed timeout overrun without claiming the configured deadline changed", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const publish = vi.fn();
    const error = new Error("timeout exceeded when trying to connect");
    await expect(observeDatabasePhase("status_aggregate", async () => {
      const checkout = startDatabasePhaseCheckout(900);
      // A stalled JS timer can run far later than its configured deadline.
      clock = 26_000;
      checkout(error);
      throw error;
    }, publish)).rejects.toBe(error);
    expect(publish.mock.calls[0]![0]).toMatchObject({
      acquisitionMs: 26_000, timeoutOverrunMs: 25_100, postCheckoutMs: null,
    });
  });

  it("makes missing/multiple checkout boundaries unknown instead of subtracting unrelated timers", async () => {
    const publish = vi.fn();
    await observeDatabasePhase("status_aggregate", () => 1, publish);
    await observeDatabasePhase("duplicate_group_scan", () => {
      startDatabasePhaseCheckout(900)();
      startDatabasePhaseCheckout(900)();
    }, publish);
    expect(publish.mock.calls.map(([record]) => record)).toEqual([
      expect.objectContaining({ coverage: "unobserved", phase: "unknown", acquisitionMs: null, postCheckoutMs: null }),
      expect.objectContaining({ coverage: "multiple_checkouts", phase: "unknown", acquisitionMs: null, postCheckoutMs: null }),
    ]);
  });

  it("preserves thrown undefined and diagnostic sink failures", async () => {
    const publish = vi.fn((_evidence: DatabasePhaseEvidence) => { throw new Error("sink unavailable"); });
    const result = {};
    await expect(observeDatabasePhase("status_aggregate", () => result, publish)).resolves.toBe(result);
    await expect(observeDatabasePhase("status_aggregate", () => Promise.reject(undefined), publish)).rejects.toBeUndefined();
    expect(publish.mock.calls[1]![0].outcome).toBe("failed");
    const hostile = new Error("private");
    Object.defineProperty(hostile, "cause", { get() { throw new Error("getter"); } });
    await expect(observeDatabasePhase("status_aggregate", () => { throw hostile; }, publish)).rejects.toBe(hostile);
    expect(publish.mock.calls[2]![0].outcome).toBe("unknown");
  });

  it("bounds values and handles cyclic causes without copying errors", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const error = new Error("secret");
    error.cause = error;
    const publish = vi.fn();
    await expect(observeDatabasePhase("status_aggregate", () => {
      const checkout = startDatabasePhaseCheckout(900);
      clock = 1_000_000;
      checkout();
      clock = 2_000_000;
      throw error;
    }, publish)).rejects.toBe(error);
    expect(publish.mock.calls[0]![0]).toMatchObject({
      elapsedMs: 600_000, acquisitionMs: 600_000, postCheckoutMs: 600_000, outcome: "failed",
    });
  });

  it("keeps concurrent and nested scopes distinct", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const other = vi.fn();
    await Promise.all([
      observeDatabasePhase("status_aggregate", async () => {
        startDatabasePhaseCheckout(900)();
        await observeDatabasePhase("duplicate_group_scan", async () => {
          startDatabasePhaseCheckout(900)();
        }, inner);
      }, outer),
      observeDatabasePhase("duplicate_group_scan", async () => {
        startDatabasePhaseCheckout(900)(new Error("timeout exceeded when trying to connect"));
        throw new Error("wrapped");
      }, other).catch(() => {}),
    ]);
    expect(outer.mock.calls[0]![0]).toMatchObject({ coverage: "complete", outcome: "success" });
    expect(inner.mock.calls[0]![0]).toMatchObject({ coverage: "complete", outcome: "success" });
    expect(other.mock.calls[0]![0]).toMatchObject({ phase: "acquisition", outcome: "checkout_timeout" });
  });

  it("caps live observation and ends shutdown evidence once without cancelling or completing work", async () => {
    const publish = vi.fn();
    const resolvers: Array<() => void> = [];
    const work = Array.from({ length: 33 }, () => observeDatabasePhase("status_aggregate", () => {
      startDatabasePhaseCheckout(900);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    }, publish));
    stopDatabasePhaseObservations();
    expect(publish).toHaveBeenCalledTimes(32);
    expect(publish.mock.calls.every(([record]) => record.outcome === "shutdown" && record.acquisitionMs === null)).toBe(true);
    resolvers.forEach((resolve) => resolve());
    await Promise.all(work);
    expect(publish).toHaveBeenCalledTimes(33);
    expect(publish.mock.calls[32]![0]).toMatchObject({ coverage: "unobserved", phase: "unknown" });
  });

  it("does not describe an unfinished post-checkout phase as a completed duration at shutdown", async () => {
    const publish = vi.fn();
    let resolve!: () => void;
    const work = observeDatabasePhase("status_aggregate", () => {
      startDatabasePhaseCheckout(900)();
      return new Promise<void>((done) => { resolve = done; });
    }, publish);
    stopDatabasePhaseObservations();
    expect(publish.mock.calls[0]![0]).toMatchObject({
      coverage: "shutdown", phase: "post_checkout", outcome: "shutdown", postCheckoutMs: null,
    });
    resolve();
    await work;
    expect(publish).toHaveBeenCalledOnce();
  });
});

describe("existing node-postgres boundaries", () => {
  // A local in-memory Client exercises the installed pg-pool waiter machinery;
  // no network, provider probe, SQL or production data is involved.
  class Client extends EventEmitter {
    _queryable = true;
    _ending = false;
    connect(callback: (error?: Error) => void) { queueMicrotask(() => callback()); }
    end() { this._ending = true; queueMicrotask(() => this.emit("end")); }
  }
  // Test-only client double implements the connect/end lifecycle used here,
  // not the query API. pg-pool itself owns all waiter and release behavior.
  const makePool = () => new pg.Pool({
    Client: Client as unknown as typeof pg.Client, max: 1, connectionTimeoutMillis: 20,
  });

  it("preserves Promise/callback checkout, release identity, idempotent install and cancelled waiters", async () => {
    const pool = makePool();
    installPoolTelemetry(pool);
    const wrapped = pool.connect;
    installPoolTelemetry(pool);
    expect(pool.connect).toBe(wrapped);
    const publish = vi.fn();
    const held = await pool.connect();
    try {
      await expect(observeDatabasePhase("status_aggregate", () => pool.connect(), publish))
        .rejects.toThrow("timeout exceeded when trying to connect");
      expect(pool.waitingCount).toBe(0);
      await expect(observeDatabasePhase("duplicate_group_scan", () => new Promise((resolve, reject) => {
        const returned = pool.connect((error, client, release) => {
          expect(client).toBeUndefined();
          expect(release).toBeUndefined();
          if (error) reject(error); else resolve(client);
        });
        expect(returned).toBeUndefined();
      }), publish)).rejects.toThrow("timeout exceeded when trying to connect");
      expect(pool.waitingCount).toBe(0);
      held.release();
      await observeDatabasePhase("status_aggregate", () => new Promise<void>((resolve, reject) => {
        pool.connect((error, client, release) => {
          if (error) return reject(error);
          if (!client) return reject(new Error("Expected a checked-out test client"));
          expect(client).toBe(held);
          expect(release).toBe(client.release);
          release();
          resolve();
        });
      }), publish);
      expect(publish.mock.calls.map(([record]) => record.outcome)).toEqual([
        "checkout_timeout", "checkout_timeout", "success",
      ]);
    } finally {
      // end must not wait behind an unreleased test client after an assertion fails.
      if (pool.idleCount === 0) held.release();
      await pool.end();
    }
  });
});

describe("offline phase summary", () => {
  it("keeps legacy/malformed evidence unknown, deduplicates modern queue logs and drops arbitrary fields", async () => {
    let evidence!: DatabasePhaseEvidence;
    await observeDatabasePhase("status_aggregate", () => {
      startDatabasePhaseCheckout(900)();
    }, (record) => { evidence = record; });
    const result = summarizeDatabasePhaseRecords([
      { event: "background_database_phase", databasePhase: evidence, identity: "private" },
      { event: "scheduled_evaluation_queue_monitor", durationMs: 25_400, queryDurationMs: 20_000 },
      { event: "scheduled_evaluation_queue_monitor", databasePhaseVersion: 1, databasePhase: evidence },
      { event: "background_database_phase", databasePhase: { ...evidence, acquisitionMs: -1, sql: "private" } },
      { event: "background_database_phase", databasePhase: { ...evidence, version: 999 } },
      { event: "unrelated", error: "private" },
      null,
    ]);
    expect(result).toMatchObject({
      records: 4, legacyOrInvalid: 3,
      phases: { acquisition: 0, post_checkout: 1, unknown: 3 },
      acquisition: { observed: 1 }, postCheckout: { observed: 1 },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|sql|identity|25_400|20000/);
  });
});
