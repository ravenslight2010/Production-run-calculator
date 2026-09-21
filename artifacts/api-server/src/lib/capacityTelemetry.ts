import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import { logger } from "./logger";

const MAX_SAMPLES = 2_048;
const REPORT_INTERVAL_MS = 60_000;
const MAX_METRIC_VALUE = 10 * 60 * 1_000;

export type SyncPutMode = "complete" | "partial" | "fallback" | "unchanged";
export type SseFrameMode = "complete" | "partial";

type Distribution = {
  count: number;
  samples: number[];
  max: number;
};

type CapacitySnapshot = {
  windowMs: number;
  counters: Record<string, number>;
  distributions: Record<string, {
    count: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  }>;
  pool: {
    total: number;
    idle: number;
    waiting: number;
  };
};

const counters = new Map<string, number>();
const distributions = new Map<string, Distribution>();
let windowStartedAt = Date.now();
let lastReportAt = windowStartedAt;
let latestPool = { total: 0, idle: 0, waiting: 0 };
let installedPool: Pool | undefined;

function bounded(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_METRIC_VALUE, Math.max(0, Math.round(value)))
    : 0;
}

function increment(key: string): void {
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

function observe(key: string, value: number): void {
  const safe = bounded(value);
  const metric = distributions.get(key) ?? { count: 0, samples: [], max: 0 };
  metric.count += 1;
  metric.max = Math.max(metric.max, safe);
  if (metric.samples.length < MAX_SAMPLES) {
    metric.samples.push(safe);
  } else {
    // Deterministic bounded reservoir: retain evenly spaced observations from
    // the whole process window without storing request-level records.
    const index = metric.count % MAX_SAMPLES;
    metric.samples[index] = safe;
  }
  distributions.set(key, metric);
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export function syncRunCountBucket(payload: unknown): "0" | "1-5" | "6-20" | "21-50" {
  const root = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const dayState = root.dayState && typeof root.dayState === "object" && !Array.isArray(root.dayState)
    ? root.dayState as Record<string, unknown>
    : {};
  const count = Math.min(50, Array.isArray(dayState.runs) ? dayState.runs.length : 0);
  if (count === 0) return "0";
  if (count <= 5) return "1-5";
  if (count <= 20) return "6-20";
  return "21-50";
}

export function recordSyncPut(fields: {
  mode: SyncPutMode;
  outcome: "accepted" | "rejected";
  runsBucket: ReturnType<typeof syncRunCountBucket>;
  sanitizedBytes: number;
  wireBytes: number;
  durationMs: number;
  parserRejected?: boolean;
}): void {
  const prefix = `sync.put.${fields.mode}.${fields.outcome}`;
  increment(`${prefix}.count`);
  increment(`sync.put.runs.${fields.runsBucket}`);
  if (fields.parserRejected) increment("sync.put.parser_rejected.count");
  observe(`${prefix}.sanitized_bytes`, fields.sanitizedBytes);
  observe(`${prefix}.wire_bytes`, fields.wireBytes);
  observe(`${prefix}.duration_ms`, fields.durationMs);
  maybeReport();
}

export function recordSseFrame(fields: {
  mode: SseFrameMode;
  frameBytes: number;
  durationMs: number;
  outcome: "sent" | "write_failed";
}): void {
  const prefix = `sync.sse.${fields.mode}.${fields.outcome}`;
  increment(`${prefix}.count`);
  observe(`${prefix}.frame_bytes`, fields.frameBytes);
  observe(`${prefix}.duration_ms`, fields.durationMs);
  maybeReport();
}

export function recordSyncTransaction(durationMs: number): void {
  observe("db.sync_transaction.duration_ms", durationMs);
  maybeReport();
}

export function recordSyncParserRejection(wireBytes: number): void {
  increment("sync.put.parser_rejected.count");
  observe("sync.put.parser_rejected.wire_bytes", wireBytes);
  maybeReport();
}

function poolSnapshot(pool: Pool): void {
  latestPool = {
    total: bounded(pool.totalCount),
    idle: bounded(pool.idleCount),
    waiting: bounded(pool.waitingCount),
  };
  observe("db.pool.total", latestPool.total);
  observe("db.pool.idle", latestPool.idle);
  observe("db.pool.waiting", latestPool.waiting);
}

export function installPoolTelemetry(pool: Pool): void {
  if (installedPool === pool) return;
  installedPool = pool;
  const originalConnect = pool.connect.bind(pool);
  pool.connect = ((callback?: (err: Error | undefined, client: PoolClient | undefined, release: (releaseError?: Error | boolean) => void) => void) => {
    const startedAt = performance.now();
    if (callback) {
      return originalConnect((error, client, release) => {
        observe("db.pool.acquisition_ms", performance.now() - startedAt);
        poolSnapshot(pool);
        maybeReport();
        callback(error, client, release);
      });
    }
    return originalConnect().then(
      (client) => {
        observe("db.pool.acquisition_ms", performance.now() - startedAt);
        poolSnapshot(pool);
        maybeReport();
        return client;
      },
      (error) => {
        increment("db.pool.acquisition_error.count");
        observe("db.pool.acquisition_ms", performance.now() - startedAt);
        poolSnapshot(pool);
        maybeReport();
        throw error;
      },
    );
  }) as Pool["connect"];
}

export function capacityTelemetrySnapshot(now = Date.now()): CapacitySnapshot {
  const result: CapacitySnapshot["distributions"] = {};
  for (const [key, value] of distributions) {
    const sorted = [...value.samples].sort((a, b) => a - b);
    result[key] = {
      count: value.count,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: value.max,
    };
  }
  return {
    windowMs: Math.max(0, now - windowStartedAt),
    counters: Object.fromEntries(counters),
    distributions: result,
    pool: { ...latestPool },
  };
}

export function reportCapacityTelemetry(log: Pick<Logger, "info"> = logger, now = Date.now()): void {
  const snapshot = capacityTelemetrySnapshot(now);
  if (Object.keys(snapshot.counters).length === 0 && Object.keys(snapshot.distributions).length === 0) return;
  try {
    log.info({ event: "capacity_telemetry", ...snapshot }, "bounded capacity telemetry");
  } catch {
    // Telemetry must never affect sync or database behavior.
  }
  counters.clear();
  distributions.clear();
  windowStartedAt = now;
  lastReportAt = now;
}

function maybeReport(now = Date.now()): void {
  if (now - lastReportAt >= REPORT_INTERVAL_MS) reportCapacityTelemetry(logger, now);
}

export function clearCapacityTelemetryForTests(now = Date.now()): void {
  counters.clear();
  distributions.clear();
  latestPool = { total: 0, idle: 0, waiting: 0 };
  windowStartedAt = now;
  lastReportAt = now;
}