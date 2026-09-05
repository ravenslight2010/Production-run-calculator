import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import { cacheMaintenanceEventsTable, db } from "@workspace/db";
import { logger } from "./logger";
import type { StartupHealthSnapshot } from "./startupHealth";

export type OperationOutcome = "success" | "error" | "degraded";
export type CacheMaintenanceOutcome = "success" | "error";
export type CacheMaintenanceScope = "live" | "sandbox";

type CacheMaintenanceLogger = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
};

export { recordCostLimitEvent } from "./costLimitTelemetry";

const MAX_CACHE_MAINTENANCE_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_MAINTENANCE_FAILURE_THRESHOLD = 3;
export const CACHE_MAINTENANCE_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const CACHE_MAINTENANCE_FAILURE_MAX_EVENTS = 100;
const CACHE_MAINTENANCE_OPERATION = "prune" as const;
const CACHE_MAINTENANCE_SCOPES: CacheMaintenanceScope[] = ["live", "sandbox"];
const CACHE_MAINTENANCE_SHARED_MAX_ROWS = CACHE_MAINTENANCE_FAILURE_MAX_EVENTS;
const CACHE_MAINTENANCE_SHARED_TIMEOUT_MS = 1_000;
// Keep the PostgreSQL deadline shorter than the caller's fallback deadline.
// Promise.race alone only stops waiting for a query; it does not stop the
// transaction that owns the pool connection.
const CACHE_MAINTENANCE_SHARED_DB_TIMEOUT_MS =
  CACHE_MAINTENANCE_SHARED_TIMEOUT_MS - 100;
const cacheMaintenanceFailureTimes = new Map<string, number[]>();
const cacheMaintenanceAlerts = new Set<string>();
// The cache path records diagnostics fire-and-forget so telemetry can never
// block a cache operation. Track the in-flight shared-failure writes so test
// isolation can wait for them before asserting on the shared events table.
const pendingSharedCacheMaintenance = new Set<Promise<unknown>>();

function trackPendingSharedCacheMaintenance<T>(promise: Promise<T>): Promise<T> {
  pendingSharedCacheMaintenance.add(promise);
  promise.then(
    () => pendingSharedCacheMaintenance.delete(promise),
    () => pendingSharedCacheMaintenance.delete(promise),
  );
  return promise;
}

const OPERATION_NAMES: Array<[RegExp, string]> = [
  [/^\/(?:api\/)?(?:healthz|readyz|livez)\/?$/, "health"],
  [/^\/api\/?$/, "health"],
  [/\/sync(?:\/|$)/, "sync"],
  [/\/(?:ai|photo|quality|label|waste)/, "ai"],
  [/\/(?:inventory|ingredients|mixes)/, "inventory"],
  [/\/(?:export|reports)/, "export"],
  [/\/(?:roles|auth|staff|permissions)/, "permission"],
  [/\/(?:import|spec-sheet|shipping-guide|premix)/, "import"],
];

export function isHealthProbePath(path: string): boolean {
  return operationType(path) === "health";
}
export function operationType(path: string): string {
  return OPERATION_NAMES.find(([pattern]) => pattern.test(path))?.[1] ?? "request";
}

export function safeQueueAgeMs(queuedAt: unknown, now = Date.now()): number | undefined {
  if (typeof queuedAt !== "number" || !Number.isFinite(queuedAt)) return undefined;
  const age = now - queuedAt;
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000 ? Math.round(age) : undefined;
}

export type CacheMaintenanceDiagnostic = {
  status: "ok" | "warning";
  recentErrorCount: number;
  threshold: number;
  windowMs: number;
  lastErrorAt?: string;
};

function cacheMaintenanceKey(scope: CacheMaintenanceScope): string {
  return `${scope}:${CACHE_MAINTENANCE_OPERATION}`;
}

