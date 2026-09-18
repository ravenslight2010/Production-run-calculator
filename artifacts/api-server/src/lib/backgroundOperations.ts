import { and, desc, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import { backgroundOperationEventsTable, db } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { createSharedDiagnosticPersistence } from "./sharedDiagnosticPersistence";

export const BACKGROUND_OPERATION_FAILURE_THRESHOLD = 3;
export const BACKGROUND_OPERATION_RETRY_DELAY_MS = 100;
export const BACKGROUND_OPERATION_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const BACKGROUND_OPERATION_FAILURE_MAX_EVENTS = 100;
export const BACKGROUND_OPERATION_BACKOFF_BASE_MS = 1_000;
export const BACKGROUND_OPERATION_BACKOFF_MAX_MS = 30_000;
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

export type BackgroundOperationName =
  | "daily-rollover"
  | "server-job-run"
  | "server-job-prune"
  | "web-push-schedule";

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
  recordSuccess(now?: number): void;
  recordFailure(now?: number): void;
};

export function createBackgroundOperationBackoff(options: {
  baseDelayMs?: number;
  maxDelayMs?: number;
} = {}): BackgroundOperationBackoff {
  const baseDelayMs = Math.max(1, Math.floor(options.baseDelayMs ?? BACKGROUND_OPERATION_BACKOFF_BASE_MS));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options.maxDelayMs ?? BACKGROUND_OPERATION_BACKOFF_MAX_MS));
  let consecutiveFailures = 0;
  let retryAt = 0;

  return {
    isReady(now = Date.now()) {
      return now >= retryAt;
    },
    recordSuccess() {
      consecutiveFailures = 0;
      retryAt = 0;
    },
    recordFailure(now = Date.now()) {
      const exponent = Math.min(consecutiveFailures, 30);
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
      consecutiveFailures = Math.min(consecutiveFailures + 1, 31);
      retryAt = now + delayMs;
    },
  };
}

const operationNames: BackgroundOperationName[] = [
  "daily-rollover",
  "server-job-run",
  "server-job-prune",
  "web-push-schedule",
];
const states = new Map<BackgroundOperationName, OperationState>();

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_.-]{1,64}$/i.test(code)
    ? code
    : undefined;
}

export function isTransientDatabaseConnectionError(error: unknown): boolean {
  const code = errorCode(error);
  if (code && new Set([
    "57P01", "57P02", "57P03",
    "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
    "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT",
  ]).has(code)) return true;
  const rawMessage = String(error instanceof Error ? error.message : error);
  const message = rawMessage.toLowerCase();
  return rawMessage === "timeout exceeded when trying to connect" ||
    /connection (?:terminated|closed|reset)|terminating connection|server closed the connection unexpectedly/.test(message);
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
  options: { delay?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<T> {
  // Keep the short retry timer referenced: once a pass has started, shutdown
  // should not silently abandon its one recovery attempt.
  const delay = options.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  try {
    const result = await operation();
    recordSuccess(name, now());
    return result;
  } catch (firstError) {
    if (!isTransientDatabaseConnectionError(firstError)) {
      await recordBackgroundOperationFailure(name, firstError, now());
      throw firstError;
    }
    await delay(BACKGROUND_OPERATION_RETRY_DELAY_MS);
    try {
      const result = await operation();
      recordSuccess(name, now());
      return result;
    } catch (retryError) {
      await recordBackgroundOperationFailure(name, retryError, now());
      throw retryError;
    }
  }
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
  await sharedBackgroundOperationPersistence.settlePending();
  if (options.preserveShared) return;
  try {
    await db.delete(backgroundOperationEventsTable);
  } catch {
    // Unit tests may not provide the shared diagnostics table or database.
  }
}