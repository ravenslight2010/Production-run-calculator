import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

export type OperationOutcome = "success" | "error" | "degraded";
export type CacheMaintenanceOutcome = "success" | "error";
export type CacheMaintenanceScope = "live" | "sandbox";

type CacheMaintenanceLogger = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
};

const MAX_CACHE_MAINTENANCE_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_MAINTENANCE_FAILURE_THRESHOLD = 3;
export const CACHE_MAINTENANCE_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const CACHE_MAINTENANCE_FAILURE_MAX_EVENTS = 100;
const CACHE_MAINTENANCE_OPERATION = "prune" as const;
const CACHE_MAINTENANCE_SCOPES: CacheMaintenanceScope[] = ["live", "sandbox"];
const cacheMaintenanceFailureTimes = new Map<string, number[]>();
const cacheMaintenanceAlerts = new Set<string>();

const OPERATION_NAMES: Array<[RegExp, string]> = [
  [/\/sync(?:\/|$)/, "sync"],
  [/\/(?:ai|photo|quality|label|waste)/, "ai"],
  [/\/(?:inventory|ingredients|mixes)/, "inventory"],
  [/\/(?:export|reports)/, "export"],
  [/\/(?:roles|auth|staff|permissions)/, "permission"],
  [/\/(?:import|spec-sheet|shipping-guide|premix)/, "import"],
];

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

export function getCacheMaintenanceDiagnostics(
  now = Date.now(),
): Record<CacheMaintenanceScope, CacheMaintenanceDiagnostic> {
  return Object.fromEntries(
    CACHE_MAINTENANCE_SCOPES.map((scope) => {
      const recent = recentCacheMaintenanceFailures(scope, now);
      const lastError = recent[recent.length - 1];
      return [
        scope,
        {
          status: recent.length >= CACHE_MAINTENANCE_FAILURE_THRESHOLD ? "warning" : "ok",
          recentErrorCount: recent.length,
          threshold: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
          windowMs: CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
          ...(lastError === undefined ? {} : { lastErrorAt: new Date(lastError).toISOString() }),
        },
      ];
    }),
  ) as Record<CacheMaintenanceScope, CacheMaintenanceDiagnostic>;
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
): void {
  const recurrence = trackCacheMaintenanceFailure(fields.scope, fields.outcome, Date.now());
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

  if (recurrence.shouldAlert) {
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
  }
}

/** Reset process-local cache diagnostics between isolated test runs. */
export function clearCacheMaintenanceDiagnosticsForTests(): void {
  cacheMaintenanceFailureTimes.clear();
  cacheMaintenanceAlerts.clear();
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
