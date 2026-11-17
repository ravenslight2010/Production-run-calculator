import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capacityTelemetrySnapshot,
  clearCapacityTelemetryForTests,
  installPoolTelemetry,
  legacySyncReadinessSnapshot,
  recordLegacySyncWrite,
  recordSseFrame,
  recordSsePeerFrameSkippedExactSnapshot,
  recordSyncParserRejection,
  recordSyncPut,
  recordSyncTransaction,
  reportCapacityTelemetry,
  syncRunCountBucket,
  syncPeerFrameTelemetrySnapshot,
  withPoolAcquisitionOperation,
} from "./capacityTelemetry";
import { runBackgroundOperation } from "./backgroundOperations";

beforeEach(() => clearCapacityTelemetryForTests());

class SyntheticPgClient extends EventEmitter {
  private connected = false;
  _queryable = true;
  _ending = false;

  connect(callback: (error?: Error) => void): void {
    this.connected = true;
    setImmediate(() => callback());
  }

  isConnected(): boolean {
    return this.connected;
  }

  end(callback?: (error?: Error) => void): Promise<void> {
    this.connected = false;
    this._ending = true;
    callback?.();
    return Promise.resolve();
  }

  ref(): void {}

  unref(): void {}
}

describe("capacity telemetry", () => {
  it("reports bounded percentile distributions without operational identifiers", () => {
    for (const durationMs of [1, 2, 3, 4, 100]) {
      recordSyncPut({
        mode: "partial",
        outcome: "accepted",
        runsBucket: "21-50",
        sanitizedBytes: 200,
        wireBytes: 240,
        durationMs,
      });
    }
    recordSseFrame({ mode: "complete", frameBytes: 800, durationMs: 7, outcome: "sent" });
    recordLegacySyncWrite("accepted");
    const snapshot = capacityTelemetrySnapshot();
    expect(snapshot.distributions["sync.put.partial.accepted.duration_ms"]).toEqual({
      count: 5,
      p50: 3,
      p95: 100,
      p99: 100,
      max: 100,
    });
    expect(snapshot.counters).toMatchObject({
      "sync.put.partial.accepted.count": 5,
      "sync.put.runs.21-50": 5,
      "sync.sse.complete.sent.count": 1,
      "sync.put.legacy_unversioned.accepted.count": 1,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/payload|runId|recipe|user|facility|errorText/i);
  });

  it("reports bounded event-loop delay percentiles after a stall and resets them with the window", async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stallStartedAt = performance.now();
    while (performance.now() - stallStartedAt < 100) {}
    await new Promise((resolve) => setTimeout(resolve, 50));

    const snapshot = capacityTelemetrySnapshot();
    const eventLoopDelay = snapshot.distributions["node.event_loop.delay_ms"];
    expect(Date.parse(snapshot.observedUntil) - Date.parse(snapshot.observedFrom)).toBe(snapshot.windowMs);
    expect(eventLoopDelay).toBeDefined();
    expect(eventLoopDelay?.count).toBeGreaterThan(0);
    expect(eventLoopDelay?.max).toBeGreaterThanOrEqual(50);
    expect(Object.keys(eventLoopDelay ?? {}).sort()).toEqual(["count", "max", "p50", "p95", "p99"]);
    expect(Object.values(eventLoopDelay ?? {}).every((value) =>
      Number.isFinite(value) && value >= 0 && value <= 10 * 60 * 1_000,
    )).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/payload|runId|recipe|user|facility|errorText/i);

    const info = vi.fn();
    reportCapacityTelemetry({ info } as never);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        observedFrom: snapshot.observedFrom,
        observedUntil: expect.any(String),
        distributions: expect.objectContaining({
          "node.event_loop.delay_ms": expect.objectContaining({
            count: expect.any(Number),
            p50: expect.any(Number),
            p95: expect.any(Number),
            p99: expect.any(Number),
            max: expect.any(Number),
          }),
        }),
      }),
      "bounded capacity telemetry",
    );
    expect(capacityTelemetrySnapshot().distributions["node.event_loop.delay_ms"]).toBeUndefined();
  });

  it("classifies bounded run counts", () => {
    expect(syncRunCountBucket({ dayState: { runs: [] } })).toBe("0");
    expect(syncRunCountBucket({ dayState: { runs: [{}] } })).toBe("1-5");
    expect(syncRunCountBucket({ dayState: { runs: Array(20).fill({}) } })).toBe("6-20");
    expect(syncRunCountBucket({ dayState: { runs: Array(80).fill({}) } })).toBe("21-50");
  });

  it("exposes fixed peer-frame counts without payloads or peer identifiers", () => {
    recordSseFrame({ mode: "complete", frameBytes: 800, durationMs: 2, outcome: "sent", peerUpdate: true });
    recordSseFrame({ mode: "partial", frameBytes: 240, durationMs: 1, outcome: "sent", peerUpdate: true });
    recordSsePeerFrameSkippedExactSnapshot();

    const snapshot = syncPeerFrameTelemetrySnapshot();
    expect(snapshot).toMatchObject({
      exactSnapshotSkipped: 1,
      partialSent: 1,
      completeSent: 1,
    });
    expect(snapshot.windowMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(snapshot).sort()).toEqual([
      "completeSent",
      "exactSnapshotSkipped",
      "partialSent",
      "windowMs",
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/private-peer-7|private-run-9|private shift note/i);
  });

  it("keeps percentile samples representative across the whole report window", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      for (let index = 0; index < 50_000; index += 1) {
        recordSyncTransaction(5);
      }
      for (let index = 0; index < 1_000; index += 1) {
        recordSyncTransaction(21_500);
      }

      expect(capacityTelemetrySnapshot().distributions["db.sync_transaction.duration_ms"]).toEqual({
        count: 51_000,
        p50: 5,
        p95: 5,
        p99: 5,
        max: 21_500,
      });
    } finally {
      random.mockRestore();
    }
  });

  it("records elapsed time when pg-pool's checkout timeout fires late", async () => {
    const pool = new Pool({
      Client: SyntheticPgClient as never,
      max: 1,
      connectionTimeoutMillis: 10,
      idleTimeoutMillis: 0,
    });
    installPoolTelemetry(pool);

    let heldClient: PoolClient | undefined;
    try {
      heldClient = await pool.connect();
      const queuedCheckout = pool.connect();
      const stallStartedAt = performance.now();
      while (performance.now() - stallStartedAt < 80) {}

      await expect(queuedCheckout).rejects.toThrow("timeout exceeded when trying to connect");
      expect(pool.waitingCount).toBe(0);
      expect(capacityTelemetrySnapshot().distributions["db.pool.acquisition_ms"]).toMatchObject({
        count: 2,
      });
      expect(capacityTelemetrySnapshot().distributions["db.pool.acquisition_ms"]?.max)
        .toBeGreaterThanOrEqual(60);
    } finally {
      heldClient?.release();
      await pool.end();
    }
  });

  it("summarizes pool acquisitions by fixed operation class and preserves unknown callers", async () => {
    const pool = new Pool({
      Client: SyntheticPgClient as never,
      max: 1,
      connectionTimeoutMillis: 15,
      idleTimeoutMillis: 0,
    });
    installPoolTelemetry(pool);

    let heldClient: PoolClient | undefined;
    try {
      heldClient = await withPoolAcquisitionOperation("outbox", () => pool.connect());
      await expect(withPoolAcquisitionOperation("auto_track", () => pool.connect()))
        .rejects.toThrow("timeout exceeded when trying to connect");

      const callbackFailure = withPoolAcquisitionOperation("health_check", () =>
        new Promise<void>((resolve, reject) => {
          pool.connect((error, client, release) => {
            if (error) return reject(error);
            if (!client || !release) return reject(new Error("Expected a checked-out test client"));
            release();
            resolve();
          });
        }),
      );
      await expect(callbackFailure).rejects.toThrow("timeout exceeded when trying to connect");

      heldClient.release();
      heldClient = undefined;
      const jobClient = await withPoolAcquisitionOperation("server_job", () => pool.connect());
      jobClient.release();
      const syncClient = await withPoolAcquisitionOperation("foreground_sync", () => pool.connect());
      syncClient.release();
      const unknownClient = await pool.connect();
      unknownClient.release();

      // Exercise the actual background operation mapping, not just the context helper.
      await runBackgroundOperation("server-auto-track-tick", async () => {
        const client = await pool.connect();
        client.release();
      }, { recordSuccess: false });
      await runBackgroundOperation("sync-outbox-drain", async () => {
        const client = await pool.connect();
        client.release();
      }, { recordSuccess: false });

      const snapshot = capacityTelemetrySnapshot();
      expect(snapshot.counters).toMatchObject({
        "db.pool.acquisition.outbox.success.count": 2,
        "db.pool.acquisition.auto_track.error.count": 1,
        "db.pool.acquisition.health_check.error.count": 1,
        "db.pool.acquisition.server_job.success.count": 1,
        "db.pool.acquisition.foreground_sync.success.count": 1,
        "db.pool.acquisition.unknown.success.count": 1,
        "db.pool.acquisition.auto_track.success.count": 1,
        "db.pool.acquisition_error.count": 2,
      });
      for (const operation of [
        "outbox", "auto_track", "health_check", "server_job",
        "foreground_sync", "unknown",
      ]) {
        expect(snapshot.distributions[`db.pool.acquisition.${operation}.duration_ms`]?.count)
          .toBeGreaterThan(0);
      }
      expect(snapshot.distributions["db.pool.acquisition_ms"]?.count).toBe(8);
      expect(JSON.stringify(snapshot)).not.toMatch(/payload|runId|recipe|user|facility|errorText|SQL|token/i);
    } finally {
      heldClient?.release();
      await pool.end();
    }
  });

  it("keeps checkout callback results intact and excludes sensitive errors from telemetry", async () => {
    const sensitiveError = Object.assign(new Error("private SQL and request content"), {
      code: "XX000",
      query: "SELECT private_value",
      values: ["private-user"],
    });
    const pool = {
      options: { connectionTimeoutMillis: 10 },
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      connect(callback: (error?: Error, client?: PoolClient, release?: (error?: Error | boolean) => void) => void) {
        queueMicrotask(() => callback(sensitiveError));
      },
    } as unknown as Pool;
    installPoolTelemetry(pool);

    const callbackError = await withPoolAcquisitionOperation("health_check", () =>
      new Promise<Error | undefined>((resolve) => pool.connect((error) => resolve(error))),
    );
    expect(callbackError).toBe(sensitiveError);

    // Invalid runtime labels collapse to the explicit unknown bucket.
    const unknownError = await withPoolAcquisitionOperation("private-scope" as never, () =>
      new Promise<Error | undefined>((resolve) => pool.connect((error) => resolve(error))),
    );
    expect(unknownError).toBe(sensitiveError);
    const snapshot = capacityTelemetrySnapshot();
    expect(snapshot.counters).toMatchObject({
      "db.pool.acquisition.health_check.error.count": 1,
      "db.pool.acquisition.unknown.error.count": 1,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/private SQL|private_value|private-user|XX000/);
    expect(Object.keys(snapshot.distributions).filter((key) => key.startsWith("db.pool.acquisition."))
      .every((key) => [
        "db.pool.acquisition.auto_track.duration_ms",
        "db.pool.acquisition.outbox.duration_ms",
        "db.pool.acquisition.server_job.duration_ms",
        "db.pool.acquisition.health_check.duration_ms",
        "db.pool.acquisition.foreground_sync.duration_ms",
        "db.pool.acquisition.unknown.duration_ms",
      ].includes(key))).toBe(true);
  });

  it("requires a complete zero-write window before declaring the legacy cutoff ready", () => {
    const start = Date.parse("2030-03-10T00:00:00.000Z");
    clearCapacityTelemetryForTests(start);
    recordLegacySyncWrite("accepted", start + 1_000);

    expect(legacySyncReadinessSnapshot("accept", start + 60_000)).toMatchObject({
      status: "not-ready",
      acceptedLegacyWrites: 1,
      requiredAcceptedLegacyWrites: 0,
      fullWindowObserved: false,
    });

    const afterWindow = start + 24 * 60 * 60 * 1_000 + 61_000;
    expect(legacySyncReadinessSnapshot("accept", afterWindow)).toMatchObject({
      status: "ready",
      acceptedLegacyWrites: 0,
      fullWindowObserved: true,
    });
  });

  it("reports rejection mode and explicit evidence expiry without request-level data", () => {
    const start = Date.parse("2030-03-10T00:00:00.000Z");
    clearCapacityTelemetryForTests(start);
    recordLegacySyncWrite("rejected", start + 1_000);
    const snapshot = legacySyncReadinessSnapshot("reject", start + 60_000);
    expect(snapshot).toMatchObject({
      compatibilityMode: "reject",
      status: "rejection-enabled",
      rejectedLegacyWrites: 1,
      observedUntil: "2030-03-10T00:01:00.000Z",
      expiresAt: "2030-03-10T00:06:00.000Z",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/device|user|recipe|payload|facility|request/i);
  });

  it("emits one aggregate report and clears its window", () => {
    const info = vi.fn();
    recordSyncPut({
      mode: "fallback",
      outcome: "rejected",
      runsBucket: "0",
      sanitizedBytes: 0,
      wireBytes: 12,
      durationMs: 4,
      parserRejected: true,
    });
    recordSyncParserRejection(4_096);
    reportCapacityTelemetry({ info } as never);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "capacity_telemetry",
        counters: expect.objectContaining({
          "sync.put.fallback.rejected.count": 1,
          "sync.put.parser_rejected.count": 2,
        }),
      }),
      "bounded capacity telemetry",
    );
    expect(capacityTelemetrySnapshot().counters).toEqual({});
  });
});