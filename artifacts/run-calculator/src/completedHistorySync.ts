import { HISTORY_KEY, type FormValues, type HistoryDay, type RunMeta } from "./types";
import { browserRecordStore } from "./adapters/browserRecordStore";

export const COMPLETED_HISTORY_OUTBOX_KEY = "run-calc-completed-history-outbox";
export const COMPLETED_HISTORY_OUTBOX_EVENT = "run-calculator:completed-history-outbox";
export const COMPLETED_HISTORY_CACHE_KEY = "run-calc-completed-history-cache";
type HistoryScope = "live" | "sandbox";
let activeScope: HistoryScope | null = null;
let retryTimer: number | undefined;
let retryDelayMs = 5_000;
type Completion = {
  operationId: string; runId: string; date: string; completedAt: string;
  snapshot: Record<string, unknown>;
};
const activeFlushes = new Map<HistoryScope, Promise<void>>();

function scopedKey(base: string, scope: HistoryScope | null = activeScope): string | null {
  return scope ? `${base}.${scope}` : null;
}

function readOutbox(scope: HistoryScope | null = activeScope): Completion[] {
  const key = scopedKey(COMPLETED_HISTORY_OUTBOX_KEY, scope);
  if (!key) return [];
  return browserRecordStore.record(key, () => [], {
    decode: (value) => Array.isArray(value) ? value.filter((item): item is Completion =>
      !!item && typeof item.operationId === "string" && typeof item.runId === "string"
      && typeof item.date === "string" && !!item.snapshot) : null,
  }).read();
}
function writeOutbox(value: Completion[], scope: HistoryScope | null = activeScope): void {
  const key = scopedKey(COMPLETED_HISTORY_OUTBOX_KEY, scope);
  if (!key) return;
  browserRecordStore.record<Completion[]>(key, () => [], { decode: () => null }).write(value);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COMPLETED_HISTORY_OUTBOX_EVENT));
}

function readScopedCache(scope: HistoryScope | null = activeScope): HistoryDay[] {
  const key = scopedKey(COMPLETED_HISTORY_CACHE_KEY, scope);
  if (!key) return [];
  return browserRecordStore.record(key, () => [], {
    decode: (value) => Array.isArray(value) ? value as HistoryDay[] : null,
  }).read();
}

function writeScopedCache(days: HistoryDay[], scope: HistoryScope | null = activeScope): void {
  const key = scopedKey(COMPLETED_HISTORY_CACHE_KEY, scope);
  if (!key) return;
  browserRecordStore.record<HistoryDay[]>(key, () => [], { decode: () => null }).write(days);
}

export function setCompletedHistoryScope(scope: HistoryScope | null): void {
  activeScope = scope;
  if (retryTimer !== undefined && typeof window !== "undefined") window.clearTimeout(retryTimer);
  retryTimer = undefined;
  retryDelayMs = 5_000;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COMPLETED_HISTORY_OUTBOX_EVENT));
}

/** Durable, unbounded local queue. Identity is stable across reload/retry. */
export function queueCompletedRun(date: string, run: RunMeta, values: FormValues): void {
  if (!activeScope || !run.id || !run.endedAt) return;
  const scope = activeScope;
  const operationId = `completed:${date}:${run.id}`;
  const outbox = readOutbox(scope);
  if (outbox.some((item) => item.operationId === operationId)) return;
  const snapshot = {
    dayState: { date, runs: [run], currentIndex: 0 },
    runValues: { [run.id]: values },
  };
  writeOutbox([...outbox, {
    operationId, runId: run.id, date, completedAt: new Date(run.endedAt).toISOString(), snapshot,
  }], scope);
  void flushCompletedHistoryOutbox();
}

/**
 * Starting one run finalizes every competing active run and durably queues each
 * immutable completion before the caller publishes the new mutable day state.
 */
export function startRunAndQueueCompetingCompletions(args: {
  date: string;
  runs: RunMeta[];
  currentIndex: number;
  now: number;
  loadValues: (runId: string) => FormValues;
}): { runs: RunMeta[]; autoEnded: RunMeta[] } {
  const selected = args.runs[args.currentIndex];
  if (!selected) return { runs: args.runs, autoEnded: [] };
  const runs = args.runs.map((run, index) => (
    index === args.currentIndex
      ? { ...run, startedAt: args.now, endedAt: undefined }
      : run.startedAt && !run.endedAt
        ? { ...run, endedAt: args.now, pausedAt: undefined }
        : run
  ));
  const autoEnded = runs.filter((run, index) => (
    index !== args.currentIndex
    && run.endedAt === args.now
    && args.runs[index]?.startedAt
    && !args.runs[index]?.endedAt
  ));
  for (const run of autoEnded) {
    queueCompletedRun(args.date, run, args.loadValues(run.id));
  }
  return { runs, autoEnded };
}

