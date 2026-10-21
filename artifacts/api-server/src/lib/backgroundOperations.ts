import { and, desc, eq, gte, gt, lt, ne, notInArray, sql } from "drizzle-orm";
import {
  automaticTrackingDeferredDiagnosticsTable,
  backgroundOperationEventsTable,
  db,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { createSharedDiagnosticPersistence } from "./sharedDiagnosticPersistence";

export const BACKGROUND_OPERATION_FAILURE_THRESHOLD = 3;
export const BACKGROUND_OPERATION_RETRY_DELAY_MS = 100;
export const BACKGROUND_OPERATION_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const BACKGROUND_OPERATION_FAILURE_MAX_EVENTS = 100;
export const BACKGROUND_OPERATION_BACKOFF_BASE_MS = 1_000;
export const BACKGROUND_OPERATION_BACKOFF_MAX_MS = 30_000;
export const AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP = 100;
const AUTO_TRACK_DEFERRED_RETRY_TRACKING_CAP = 256;
const AUTO_TRACK_DEFERRED_DIAGNOSTIC_STALE_MS = 60_000;
const BACKGROUND_OPERATION_SHARED_TIMEOUT_MS = 1_000;
const BACKGROUND_OPERATION_SHARED_DB_TIMEOUT_MS =
  BACKGROUND_OPERATION_SHARED_TIMEOUT_MS - 100;
const PROCESS_INSTANCE_STARTED_AT = Date.now();
const PROCESS_INSTANCE_ID = randomUUID();
const sharedBackgroundOperationPersistence = createSharedDiagnosticPersistence({
  callerTimeoutMs: BACKGROUND_OPERATION_SHARED_TIMEOUT_MS,
  databaseTimeoutMs: BACKGROUND_OPERATION_SHARED_DB_TIMEOUT_MS,
  timeoutMessage: "background operation diagnostics timed out",
});

/** Test-only visibility for the process fence; production callers must not use it. */
export function getBackgroundOperationProcessEpochForTests(): number {
  return PROCESS_INSTANCE_STARTED_AT;
}

export type BackgroundOperationName =
  | "auth-retention"
  | "import-source-retention"
  | "daily-rollover"
  | "server-auto-track-tick"
  | "server-job-run"
  | "server-job-prune"
  | "web-push-schedule"
  | "sync-outbox-drain";

type OperationState = {
  failureTimes: number[];
  lastFailureAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: string;
};

export type BackgroundOperationDiagnostic = {
  status: "ok" | "warning";
  recentFailureCount: number;
  threshold: number;
  windowMs: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  errorCode?: string;
};

export type BackgroundOperationBackoff = {
  isReady(now?: number): boolean;
  nextRetryAt(now?: number): number | undefined;
  recordSuccess(now?: number): void;
  recordFailure(now?: number): void;
};

export type AutoTrackDeferredDiagnostic = {
  deferredDateCount: number;
  deferredDateCountCapped: boolean;
  nextEligibleRetryAt: string | null;
};

let autoTrackDeferredRetryTimes: number[] = [];

export function recordAutoTrackDeferredRetries(retryTimes: number[]): void {
  autoTrackDeferredRetryTimes = retryTimes
    .filter((retryAt) => Number.isFinite(retryAt) && retryAt > 0)
    .sort((left, right) => left - right)
    .slice(0, AUTO_TRACK_DEFERRED_RETRY_TRACKING_CAP);
}

export function getAutoTrackDeferredDiagnostic(now = Date.now()): AutoTrackDeferredDiagnostic {
  const activeRetryTimes = autoTrackDeferredRetryTimes.filter((retryAt) => retryAt > now);
  const deferredDateCount = Math.min(activeRetryTimes.length, AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP);
  return {
    deferredDateCount,
    deferredDateCountCapped: activeRetryTimes.length > AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP,
    nextEligibleRetryAt: activeRetryTimes.length > 0
      ? new Date(activeRetryTimes[0]).toISOString()
      : null,
  };
}

export async function getSharedAutoTrackDeferredDiagnostic(
  now = Date.now(),
): Promise<AutoTrackDeferredDiagnostic> {
  const local = getAutoTrackDeferredDiagnostic(now);
  const [remote] = await sharedBackgroundOperationPersistence.run((tx) =>
    tx.select({
      deferredDateCount: sql<number>`LEAST(
        COALESCE(SUM(${automaticTrackingDeferredDiagnosticsTable.deferredDateCount}), 0),
        ${AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP + 1}
      )::int`,
      deferredDateCountCapped: sql<boolean>`COALESCE(
        BOOL_OR(${automaticTrackingDeferredDiagnosticsTable.deferredDateCountCapped}),
        false
      )`,
      nextEligibleRetryAt: sql<Date | null>`MIN(
        ${automaticTrackingDeferredDiagnosticsTable.nextEligibleRetryAt}
      )`,
    })
      .from(automaticTrackingDeferredDiagnosticsTable)
      .where(and(
        gte(
          automaticTrackingDeferredDiagnosticsTable.updatedAt,
          new Date(now - AUTO_TRACK_DEFERRED_DIAGNOSTIC_STALE_MS),
        ),
        gt(automaticTrackingDeferredDiagnosticsTable.nextEligibleRetryAt, new Date(now)),
        ne(automaticTrackingDeferredDiagnosticsTable.sourceInstance, PROCESS_INSTANCE_ID),
      )),
  );
  const remoteCount = Number(remote?.deferredDateCount ?? 0);
  const total = local.deferredDateCount + remoteCount;
  const remoteRetryAt = remote?.nextEligibleRetryAt == null
    ? Number.POSITIVE_INFINITY
    : Date.parse(String(remote.nextEligibleRetryAt));
  const retryTimes = [
    local.nextEligibleRetryAt ? Date.parse(local.nextEligibleRetryAt) : Number.POSITIVE_INFINITY,
    remoteRetryAt,
  ];
  const nextRetryAt = Math.min(...retryTimes);
  return {
    deferredDateCount: Math.min(total, AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP),
    deferredDateCountCapped:
      local.deferredDateCountCapped ||
      Boolean(remote?.deferredDateCountCapped) ||
      remoteCount > AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP ||
      total > AUTO_TRACK_DEFERRED_DATE_DIAGNOSTIC_CAP,
    nextEligibleRetryAt: Number.isFinite(nextRetryAt) ? new Date(nextRetryAt).toISOString() : null,
  };
}

export async function persistAutoTrackDeferredDiagnostic(now = Date.now()): Promise<void> {
  const diagnostic = getAutoTrackDeferredDiagnostic(now);
  await sharedBackgroundOperationPersistence.runOrFallback(
    async (tx) => {
      await tx.delete(automaticTrackingDeferredDiagnosticsTable).where(
        lt(
          automaticTrackingDeferredDiagnosticsTable.updatedAt,
          new Date(now - AUTO_TRACK_DEFERRED_DIAGNOSTIC_STALE_MS),
        ),
      );
      await tx.insert(automaticTrackingDeferredDiagnosticsTable).values({
        sourceInstance: PROCESS_INSTANCE_ID,
        deferredDateCount: diagnostic.deferredDateCount,
        deferredDateCountCapped: diagnostic.deferredDateCountCapped,
        nextEligibleRetryAt: diagnostic.nextEligibleRetryAt
          ? new Date(diagnostic.nextEligibleRetryAt)
          : null,
        updatedAt: new Date(now),
      }).onConflictDoUpdate({
        target: automaticTrackingDeferredDiagnosticsTable.sourceInstance,
        set: {
          deferredDateCount: diagnostic.deferredDateCount,
          deferredDateCountCapped: diagnostic.deferredDateCountCapped,
          nextEligibleRetryAt: diagnostic.nextEligibleRetryAt
            ? new Date(diagnostic.nextEligibleRetryAt)
            : null,
          updatedAt: new Date(now),
        },
      });
    },
    () => undefined,
  );
}

export function createBackgroundOperationBackoff(options: {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  random?: () => number;
} = {}): BackgroundOperationBackoff {
  const baseDelayMs = Math.max(1, Math.floor(options.baseDelayMs ?? BACKGROUND_OPERATION_BACKOFF_BASE_MS));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options.maxDelayMs ?? BACKGROUND_OPERATION_BACKOFF_MAX_MS));
  const random = options.random ?? Math.random;
  let consecutiveFailures = 0;
  let retryAt = 0;

  return {
    isReady(now = Date.now()) {
      return now >= retryAt;
    },
    nextRetryAt(now = Date.now()) {
      return retryAt > now ? retryAt : undefined;
    },
    recordSuccess() {
      consecutiveFailures = 0;
      retryAt = 0;
    },
    recordFailure(now = Date.now()) {
      const exponent = Math.min(consecutiveFailures, 30);
      const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
      let delayMs = exponentialDelayMs;
      if (options.jitter) {
        const sample = random();
        const boundedSample = Number.isFinite(sample)
          ? Math.min(1, Math.max(0, sample))
          : 0.5;
        // Equal jitter spreads retries while retaining at least half the
        // exponential delay and never exceeding the configured maximum.
        delayMs = Math.max(1, Math.floor(exponentialDelayMs * (0.5 + boundedSample * 0.5)));
      }
      consecutiveFailures = Math.min(consecutiveFailures + 1, 31);
      retryAt = now + delayMs;
    },
  };
}

