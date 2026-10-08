import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { collectDatabaseCapacity, startDatabaseCapacityCollection, DATABASE_CAPACITY_INTERVAL_MS } from "./databaseCapacity";

function fixture(row: Record<string, unknown> = {}) {
  const release = vi.fn();
  const query = vi.fn(async ({ text }: { text: string }) => ({
    rows: text.startsWith("\nSELECT") ? [{
      replica: false, max_connections: 100, superuser_reserved: 3, role_reserved: 2,
      client_backends: 20, active_backends: 4, idle_backends: 16, visible_states: 20,
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
      stateVisibilityComplete: true,
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

  it("reports checkout failure without retrying or leaking the error", async () => {
    const f = fixture();
    vi.mocked(f.pool.connect).mockRejectedValueOnce(new Error("credential-bearing error"));
    expect(await collectDatabaseCapacity(f.pool)).toEqual({ status: "unavailable", primaryVerified: false });
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.release).not.toHaveBeenCalled();
  });

  it("discards a client on SQL failure or invalid counts", async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(new Error("private SQL failure"));
    expect((await collectDatabaseCapacity(f.pool)).status).toBe("unavailable");
    expect(f.release).toHaveBeenCalledWith(true);
    const invalid = fixture({ max_connections: "100" });
    expect((await collectDatabaseCapacity(invalid.pool)).status).toBe("unavailable");
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
      pool: { max: 10, total: 10, idle: 2, waiting: 4 },
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
});
