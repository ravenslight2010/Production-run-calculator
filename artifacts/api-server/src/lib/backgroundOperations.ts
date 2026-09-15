import { and, desc, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import { backgroundOperationEventsTable, db } from "@workspace/db";

export const BACKGROUND_OPERATION_FAILURE_THRESHOLD = 3;
export const BACKGROUND_OPERATION_RETRY_DELAY_MS = 100;
export const BACKGROUND_OPERATION_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const BACKGROUND_OPERATION_FAILURE_MAX_EVENTS = 100;
const BACKGROUND_OPERATION_SHARED_TIMEOUT_MS = 1_000;
const BACKGROUND_OPERATION_SHARED_DB_TIMEOUT_MS =
  BACKGROUND_OPERATION_SHARED_TIMEOUT_MS - 100;

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

const operationNames: BackgroundOperationName[] = [
  "daily-rollover",
  "server-job-run",
  "server-job-prune",
  "web-push-schedule",
];
const states = new Map<BackgroundOperationName, OperationState>();
const pendingSharedWrites = new Set<Promise<unknown>>();

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
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return /connection (?:terminated|closed|reset)|terminating connection|server closed the connection unexpectedly/.test(message);
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
  const sharedWrite = recordSharedFailure(name, safeCode, now);
  pendingSharedWrites.add(sharedWrite);
  sharedWrite.then(
    () => pendingSharedWrites.delete(sharedWrite),
    () => pendingSharedWrites.delete(sharedWrite),
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
    const recentFailureCount = state.failureTimes.filter(
      (failureAt) => failureAt >= now - BACKGROUND_OPERATION_FAILURE_WINDOW_MS,
    ).length;
    return [name, {
      status: recentFailureCount >= BACKGROUND_OPERATION_FAILURE_THRESHOLD ? "warning" : "ok",
      recentFailureCount,
      threshold: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      windowMs: BACKGROUND_OPERATION_FAILURE_WINDOW_MS,
      ...(state.lastFailureAt === undefined ? {} : { lastFailureAt: new Date(state.lastFailureAt).toISOString() }),
      ...(state.lastSuccessAt === undefined ? {} : { lastSuccessAt: new Date(state.lastSuccessAt).toISOString() }),
      ...(state.lastErrorCode === undefined ? {} : { errorCode: state.lastErrorCode }),
    }];
  })) as Record<BackgroundOperationName, BackgroundOperationDiagnostic>;
}

async function withSharedTimeout<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("background operation diagnostics timed out")),
          BACKGROUND_OPERATION_SHARED_TIMEOUT_MS,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function configureSharedTimeout(tx: {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}): Promise<void> {
  await tx.execute(sql`SELECT set_config(
    'statement_timeout',
    ${`${BACKGROUND_OPERATION_SHARED_DB_TIMEOUT_MS}ms`},
    true
  ), set_config(
    'lock_timeout',
    ${`${BACKGROUND_OPERATION_SHARED_DB_TIMEOUT_MS}ms`},
    true
  )`);
}

async function recordSharedFailure(
  name: BackgroundOperationName,
  code: string,
  now: number,
): Promise<void> {
  try {
    await withSharedTimeout(db.transaction(async (tx) => {
      await configureSharedTimeout(tx);
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
    }));
  } catch {
    // Shared telemetry must never change the outcome of background work.
  }
}

async function readSharedDiagnostics(
  now: number,
): Promise<Record<BackgroundOperationName, BackgroundOperationDiagnostic>> {
  const cutoff = new Date(now - BACKGROUND_OPERATION_FAILURE_WINDOW_MS);
  const rows = await withSharedTimeout(db.transaction(async (tx) => {
    await configureSharedTimeout(tx);
    await tx.delete(backgroundOperationEventsTable).where(
      lt(backgroundOperationEventsTable.occurredAt, cutoff),
    );
    return tx
      .select({
        operation: backgroundOperationEventsTable.operation,
        occurredAt: backgroundOperationEventsTable.occurredAt,
        errorCode: backgroundOperationEventsTable.errorCode,
      })
      .from(backgroundOperationEventsTable)
      .where(gte(backgroundOperationEventsTable.occurredAt, cutoff))
      .orderBy(desc(backgroundOperationEventsTable.occurredAt), desc(backgroundOperationEventsTable.id))
      .limit(BACKGROUND_OPERATION_FAILURE_MAX_EVENTS * operationNames.length);
  }));
  return Object.fromEntries(operationNames.map((name) => {
    const operationRows = rows.filter((row) => row.operation === name)
      .slice(0, BACKGROUND_OPERATION_FAILURE_MAX_EVENTS);
    const latest = operationRows[0];
    const local = states.get(name);
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
  if (pendingSharedWrites.size > 0) {
    await Promise.allSettled([...pendingSharedWrites]);
  }
  if (options.preserveShared) return;
  try {
    await db.delete(backgroundOperationEventsTable);
  } catch {
    // Unit tests may not provide the shared diagnostics table or database.
  }
}