async function drainCompletedHistoryOutbox(scope: HistoryScope): Promise<void> {
  for (const item of readOutbox(scope)) {
    let response: Response;
    try {
      response = await fetch("/api/completed-history", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item),
      });
    } catch { return; }
    if (response.status === 409) {
      const body = await response.json().catch(() => null) as {
        canonical?: { date: string; runId: string; snapshot: unknown };
      } | null;
      // The immutable server winner is authoritative. Cache it locally and
      // retire this impossible upload; auth/transient failures remain pending.
      if (!body?.canonical) return;
      const canonical = completedHistoryDays([body.canonical]);
      const merged = mergeCanonicalCompletedHistory(readScopedCache(scope), canonical);
      writeScopedCache(merged, scope);
      if (activeScope === scope) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(merged)); } catch {}
      }
      writeOutbox(readOutbox(scope).filter((candidate) => candidate.operationId !== item.operationId), scope);
      continue;
    }
    if (!response.ok) {
      scheduleRetry(scope);
      return;
    }
    const body = await response.json().catch(() => null);
    if (!body?.acknowledged) return;
    writeOutbox(readOutbox(scope).filter((candidate) => candidate.operationId !== item.operationId), scope);
  }
  retryDelayMs = 5_000;
}

function scheduleRetry(scope: HistoryScope): void {
  if (typeof window === "undefined" || activeScope !== scope
    || retryTimer !== undefined || readOutbox(scope).length === 0) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void flushCompletedHistoryOutbox();
  }, retryDelayMs);
  retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
}

/** Sends one at a time; concurrent startup/online drains share one owner. */
export function flushCompletedHistoryOutbox(): Promise<void> {
  const scope = activeScope;
  if (!scope) return Promise.resolve();
  const active = activeFlushes.get(scope);
  if (active) return active;
  const flush = drainCompletedHistoryOutbox(scope).finally(() => { activeFlushes.delete(scope); });
  activeFlushes.set(scope, flush);
  return flush;
}

export function pendingCompletedHistoryCount(): number { return readOutbox().length; }

/** Immediate scope-safe display state, available even while the API is offline. */
export function loadCompletedHistoryForActiveScope(): HistoryDay[] {
  const pending = completedHistoryDays(readOutbox().map((item) => ({
    date: item.date,
    runId: item.runId,
    snapshot: item.snapshot,
  })));
  return mergeCanonicalCompletedHistory(readScopedCache(), pending);
}

export function completedHistoryDays(records: Array<{ date: string; runId: string; snapshot: unknown }>): HistoryDay[] {
  const days = new Map<string, HistoryDay>();
  for (const record of records) {
    const snapshot = record.snapshot as { dayState?: { runs?: RunMeta[] }; runValues?: Record<string, FormValues> };
    const run = snapshot?.dayState?.runs?.find((candidate) => candidate.id === record.runId);
    if (!run) continue;
    const prior = days.get(record.date) ?? { date: record.date, runs: [], runValues: {} };
    const byId = new Map(prior.runs.map((candidate) => [candidate.id, candidate]));
    byId.set(run.id, run);
    days.set(record.date, { date: record.date, runs: [...byId.values()], runValues: { ...prior.runValues, ...snapshot.runValues } });
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Server immutable records win; local-only days remain so offline work is visible. */
export function mergeCanonicalCompletedHistory(local: HistoryDay[], canonical: HistoryDay[]): HistoryDay[] {
  const byDate = new Map(local.map((day) => [day.date, day]));
  for (const day of canonical) {
    const localDay = byDate.get(day.date);
    const runs = new Map((localDay?.runs ?? []).map((run) => [run.id, run]));
    for (const run of day.runs) runs.set(run.id, run);
    byDate.set(day.date, { date: day.date, runs: [...runs.values()], runValues: { ...(localDay?.runValues ?? {}), ...day.runValues } });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function hydrateCompletedHistory(local: HistoryDay[], save: (days: HistoryDay[]) => void): Promise<void> {
  void local;
  const scope = activeScope;
  if (!scope) return;
  try {
    const response = await fetch("/api/completed-history");
    if (!response.ok) return;
    const body = await response.json() as { history?: Array<{ date: string; runId: string; snapshot: unknown }> };
    const pending = completedHistoryDays(readOutbox(scope).map((item) => ({
      date: item.date, runId: item.runId, snapshot: item.snapshot,
    })));
    const merged = mergeCanonicalCompletedHistory(
      mergeCanonicalCompletedHistory(readScopedCache(scope), pending),
      completedHistoryDays(body.history ?? []),
    );
    writeScopedCache(merged, scope);
    if (activeScope === scope) save(merged);
  } catch {}
}