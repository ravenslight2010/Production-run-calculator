export const BACKGROUND_OPERATION_FAILURE_THRESHOLD = 3;
export const BACKGROUND_OPERATION_RETRY_DELAY_MS = 100;
export const BACKGROUND_OPERATION_FAILURE_WINDOW_MS = 5 * 60 * 1000;

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

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
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

export function recordBackgroundOperationFailure(
  name: BackgroundOperationName,
  error: unknown,
  now = Date.now(),
): void {
  const previous = states.get(name);
  states.set(name, {
    failureTimes: [...(previous?.failureTimes ?? []), now].slice(-100),
    lastFailureAt: now,
    lastSuccessAt: previous?.lastSuccessAt,
    lastErrorCode: errorCode(error) ?? "operation_failed",
  });
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
      recordBackgroundOperationFailure(name, firstError, now());
      throw firstError;
    }
    await delay(BACKGROUND_OPERATION_RETRY_DELAY_MS);
    try {
      const result = await operation();
      recordSuccess(name, now());
      return result;
    } catch (retryError) {
      recordBackgroundOperationFailure(name, retryError, now());
      throw retryError;
    }
  }
}

export function getBackgroundOperationDiagnostics(
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

export function backgroundOperationsDegraded(): boolean {
  return Object.values(getBackgroundOperationDiagnostics()).some(({ status }) => status === "warning");
}

export function clearBackgroundOperationDiagnosticsForTests(): void {
  states.clear();
}