const operationNames: BackgroundOperationName[] = [
  "auth-retention",
  "import-source-retention",
  "daily-rollover",
  "server-auto-track-tick",
  "server-job-run",
  "server-job-prune",
  "web-push-schedule",
  "sync-outbox-drain",
];
const states = new Map<BackgroundOperationName, OperationState>();
const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  "57P01", "57P02", "57P03",
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT",
]);

export type BackgroundFailureReason =
  | "database-capacity"
  | "database-timeout"
  | "database-connection"
  | "database-permission"
  | "database-schema"
  | "database-conflict"
  | "database-error"
  | "dependency-timeout"
  | "dependency-connection"
  | "unexpected";

const DATABASE_TIMEOUT_CODES = new Set(["57014"]);
const DEPENDENCY_TIMEOUT_CODES = new Set(["ETIMEDOUT", "ETIMEOUT", "ESOCKETTIMEDOUT", "ECONNABORTED"]);
const DATABASE_CONNECTION_CODES = new Set([
  "57P01", "57P02", "57P03",
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
]);
const DEPENDENCY_CONNECTION_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
  "ERR_SOCKET_CLOSED",
]);

function errorCauses(error: unknown): unknown[] {
  const causes: unknown[] = [];
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current === "string") {
      causes.push(current);
      break;
    }
    if (!current || typeof current !== "object" || seen.has(current)) break;
    causes.push(current);
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return causes;
}