function recentCacheMaintenanceFailures(scope: CacheMaintenanceScope, now: number): number[] {
  const cutoff = now - CACHE_MAINTENANCE_FAILURE_WINDOW_MS;
  const key = cacheMaintenanceKey(scope);
  const recent = (cacheMaintenanceFailureTimes.get(key) ?? [])
    .filter((timestamp) => timestamp >= cutoff)
    .slice(-CACHE_MAINTENANCE_FAILURE_MAX_EVENTS);
  if (recent.length > 0) {
    cacheMaintenanceFailureTimes.set(key, recent);
  } else {
    cacheMaintenanceFailureTimes.delete(key);
    cacheMaintenanceAlerts.delete(key);
  }
  return recent;
}

export async function getCacheMaintenanceDiagnostics(
  now = Date.now(),
): Promise<Record<CacheMaintenanceScope, CacheMaintenanceDiagnostic>> {
  const diagnostics = await Promise.all(
    CACHE_MAINTENANCE_SCOPES.map(async (scope) => {
      try {
        return [scope, await readSharedCacheMaintenanceDiagnostic(scope, now)] as const;
      } catch {
        // Health diagnostics must remain available when the optional shared
        // telemetry store is missing or unavailable.
        return [scope, localCacheMaintenanceDiagnostic(scope, now)] as const;
      }
    }),
  );
  return Object.fromEntries(diagnostics) as Record<CacheMaintenanceScope, CacheMaintenanceDiagnostic>;
}

function trackCacheMaintenanceFailure(
  scope: CacheMaintenanceScope,
  outcome: CacheMaintenanceOutcome,
  now: number,
): { recentErrorCount: number; shouldAlert: boolean } {
  let recent = recentCacheMaintenanceFailures(scope, now);
  if (outcome === "error") {
    recent.push(now);
    recent = recent.slice(-CACHE_MAINTENANCE_FAILURE_MAX_EVENTS);
    cacheMaintenanceFailureTimes.set(cacheMaintenanceKey(scope), recent);
  }

  const recurring = recent.length >= CACHE_MAINTENANCE_FAILURE_THRESHOLD;
  const key = cacheMaintenanceKey(scope);
  const shouldAlert = recurring && !cacheMaintenanceAlerts.has(key);
  if (recurring) {
    cacheMaintenanceAlerts.add(key);
  } else {
    cacheMaintenanceAlerts.delete(key);
  }
  return { recentErrorCount: recent.length, shouldAlert };
}

function localCacheMaintenanceDiagnostic(
  scope: CacheMaintenanceScope,
  now: number,
): CacheMaintenanceDiagnostic {
  const recent = recentCacheMaintenanceFailures(scope, now);
  const lastError = recent[recent.length - 1];
  return {
    status: recent.length >= CACHE_MAINTENANCE_FAILURE_THRESHOLD ? "warning" : "ok",
    recentErrorCount: recent.length,
    threshold: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
    windowMs: CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
    ...(lastError === undefined ? {} : { lastErrorAt: new Date(lastError).toISOString() }),
  };
}

type SharedCacheMaintenanceResult = {
  recentErrorCount: number;
  shouldAlert: boolean;
};

function sharedCacheMaintenanceWhere(scope: CacheMaintenanceScope, cutoff: Date) {
  return and(
    eq(cacheMaintenanceEventsTable.scope, scope),
    eq(cacheMaintenanceEventsTable.operation, CACHE_MAINTENANCE_OPERATION),
    gte(cacheMaintenanceEventsTable.occurredAt, cutoff),
  );
}

async function withSharedDiagnosticsTimeout<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("cache maintenance diagnostics timed out")),
          CACHE_MAINTENANCE_SHARED_TIMEOUT_MS,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function configureSharedDiagnosticsTimeout(tx: {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}): Promise<void> {
  await tx.execute(
    sql`SELECT set_config(
      'statement_timeout',
      ${`${CACHE_MAINTENANCE_SHARED_DB_TIMEOUT_MS}ms`},
      true
    ), set_config(
      'lock_timeout',
      ${`${CACHE_MAINTENANCE_SHARED_DB_TIMEOUT_MS}ms`},
      true
    )`,
  );
}

