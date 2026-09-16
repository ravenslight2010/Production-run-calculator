/**
 * Shared bounded retry policy for release preflights.
 *
 * Callers must pass a read-only database operation. This helper only retries
 * transient connection/database failures and otherwise fails closed.
 */
export const RELEASE_PREFLIGHT_DB_ATTEMPTS = 3;
export const RELEASE_PREFLIGHT_RETRY_DELAYS_MS = [250, 500] as const;

const RETRYABLE_RELEASE_PREFLIGHT_DB_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "57P01",
  "57P02",
  "57P03",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorProperty(error: unknown, property: string): unknown {
  return isRecord(error) ? error[property] : undefined;
}

export function isRetryableReleasePreflightDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined; depth += 1) {
    const code = errorProperty(current, "code");
    if (
      typeof code === "string" &&
      (RETRYABLE_RELEASE_PREFLIGHT_DB_CODES.has(code) || /^08[A-Z0-9]{3}$/u.test(code))
    ) {
      return true;
    }
    if (
      errorProperty(current, "message") === "timeout exceeded when trying to connect"
    ) {
      return true;
    }
    current = errorProperty(current, "cause");
  }
  return false;
}

export type ReleasePreflightDatabaseRetryOptions = {
  enabled?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function runReleasePreflightDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: ReleasePreflightDatabaseRetryOptions = {},
): Promise<T> {
  const attempts = options.enabled === false ? 1 : RELEASE_PREFLIGHT_DB_ATTEMPTS;
  const wait = options.sleep ?? sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (
        !isRetryableReleasePreflightDatabaseError(error) ||
        attempt === attempts
      ) {
        throw error;
      }
    }
    await wait(RELEASE_PREFLIGHT_RETRY_DELAYS_MS[attempt - 1] ?? 500);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Release preflight database check failed");
}