function errorCode(error: unknown): string | undefined {
  for (const cause of errorCauses(error)) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_.-]{1,64}$/i.test(code)) return code;
  }
  return undefined;
}

/** Fixed-cardinality labels only; database-only callers may classify generic socket errors as DB failures. */
export function classifyBackgroundFailure(
  error: unknown,
  options: { assumeDatabase?: boolean } = {},
): BackgroundFailureReason {
  for (const cause of errorCauses(error)) {
    const rawCode = (cause as { code?: unknown }).code;
    const code = typeof rawCode === "string" ? rawCode.toUpperCase() : "";
    if (code === "53300") return "database-capacity";
    if (DATABASE_TIMEOUT_CODES.has(code)) return "database-timeout";
    if (DEPENDENCY_TIMEOUT_CODES.has(code)) {
      return options.assumeDatabase ? "database-timeout" : "dependency-timeout";
    }
    if (code === "42501") return "database-permission";
    if (code === "42P01" || code === "42703" || code.startsWith("42")) return "database-schema";
    if (DATABASE_CONNECTION_CODES.has(code) || code.startsWith("08")) return "database-connection";
    if (DEPENDENCY_CONNECTION_CODES.has(code)) {
      return options.assumeDatabase ? "database-connection" : "dependency-connection";
    }
    if (code.startsWith("40") || code === "55P03") return "database-conflict";
    if (/^[0-9A-Z]{5}$/.test(code)) return "database-error";

    const message = cause instanceof Error
      ? cause.message.toLowerCase().trim()
      : typeof cause === "string" ? cause.toLowerCase().trim() : "";
    if (/too many clients already|remaining connection slots are reserved/.test(message)) {
      return "database-capacity";
    }
    if (/^(timeout exceeded when trying to connect|pool checkout timed out|query read timeout)$/.test(message) ||
      /canceling statement due to statement timeout/.test(message)) {
      return "database-timeout";
    }
    if (/terminating connection|server closed the connection unexpectedly/.test(message)) {
      return "database-connection";
    }
    if (/connection (terminated|closed|reset|refused)/.test(message)) {
      return options.assumeDatabase ? "database-connection" : "dependency-connection";
    }
  }
  return "unexpected";
}

