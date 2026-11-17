import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { collectDatabaseCapacity, startDatabaseCapacityCollection, DATABASE_CAPACITY_INTERVAL_MS } from "./databaseCapacity";

function fixture(row: Record<string, unknown> = {}) {
  const release = vi.fn();
  const query = vi.fn(async ({ text }: { text: string }) => ({
    rows: text.startsWith("\nSELECT") ? [{
      replica: false, max_connections: 100, superuser_reserved: 3, role_reserved: 2,
      client_backends: 20, active_backends: 4, idle_backends: 16, visible_states: 20,
      active_wait_backends: 0, lock_wait_backends: 0,
      ...row,
    }] : [],
  }));
  const pool = {
    connect: vi.fn(async () => ({ query, release })),
    totalCount: 10, idleCount: 2, waitingCount: 4, options: { max: 10 },
  } as unknown as Pool;
  return { pool, query, release };
}

afterEach(() => vi.useRealTimers());

describe("read-only database capacity collection", () => {
  it("uses the app pool, read-only transaction and bounded query deadlines", async () => {
    const f = fixture();
    expect(await collectDatabaseCapacity(f.pool)).toMatchObject({
      status: "observed", primaryVerified: true, estimatedOrdinarySlotsRemaining: 75,
      stateVisibilityComplete: true, activeWaitingBackends: 0, lockWaitingBackends: 0,
    });
    expect(f.query.mock.calls.map(([q]) => q.text)).toEqual([
      "BEGIN READ ONLY", "SET LOCAL statement_timeout = '1000ms'",
      expect.stringContaining("FROM pg_stat_activity"), "COMMIT",
    ]);
    expect(f.query.mock.calls.every(([q]) => (q as { query_timeout?: number }).query_timeout === 1500)).toBe(true);
    expect(f.release).toHaveBeenCalledWith(false);
  });

  it("never treats a replica or partial state visibility as primary proof", async () => {
    expect(await collectDatabaseCapacity(fixture({ replica: true, visible_states: 1 }).pool)).toMatchObject({
      status: "non_primary", primaryVerified: false,
      estimatedOrdinarySlotsRemaining: null, stateVisibilityComplete: false,
    });
  });

  it("accepts bounded active and lock wait counts only when internally consistent", async () => {
    const waiting = await collectDatabaseCapacity(fixture({
      active_backends: 5,
      active_wait_backends: 3,
      lock_wait_backends: 2,
    }).pool);
    expect(waiting).toMatchObject({
      status: "observed",
      activeBackends: 5,
      activeWaitingBackends: 3,
      lockWaitingBackends: 2,
    });

    const invalid = fixture({
      active_backends: 4,
      active_wait_backends: 3,
      lock_wait_backends: 5,
    });
    expect(await collectDatabaseCapacity(invalid.pool)).toMatchObject({
      status: "unavailable",
      unavailableReason: "invalid_capacity_result",
    });
    expect(invalid.release).toHaveBeenCalledWith(true);
  });

  it("classifies checkout failures without retrying or leaking the error", async () => {
    const f = fixture();
    vi.mocked(f.pool.connect).mockRejectedValueOnce(new Error("credential-bearing error"));
    expect(await collectDatabaseCapacity(f.pool)).toEqual({
      status: "unavailable",
      primaryVerified: false,
      unavailableReason: "pool_checkout_failed",
    });
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.release).not.toHaveBeenCalled();

    const timeout = fixture();
    vi.mocked(timeout.pool.connect).mockRejectedValueOnce(
      new Error("timeout exceeded when trying to connect"),
    );
    expect(await collectDatabaseCapacity(timeout.pool)).toMatchObject({
      unavailableReason: "pool_checkout_timeout",
    });

    const codedTimeout = fixture();
    vi.mocked(codedTimeout.pool.connect).mockRejectedValueOnce(
      Object.assign(new Error("network failure"), { code: "ETIMEDOUT" }),
    );
    expect(await collectDatabaseCapacity(codedTimeout.pool)).toMatchObject({
      unavailableReason: "pool_checkout_timeout",
    });
  });

  it("classifies query timeouts, cancellations, and other query failures", async () => {
    const timeout = fixture();
    timeout.query.mockRejectedValueOnce(new Error("Query read timeout"));
    expect(await collectDatabaseCapacity(timeout.pool)).toMatchObject({
      unavailableReason: "capacity_query_timeout",
    });

    const cancelled = fixture();
    cancelled.query.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { code: "57014" }));
    expect(await collectDatabaseCapacity(cancelled.pool)).toMatchObject({
      unavailableReason: "capacity_query_cancelled",
    });

    const failed = fixture();
    failed.query.mockRejectedValueOnce(new Error("private SQL failure"));
    expect(await collectDatabaseCapacity(failed.pool)).toMatchObject({
      unavailableReason: "capacity_query_failed",
    });
  });

  it("classifies transaction/query failures without exposing errors and discards clients", async () => {
    const cases = [
      { failingText: "BEGIN READ ONLY", isCapacityQuery: false },
      { failingText: "SELECT", isCapacityQuery: true },
      { failingText: "COMMIT", isCapacityQuery: false },
    ] as const;
    for (const { failingText, isCapacityQuery } of cases) {
      const f = fixture();
      const rawError = "private SQL failure";
      f.query.mockImplementation(async ({ text }) => {
        if (text === failingText || (isCapacityQuery && text.startsWith("\nSELECT"))) {
          throw new Error(rawError);
        }
        return { rows: [] };
      });
      const result = await collectDatabaseCapacity(f.pool);
      expect(result).toMatchObject({
        status: "unavailable",
        primaryVerified: false,
        unavailableReason: "capacity_query_failed",
      });
      expect(f.release).toHaveBeenCalledWith(true);
      expect(JSON.stringify(result)).not.toContain(rawError);
    }
    const invalid = fixture({ max_connections: "100" });
    expect(await collectDatabaseCapacity(invalid.pool)).toMatchObject({
      status: "unavailable",
      unavailableReason: "invalid_capacity_result",
    });
    expect(invalid.release).toHaveBeenCalledWith(true);
  });

  it("logs only allowlisted fields immediately and every five minutes, then stops", async () => {
    vi.useFakeTimers();
    const f = fixture({ private_field: "customer secret" });
    const log = { info: vi.fn() };
    const collector = startDatabaseCapacityCollection(f.pool, log, () => ({
      appBuildId: "app-build:test", sourceFingerprintSha256: "a".repeat(64),
      platformBuildId: "unsafe value with spaces",
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0][0]).toMatchObject({
      event: "database_capacity_sample",
      schemaVersion: 2,
      pool: { max: 10, total: 10, idle: 2, waiting: 4 },
      database: { activeWaitingBackends: 0, lockWaitingBackends: 0 },
      build: { appBuildId: "app-build:test", platformBuildId: null },
      limitations: { autoscaleCurrentInstances: null, autoscaleMaximumInstances: null },
    });
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("customer secret");
    await vi.advanceTimersByTimeAsync(DATABASE_CAPACITY_INTERVAL_MS);
    expect(log.info).toHaveBeenCalledTimes(2);
    collector.stop();
    await vi.advanceTimersByTimeAsync(DATABASE_CAPACITY_INTERVAL_MS);
    expect(log.info).toHaveBeenCalledTimes(2);
  });

  it("logs only bounded failure reasons and never raw database errors", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const rawError = "password=private-value host=db.internal query=SELECT private_data";
    f.query.mockImplementation(async ({ text }) => {
      if (text.startsWith("\nSELECT")) throw new Error(rawError);
      return { rows: [] };
    });
    const log = { info: vi.fn() };
    const collector = startDatabaseCapacityCollection(f.pool, log, () => null);
    await vi.advanceTimersByTimeAsync(0);

    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.filter(([query]) => query.text.startsWith("\nSELECT"))).toHaveLength(1);
    expect(log.info.mock.calls[0]?.[0]).toMatchObject({
      event: "database_capacity_sample",
      database: {
        status: "unavailable",
        primaryVerified: false,
        unavailableReason: "capacity_query_failed",
      },
    });
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(rawError);
    collector.stop();
  });

  it("prevents overlapping samples and suppresses late logs after shutdown", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let reject!: (error: Error) => void;
    vi.mocked(f.pool.connect).mockImplementationOnce(() =>
      new Promise<PoolClient>((_resolve, fail) => { reject = fail; }));
    const log = { info: vi.fn() };
    const collector = startDatabaseCapacityCollection(f.pool, log, () => null);
    await vi.advanceTimersByTimeAsync(DATABASE_CAPACITY_INTERVAL_MS * 2);
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    collector.stop();
    reject(new Error("cancelled checkout"));
    await vi.advanceTimersByTimeAsync(0);
    expect(log.info).not.toHaveBeenCalled();
  });
  it("logs only the allowlisted checkout reason and never the database error", async () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.mocked(f.pool.connect).mockRejectedValueOnce(new Error("secret-bearing connection failure"));
    const log = { info: vi.fn() };
    const collector = startDatabaseCapacityCollection(f.pool, log, () => null);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.info.mock.calls[0]?.[0]).toMatchObject({
      database: {
        status: "unavailable",
        primaryVerified: false,
        unavailableReason: "pool_checkout_failed",
      },
    });
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("secret-bearing connection failure");
    collector.stop();
  });
});