async function readSharedCacheMaintenanceDiagnostic(
  scope: CacheMaintenanceScope,
  now: number,
): Promise<CacheMaintenanceDiagnostic> {
  const cutoff = new Date(now - CACHE_MAINTENANCE_FAILURE_WINDOW_MS);
  const rows = await withSharedDiagnosticsTimeout(
    db.transaction(async (tx) => {
      await configureSharedDiagnosticsTimeout(tx);
      await tx
        .delete(cacheMaintenanceEventsTable)
        .where(
          and(
            eq(cacheMaintenanceEventsTable.scope, scope),
            eq(cacheMaintenanceEventsTable.operation, CACHE_MAINTENANCE_OPERATION),
            lt(cacheMaintenanceEventsTable.occurredAt, cutoff),
          ),
        );
      return tx
        .select({ occurredAt: cacheMaintenanceEventsTable.occurredAt })
        .from(cacheMaintenanceEventsTable)
        .where(sharedCacheMaintenanceWhere(scope, cutoff))
        .orderBy(desc(cacheMaintenanceEventsTable.occurredAt), desc(cacheMaintenanceEventsTable.id))
        .limit(CACHE_MAINTENANCE_SHARED_MAX_ROWS);
    }),
  );
  const lastError = rows[0]?.occurredAt;
  return {
    status: rows.length >= CACHE_MAINTENANCE_FAILURE_THRESHOLD ? "warning" : "ok",
    recentErrorCount: rows.length,
    threshold: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
    windowMs: CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
    ...(lastError === undefined ? {} : { lastErrorAt: lastError.toISOString() }),
  };
}

async function recordSharedCacheMaintenanceFailure(
  scope: CacheMaintenanceScope,
  now: number,
): Promise<SharedCacheMaintenanceResult> {
  return withSharedDiagnosticsTimeout(
    db.transaction(async (tx) => {
      await configureSharedDiagnosticsTimeout(tx);
      const lockKey = `cache-maintenance:${scope}:${CACHE_MAINTENANCE_OPERATION}`;
      await tx.execute(
        // Serialize the read/insert/trim sequence so exactly one API instance
        // observes the threshold crossing and emits the episode warning.
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );

      const cutoff = new Date(now - CACHE_MAINTENANCE_FAILURE_WINDOW_MS);
      await tx
        .delete(cacheMaintenanceEventsTable)
        .where(
          and(
            eq(cacheMaintenanceEventsTable.scope, scope),
            eq(cacheMaintenanceEventsTable.operation, CACHE_MAINTENANCE_OPERATION),
            lt(cacheMaintenanceEventsTable.occurredAt, cutoff),
          ),
        );
      const where = sharedCacheMaintenanceWhere(scope, cutoff);
      const before = await tx
        .select({ id: cacheMaintenanceEventsTable.id })
        .from(cacheMaintenanceEventsTable)
        .where(where)
        .limit(CACHE_MAINTENANCE_FAILURE_THRESHOLD);

      await tx.insert(cacheMaintenanceEventsTable).values({
        scope,
        operation: CACHE_MAINTENANCE_OPERATION,
        occurredAt: new Date(now),
      });

      const retained = await tx
        .select({
          id: cacheMaintenanceEventsTable.id,
          occurredAt: cacheMaintenanceEventsTable.occurredAt,
        })
        .from(cacheMaintenanceEventsTable)
        .where(where)
        .orderBy(desc(cacheMaintenanceEventsTable.occurredAt), desc(cacheMaintenanceEventsTable.id))
        .limit(CACHE_MAINTENANCE_SHARED_MAX_ROWS + 1);
      const keep = retained.slice(0, CACHE_MAINTENANCE_SHARED_MAX_ROWS);
      if (retained.length > keep.length) {
        await tx
          .delete(cacheMaintenanceEventsTable)
          .where(
            and(
              eq(cacheMaintenanceEventsTable.scope, scope),
              eq(cacheMaintenanceEventsTable.operation, CACHE_MAINTENANCE_OPERATION),
              notInArray(
                cacheMaintenanceEventsTable.id,
                keep.map((row) => row.id),
              ),
            ),
          );
      }

      const lastError = keep[0]?.occurredAt;
      return {
        recentErrorCount: keep.length,
        shouldAlert:
          before.length < CACHE_MAINTENANCE_FAILURE_THRESHOLD &&
          keep.length >= CACHE_MAINTENANCE_FAILURE_THRESHOLD,
      };
    }),
  );
}