/** Clamp and normalize elapsed-time fields before they reach logs or telemetry. */
export function boundedDurationMs(durationMs: number): number {
  return Number.isFinite(durationMs)
    ? Math.min(15 * 60_000, Math.max(0, Math.round(durationMs)))
    : 0;
}

export function isTransientDatabaseConnectionError(error: unknown): boolean {
  return errorCauses(error).some((cause) => {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_DATABASE_ERROR_CODES.has(code)) return true;
    const message = String(cause instanceof Error ? cause.message : cause).toLowerCase();
    return message === "timeout exceeded when trying to connect" ||
      /connection (?:terminated|closed|reset)|terminating connection|server closed the connection unexpectedly/.test(message);
  });
}

function recordSuccess(name: BackgroundOperationName, now: number): void {
  const previous = states.get(name);
  states.set(name, {
    failureTimes: previous?.failureTimes ?? [],
    lastFailureAt: previous?.lastFailureAt,
    lastSuccessAt: now,
    lastErrorCode: previous?.lastErrorCode,
  });
}

export async function recordBackgroundOperationFailure(
  name: BackgroundOperationName,
  error: unknown,
  now = Date.now(),
): Promise<void> {
  const previous = states.get(name);
  const safeCode = errorCode(error) ?? "operation_failed";
  states.set(name, {
    failureTimes: [...(previous?.failureTimes ?? []), now].slice(-BACKGROUND_OPERATION_FAILURE_MAX_EVENTS),
    lastFailureAt: now,
    lastSuccessAt: previous?.lastSuccessAt,
    lastErrorCode: safeCode,
  });
  const sharedWrite = sharedBackgroundOperationPersistence.track(
    recordSharedFailure(name, safeCode, now),
  );
  await sharedWrite;
}

export async function runBackgroundOperation<T>(
  name: BackgroundOperationName,
  operation: () => Promise<T>,
  options: {
    delay?: (ms: number) => Promise<void>;
    now?: () => number;
    recordSuccess?: boolean;
  } = {},
): Promise<T> {
  // Keep the short retry timer referenced: once a pass has started, shutdown
  // should not silently abandon its one recovery attempt.
  const delay = options.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  try {
    const result = await operation();
    if (options.recordSuccess !== false) recordSuccess(name, now());
    return result;
  } catch (firstError) {
    if (!isTransientDatabaseConnectionError(firstError)) {
      await recordBackgroundOperationFailure(name, firstError, now());
      throw firstError;
    }
    await delay(BACKGROUND_OPERATION_RETRY_DELAY_MS);
    try {
      const result = await operation();
      if (options.recordSuccess !== false) recordSuccess(name, now());
      return result;
    } catch (retryError) {
      await recordBackgroundOperationFailure(name, retryError, now());
      throw retryError;
    }
  }
}

export function recordBackgroundOperationSuccess(
  name: BackgroundOperationName,
  now = Date.now(),
): void {
  recordSuccess(name, now);
}

