const STARTUP_SAFETY_TIMEOUT_MS = 3_000;
const LOCAL_DAY_STATE_KEY = "run-calc-day";

type SnapshotRecord = Record<string, unknown>;
type KeyValueReader = Pick<Storage, "getItem">;
type FetchResponse = Pick<Response, "ok" | "headers" | "json">;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<FetchResponse>;

function isRecord(value: unknown): value is SnapshotRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function activeRunState(dayState: unknown, today: string): boolean | null {
  if (!isRecord(dayState) || !isDateString(dayState.date)) return null;
  // Home ignores stale prior-day local state and replaces it with a fresh day.
  if (dayState.date !== today) return false;
  if (!Array.isArray(dayState.runs)) return null;

  for (const value of dayState.runs) {
    if (!isRecord(value)) return null;
    const { startedAt, endedAt } = value;
    if (
      (startedAt !== undefined && startedAt !== null &&
        (typeof startedAt !== "number" || !Number.isFinite(startedAt))) ||
      (endedAt !== undefined && endedAt !== null &&
        (typeof endedAt !== "number" || !Number.isFinite(endedAt)))
    ) return null;
    if (typeof startedAt === "number" && startedAt !== 0 && !endedAt) return true;
  }
  return false;
}

/**
 * Pre-Home reload safety is known only when a complete current-day server
 * snapshot and the browser's persisted day state both prove there is no active
 * run. Forms, dialogs, and Home-owned operations cannot exist in this document
 * until the Home chunk mounts; unknown or unavailable state remains unsafe.
 */
export function isPreHomeReloadSafe(
  serverSnapshot: unknown,
  localDayState: string | null,
  today: string,
): boolean {
  if (!isDateString(today) || !isRecord(serverSnapshot) ||
      serverSnapshot.completeness !== "complete") return false;
  const serverDayState = serverSnapshot.dayState;
  if (!isRecord(serverDayState) || serverDayState.date !== today) return false;
  if (activeRunState(serverDayState, today) !== false) return false;

  if (localDayState === null) return true;
  let parsedLocal: unknown;
  try {
    parsedLocal = JSON.parse(localDayState);
  } catch {
    return false;
  }
  return activeRunState(parsedLocal, today) === false;
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Fetch the authenticated current-day snapshot before importing Home. Any
 * timeout, storage issue, incomplete response, or malformed payload fails
 * closed so the app can still open normally without automatic recovery.
 */
export async function checkPreHomeReloadSafety(
  options: {
    fetcher?: Fetcher;
    storage?: KeyValueReader;
    today?: string;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const fetcher = options.fetcher ?? fetch;
  const today = options.today ?? localDate();
  const timeoutMs = options.timeoutMs ?? STARTUP_SAFETY_TIMEOUT_MS;
  let localDayState: string | null;
  try {
    localDayState = (options.storage ?? localStorage).getItem(LOCAL_DAY_STATE_KEY);
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(
      `/api/sync/today?today=${encodeURIComponent(today)}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      },
    );
    if (!response.ok || response.headers.get("X-Sync-Response") !== "complete") {
      return false;
    }
    const serverSnapshot: unknown = await response.json();
    return isPreHomeReloadSafe(serverSnapshot, localDayState, today);
  } catch {
    // Offline and expired sessions can still open Home, but cannot authorize an
    // automatic reload because their production state has not been verified.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