function safeCacheMaintenanceWaitMs(waitDurationMs: unknown): number {
  if (typeof waitDurationMs !== "number" || !Number.isFinite(waitDurationMs)) return 0;
  return Math.min(MAX_CACHE_MAINTENANCE_WAIT_MS, Math.max(0, Math.round(waitDurationMs)));
}

/**
 * Emit bounded cache-maintenance diagnostics without retaining cache keys or
 * any request/provider data. Telemetry is best-effort and must never alter
 * cache behavior if a logger is unavailable or throws.
 */
export function recordCacheMaintenance(
  fields: {
    scope: CacheMaintenanceScope;
    operation: "prune";
    waitDurationMs: number;
    outcome: CacheMaintenanceOutcome;
  },
  log: CacheMaintenanceLogger = logger,
): Promise<void> {
  const now = Date.now();
  const recurrence = trackCacheMaintenanceFailure(fields.scope, fields.outcome, now);
  try {
    log.info?.(
      {
        event: "cache_maintenance",
        scope: fields.scope,
        operation: fields.operation,
        waitDurationMs: safeCacheMaintenanceWaitMs(fields.waitDurationMs),
        outcome: fields.outcome,
      },
      "cache maintenance completed",
    );
  } catch {
    // Observability is intentionally fail-safe. A broken logger must not turn
    // an otherwise successful cache/provider operation into a failure.
  }

  if (fields.outcome !== "error") return Promise.resolve();

  return trackPendingSharedCacheMaintenance(
    recordSharedCacheMaintenanceFailure(fields.scope, now),
  )
    .then((sharedRecurrence) => {
      if (!sharedRecurrence.shouldAlert) return;
      try {
        log.warn?.(
          {
            event: "cache_maintenance_recurrence",
            scope: fields.scope,
            operation: fields.operation,
            recentErrorCount: sharedRecurrence.recentErrorCount,
            threshold: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
            windowMs: CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
          },
          "cache maintenance failures recurring",
        );
      } catch {
        // A warning logger failure must not change cache behavior.
      }
    })
    .catch(() => {
      // If shared diagnostics are unavailable, retain the original
      // process-local recurrence warning as a safe fallback.
      if (!recurrence.shouldAlert) return;
      try {
        log.warn?.(
          {
            event: "cache_maintenance_recurrence",
            scope: fields.scope,
            operation: fields.operation,
            recentErrorCount: recurrence.recentErrorCount,
            threshold: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
            windowMs: CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
          },
          "cache maintenance failures recurring",
        );
      } catch {
        // A warning logger failure must not change cache behavior.
      }
    });
}

/** Reset cache diagnostics between isolated test runs. */
export async function clearCacheMaintenanceDiagnosticsForTests(): Promise<void> {
  cacheMaintenanceFailureTimes.clear();
  cacheMaintenanceAlerts.clear();
  // Fire-and-forget diagnostics from the cache path can still be committing a
  // last event after the triggering test finishes; wait for them so the
  // subsequent delete is deterministic instead of racing the insert.
  const pending = [...pendingSharedCacheMaintenance];
  if (pending.length > 0) {
    await Promise.allSettled(pending);
  }
  try {
    await db.delete(cacheMaintenanceEventsTable);
  } catch {
    // Unit tests may not provide the shared diagnostics table or database.
  }
}

function numericHeader(res: Response, name: string): number | undefined {
  const value = Number(res.getHeader(name));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_.-]{1,64}$/.test(code)
    ? code
    : "internal_error";
}