function localBackgroundOperationDiagnostics(
  now = Date.now(),
): Record<BackgroundOperationName, BackgroundOperationDiagnostic> {
  return Object.fromEntries(operationNames.map((name) => {
    const state = states.get(name) ?? { failureTimes: [] };
    const recentFailureTimes = state.failureTimes.filter(
      (failureAt) =>
        failureAt >= now - BACKGROUND_OPERATION_FAILURE_WINDOW_MS &&
        (state.lastSuccessAt === undefined || failureAt > state.lastSuccessAt),
    );
    const recentFailureCount = recentFailureTimes.length;
    return [name, {
      status: recentFailureCount >= BACKGROUND_OPERATION_FAILURE_THRESHOLD ? "warning" : "ok",
      recentFailureCount,
      threshold: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      windowMs: BACKGROUND_OPERATION_FAILURE_WINDOW_MS,
      ...(recentFailureCount === 0 || state.lastFailureAt === undefined
        ? {}
        : { lastFailureAt: new Date(state.lastFailureAt).toISOString() }),
      ...(state.lastSuccessAt === undefined ? {} : { lastSuccessAt: new Date(state.lastSuccessAt).toISOString() }),
      ...(recentFailureCount === 0 || state.lastErrorCode === undefined
        ? {}
        : { errorCode: state.lastErrorCode }),
    }];
  })) as Record<BackgroundOperationName, BackgroundOperationDiagnostic>;
}

async function recordSharedFailure(
  name: BackgroundOperationName,
  code: string,
  now: number,
): Promise<void> {
  await sharedBackgroundOperationPersistence.runOrFallback(
    async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(
          hashtextextended(${`background-operation:${name}`}, 0)
        )`,
      );
      const cutoff = new Date(now - BACKGROUND_OPERATION_FAILURE_WINDOW_MS);
      await tx.delete(backgroundOperationEventsTable).where(
        and(
          eq(backgroundOperationEventsTable.operation, name),
          lt(backgroundOperationEventsTable.occurredAt, cutoff),
        ),
      );
      await tx.insert(backgroundOperationEventsTable).values({
        operation: name,
        sourceInstance: PROCESS_INSTANCE_ID,
        errorCode: code,
        occurredAt: new Date(now),
      });
      const retained = await tx
        .select({ id: backgroundOperationEventsTable.id })
        .from(backgroundOperationEventsTable)
        .where(eq(backgroundOperationEventsTable.operation, name))
        .orderBy(desc(backgroundOperationEventsTable.occurredAt), desc(backgroundOperationEventsTable.id))
        .limit(BACKGROUND_OPERATION_FAILURE_MAX_EVENTS + 1);
      const obsoleteIds = retained
        .slice(BACKGROUND_OPERATION_FAILURE_MAX_EVENTS)
        .map(({ id }) => id);
      if (obsoleteIds.length > 0) {
        await tx.delete(backgroundOperationEventsTable).where(
          and(
            eq(backgroundOperationEventsTable.operation, name),
            notInArray(backgroundOperationEventsTable.id, retained
              .slice(0, BACKGROUND_OPERATION_FAILURE_MAX_EVENTS)
              .map(({ id }) => id)),
          ),
        );
      }
    },
    () => undefined,
  );
}

async function readSharedDiagnostics(
  now: number,
): Promise<Record<BackgroundOperationName, BackgroundOperationDiagnostic>> {
  const cutoff = new Date(now - BACKGROUND_OPERATION_FAILURE_WINDOW_MS);
  const rows = await sharedBackgroundOperationPersistence.run(async (tx) => {
    await tx.delete(backgroundOperationEventsTable).where(
      lt(backgroundOperationEventsTable.occurredAt, cutoff),
    );
    return tx
      .select({
        operation: backgroundOperationEventsTable.operation,
        sourceInstance: backgroundOperationEventsTable.sourceInstance,
        occurredAt: backgroundOperationEventsTable.occurredAt,
        errorCode: backgroundOperationEventsTable.errorCode,
      })
      .from(backgroundOperationEventsTable)
      .where(gte(backgroundOperationEventsTable.occurredAt, cutoff))
      .orderBy(desc(backgroundOperationEventsTable.occurredAt), desc(backgroundOperationEventsTable.id))
      .limit(BACKGROUND_OPERATION_FAILURE_MAX_EVENTS * operationNames.length);
  });
  return Object.fromEntries(operationNames.map((name) => {
    const local = states.get(name);
    // Shared rows survive process replacement so failures remain visible after
    // a crash. A first local success fences failures from instances that ended
    // before this one started. It never fences failures from a concurrent peer.
    // This instance's own failures remain recoverable by its later success.
    const operationRows = rows.filter((row) =>
      row.operation === name &&
      (
        local?.lastSuccessAt === undefined ||
        (
          row.sourceInstance === PROCESS_INSTANCE_ID
            ? row.occurredAt.getTime() > local.lastSuccessAt
            : row.occurredAt.getTime() >= PROCESS_INSTANCE_STARTED_AT
        )
      ))
      .slice(0, BACKGROUND_OPERATION_FAILURE_MAX_EVENTS);
    const latest = operationRows[0];
    return [name, {
      status: operationRows.length >= BACKGROUND_OPERATION_FAILURE_THRESHOLD ? "warning" : "ok",
      recentFailureCount: operationRows.length,
      threshold: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      windowMs: BACKGROUND_OPERATION_FAILURE_WINDOW_MS,
      ...(latest ? { lastFailureAt: latest.occurredAt.toISOString(), errorCode: latest.errorCode } : {}),
      ...(local?.lastSuccessAt === undefined ? {} : { lastSuccessAt: new Date(local.lastSuccessAt).toISOString() }),
    }];
  })) as Record<BackgroundOperationName, BackgroundOperationDiagnostic>;
}

export async function getBackgroundOperationDiagnostics(
  now = Date.now(),
): Promise<Record<BackgroundOperationName, BackgroundOperationDiagnostic>> {
  const local = localBackgroundOperationDiagnostics(now);
  try {
    const shared = await readSharedDiagnostics(now);
    return Object.fromEntries(operationNames.map((name) => {
      const sharedDiagnostic = shared[name];
      const localDiagnostic = local[name];
      const recentFailureCount = Math.max(
        sharedDiagnostic.recentFailureCount,
        localDiagnostic.recentFailureCount,
      );
      const sharedFailureAt = sharedDiagnostic.lastFailureAt
        ? Date.parse(sharedDiagnostic.lastFailureAt)
        : Number.NEGATIVE_INFINITY;
      const localFailureAt = localDiagnostic.lastFailureAt
        ? Date.parse(localDiagnostic.lastFailureAt)
        : Number.NEGATIVE_INFINITY;
      const latest = localFailureAt > sharedFailureAt
        ? localDiagnostic
        : sharedDiagnostic;
      return [name, {
        ...sharedDiagnostic,
        status: recentFailureCount >= BACKGROUND_OPERATION_FAILURE_THRESHOLD ? "warning" : "ok",
        recentFailureCount,
        ...(latest.lastFailureAt ? { lastFailureAt: latest.lastFailureAt } : {}),
        ...(latest.errorCode ? { errorCode: latest.errorCode } : {}),
        ...(localDiagnostic.lastSuccessAt ? { lastSuccessAt: localDiagnostic.lastSuccessAt } : {}),
      }];
    })) as Record<BackgroundOperationName, BackgroundOperationDiagnostic>;
  } catch {
    return local;
  }
}

export function backgroundOperationsDegraded(
  diagnostics: Record<BackgroundOperationName, BackgroundOperationDiagnostic>,
): boolean {
  return Object.values(diagnostics).some(({ status }) => status === "warning");
}

export async function clearBackgroundOperationDiagnosticsForTests(
  options: { preserveShared?: boolean } = {},
): Promise<void> {
  states.clear();
  autoTrackDeferredRetryTimes = [];
  await sharedBackgroundOperationPersistence.settlePending();
  if (options.preserveShared) return;
  try {
    await db.delete(backgroundOperationEventsTable);
    await db.delete(automaticTrackingDeferredDiagnosticsTable);
  } catch {
    // Unit tests may not provide the shared diagnostics table or database.
  }
}