export function logOperation(
  log: Logger,
  fields: {
    correlationId: string;
    operationType: string;
    durationMs: number;
    outcome: OperationOutcome;
    statusCode?: number;
    safeCounts?: Record<string, number>;
    errorCode?: string;
    [key: string]: unknown;
  },
): void {
  const level = fields.outcome === "error" ? "warn" : "info";
  log[level](
    {
      event: "operation",
      correlationId: fields.correlationId,
      operationType: fields.operationType,
      durationMs: Math.max(0, Math.round(fields.durationMs)),
      outcome: fields.outcome,
      ...(fields.statusCode === undefined ? {} : { statusCode: fields.statusCode }),
      ...(fields.safeCounts ? { safeCounts: fields.safeCounts } : {}),
      ...(fields.errorCode ? { errorCode: fields.errorCode } : {}),
      ...(fields.syncResponse ? { syncResponse: fields.syncResponse } : {}),
      ...(fields.syncRetries === undefined ? {} : { syncRetries: fields.syncRetries }),
      ...(fields.syncQueueAgeMs === undefined ? {} : { syncQueueAgeMs: fields.syncQueueAgeMs }),
      ...(fields.syncConvergence ? { syncConvergence: fields.syncConvergence } : {}),
    },
    "operation completed",
  );
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestCorrelationId =
    typeof req.header("x-correlation-id") === "string" &&
    /^[a-zA-Z0-9_.:-]{1,128}$/.test(req.header("x-correlation-id")!)
      ? req.header("x-correlation-id")!
      : typeof req.id === "string" ? req.id : randomUUID();
  const correlationId = requestCorrelationId;
  const startedAt = performance.now();
  res.setHeader("X-Correlation-ID", correlationId);
  (req as Request & { correlationId?: string }).correlationId = correlationId;

  res.once("finish", () => {
    // The health handler emits its own bounded health_check event. Avoid
    // duplicating platform 503 polls as generic degraded operations.
    if (isHealthProbePath(req.path)) return;
    const statusCode = res.statusCode;
    logOperation((req as Request & { log?: Logger }).log ?? logger, {
      correlationId,
      operationType: operationType(req.path),
      durationMs: performance.now() - startedAt,
      outcome: statusCode >= 500 ? "error" : statusCode >= 400 ? "degraded" : "success",
      statusCode,
      safeCounts: { responseBytes: Number(res.getHeader("content-length") ?? 0) },
      ...(res.getHeader("X-Sync-Response") ? { syncResponse: res.getHeader("X-Sync-Response") } : {}),
      ...(numericHeader(res, "X-Sync-Retry-Count") === undefined ? {} : { syncRetries: numericHeader(res, "X-Sync-Retry-Count") }),
      ...(numericHeader(res, "X-Sync-Queue-Age-Ms") === undefined ? {} : { syncQueueAgeMs: numericHeader(res, "X-Sync-Queue-Age-Ms") }),
      ...(res.getHeader("X-Sync-Convergence") ? { syncConvergence: res.getHeader("X-Sync-Convergence") } : {}),
    });
  });
  next();
}

export function recordStartupEvent(
  event: string,
  fields: { durationMs: number; outcome: OperationOutcome; safeCounts?: Record<string, number>; errorCode?: string },
): void {
  logOperation(logger, {
    correlationId: `startup-${process.pid}`,
    operationType: "startup",
    ...fields,
    startupEvent: event,
  });
}

type StartupWarningLogger = Pick<Logger, "warn">;

export function recordStartupSlowWarning(
  startup: StartupHealthSnapshot,
  log: StartupWarningLogger = logger,
): void {
  try {
    log.warn(
      {
        event: "startup_slow",
        stage: startup.stage,
        durationMs: Math.max(0, Math.round(startup.durationMs)),
        outcome: "degraded",
        errorCode: startup.failure?.errorCode ?? "initialization_in_progress",
      },
      "Startup initialization is taking longer than expected",
    );
  } catch {
    // Observability is fail-safe. A broken warning logger must not affect boot.
  }
}
