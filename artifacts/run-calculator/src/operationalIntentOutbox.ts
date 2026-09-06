/** Durable browser outbox for commands that must retain their occurrence time. */
import { todayStr } from "./utils";
import { getStoredResetEpoch } from "./adapters/browserResetPersistence";

export const OPERATIONAL_INTENT_OUTBOX_EVENT = "run-calculator:operational-intent-outbox";
const KEY = "run-calculator:operational-intent-outbox:v1";
const PENDING_PREFIX = `${KEY}:pending:`;
const TERMINAL_KEY = `${KEY}:terminal`;
let adoptCanonical: ((data: unknown, intent: OperationalIntent, outcome: OperationalIntentState) => void) | undefined;
/** Registered by Home; avoids coupling this storage module to React/sync. */
export function setOperationalIntentCanonicalAdopter(callback: ((data: unknown, intent: OperationalIntent, outcome: OperationalIntentState) => void) | undefined): void {
  adoptCanonical = callback;
}
export type OperationalIntentState = "pending" | "accepted" | "rebased" | "review-required";
export type PreEndLifecycle = {
  startedAt?: number;
  pausedAt?: number;
  pausedStoppageId?: string;
  endedAt?: number;
  stoppages?: unknown[];
  metaUpdatedAt?: number;
};
export type OperationalIntent = {
  version: 1; id: string; date: string; runId: string; observedGeneration: string;
  resetEpoch: number; effectiveAt: number; action: "pause" | "resume" | "lifecycle" | "correction";
  lifecycle?: "start" | "end"; values?: Record<string, number>;
  inventoryLines?: Array<{ itemKey: string; qty: number }>;
  /** Browser-only canonical lifecycle retained for the pending snapshot fence. */
  preEndLifecycle?: PreEndLifecycle;
  state: OperationalIntentState;
};
function validPreEndLifecycle(value: unknown): value is PreEndLifecycle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  const allowed = new Set([
    "startedAt", "pausedAt", "pausedStoppageId", "endedAt", "stoppages", "metaUpdatedAt",
  ]);
  if (Object.keys(x).some((key) => !allowed.has(key))) return false;
  for (const key of ["startedAt", "pausedAt", "endedAt", "metaUpdatedAt"]) {
    if (x[key] !== undefined && (typeof x[key] !== "number" || !Number.isFinite(x[key]))) return false;
  }
  if (x.pausedStoppageId !== undefined
    && (typeof x.pausedStoppageId !== "string" || x.pausedStoppageId.length > 160)) return false;
  if (x.stoppages !== undefined && (!Array.isArray(x.stoppages) || x.stoppages.length > 200)) return false;
  try {
    if (JSON.stringify(value).length > 64_000) return false;
  } catch {
    return false;
  }
  return true;
}
export function capturePreEndLifecycle(run: PreEndLifecycle): PreEndLifecycle {
  const snapshot: PreEndLifecycle = {
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.pausedAt === undefined ? {} : { pausedAt: run.pausedAt }),
    ...(run.pausedStoppageId === undefined ? {} : { pausedStoppageId: run.pausedStoppageId }),
    ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    ...(run.stoppages === undefined
      ? {}
      : { stoppages: JSON.parse(JSON.stringify(run.stoppages)) as unknown[] }),
    ...(run.metaUpdatedAt === undefined ? {} : { metaUpdatedAt: run.metaUpdatedAt }),
  };
  if (!validPreEndLifecycle(snapshot)) throw new Error("Run completion lifecycle snapshot is invalid");
  return snapshot;
}
function valid(item: unknown): item is OperationalIntent {
  const x = item as Partial<OperationalIntent>;
  return !!x && x.version === 1 && typeof x.id === "string" && typeof x.date === "string"
    && typeof x.runId === "string" && typeof x.observedGeneration === "string"
    && Number.isFinite(x.resetEpoch) && Number.isFinite(x.effectiveAt)
    && ["pause", "resume", "lifecycle", "correction"].includes(String(x.action))
    && (x.lifecycle !== "end" || (Array.isArray(x.inventoryLines) && x.inventoryLines.length <= 200))
    // Keep pre-fix pending Ends readable; newly queued Ends always require the
    // complete snapshot below, but durable production evidence is never dropped.
    && (x.lifecycle !== "end" || x.preEndLifecycle === undefined || validPreEndLifecycle(x.preEndLifecycle))
    && ["pending", "accepted", "rebased", "review-required"].includes(String(x.state));
}
export const readOperationalIntentOutbox = (): OperationalIntent[] => {
  if (typeof window === "undefined") return [];
  try {
    // One-time migration from the original RMW blob. Pending records become
    // per-ID keys, so independent tabs cannot clobber each other's append.
    const rawLegacy = localStorage.getItem(KEY);
    const legacy = JSON.parse(rawLegacy ?? "[]");
    if (rawLegacy !== null && Array.isArray(legacy)) {
      const oldTerminal = legacy.filter(valid).filter((item) => item.state !== "pending").slice(-100);
      for (const item of legacy.filter(valid).filter((item) => item.state === "pending")) {
        localStorage.setItem(`${PENDING_PREFIX}${item.id}`, JSON.stringify(item));
      }
      localStorage.setItem(TERMINAL_KEY, JSON.stringify(oldTerminal));
      localStorage.removeItem(KEY);
    }
    const pending: OperationalIntent[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PENDING_PREFIX)) continue;
      const item = JSON.parse(localStorage.getItem(key) ?? "null");
      if (valid(item)) pending.push(item);
    }
    const terminal = JSON.parse(localStorage.getItem(TERMINAL_KEY) ?? "[]");
    return [...pending, ...(Array.isArray(terminal) ? terminal.filter(valid) : [])];
  } catch { return []; }
};
function canonicalInventoryLines(
  lines: Array<{ itemKey: string; qty: number }> | undefined,
): Array<{ itemKey: string; qty: number }> {
  const totals = new Map<string, number>();
  for (const line of lines ?? []) {
    if (!line || typeof line.itemKey !== "string" || line.itemKey.length < 1 || line.itemKey.length > 300
      || !Number.isFinite(line.qty) || line.qty <= 0) {
      throw new Error("Run completion inventory data is invalid");
    }
    totals.set(line.itemKey, (totals.get(line.itemKey) ?? 0) + line.qty);
  }
  if (totals.size > 200) throw new Error("Run completion has too many inventory lines");
  const canonical = [...totals]
    .map(([itemKey, qty]) => ({ itemKey, qty }))
    .sort((a, b) => a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0);
  if (canonical.some((line) => !Number.isFinite(line.qty) || line.qty > 1_000_000)) {
    throw new Error("Run completion inventory quantity is out of range");
  }
  return canonical;
}
const write = (items: OperationalIntent[]) => {
  // Pending commands are production evidence: never evict them. Only the
  // terminal display trail is bounded.
  const pending = items.filter((item) => item.state === "pending");
  const terminal = items.filter((item) => item.state !== "pending").slice(-100);
  try {
    const existing = readOperationalIntentOutbox().filter((item) => item.state === "pending");
    for (const item of existing) if (!pending.some((next) => next.id === item.id)) localStorage.removeItem(`${PENDING_PREFIX}${item.id}`);
    for (const item of pending) localStorage.setItem(`${PENDING_PREFIX}${item.id}`, JSON.stringify(item));
    localStorage.setItem(TERMINAL_KEY, JSON.stringify(terminal));
  }
  catch { throw new Error("Offline action could not be saved on this device"); }
  window.dispatchEvent(new Event(OPERATIONAL_INTENT_OUTBOX_EVENT));
};
export function operationalIntentSummary(): Record<OperationalIntentState, number> {
  const result = { pending: 0, accepted: 0, rebased: 0, "review-required": 0 };
  if (typeof window === "undefined") return result;
  for (const x of readOperationalIntentOutbox()) result[x.state]++;
  return result;
}
export function queueOperationalIntent(
  input: Omit<OperationalIntent, "version" | "id" | "date" | "resetEpoch" | "state"> & { date?: string },
): OperationalIntent {
  const inventoryLines = input.action === "lifecycle" && input.lifecycle === "end"
    ? canonicalInventoryLines(input.inventoryLines)
    : input.inventoryLines;
  if (input.action === "lifecycle" && input.lifecycle === "end"
    && !validPreEndLifecycle(input.preEndLifecycle)) {
    throw new Error("Run completion lifecycle snapshot is invalid");
  }
  const intent: OperationalIntent = {
    ...input, inventoryLines, version: 1, id: `offline:${crypto.randomUUID()}`, date: input.date ?? todayStr(),
    resetEpoch: getStoredResetEpoch(), state: "pending",
  };
  // Do not read/modify/write another tab's pending collection.
  try { localStorage.setItem(`${PENDING_PREFIX}${intent.id}`, JSON.stringify(intent)); }
  catch { throw new Error("Offline action could not be saved on this device"); }
  window.dispatchEvent(new Event(OPERATIONAL_INTENT_OUTBOX_EVENT));
  return intent;
}

/**
 * Ordinary snapshot sync must never make a locally projected End canonical
 * before its atomic finalization intent. Restore the observed lifecycle stamp
 * and omit endedAt while that intent remains pending.
 */
export function fencePendingEndSnapshots<T extends {
  id: string;
  startedAt?: number;
  pausedAt?: number;
  pausedStoppageId?: string;
  endedAt?: number;
  stoppages?: unknown[];
  metaUpdatedAt?: number;
}>(runs: T[], intents = readOperationalIntentOutbox()): T[] {
  const pending = new Map(
    intents
      .filter((intent) => intent.state === "pending" && intent.action === "lifecycle" && intent.lifecycle === "end")
      .map((intent) => [intent.runId, intent]),
  );
  return runs.map((run) => {
    const intent = pending.get(run.id);
    if (!intent) return run;
    const {
      startedAt: _startedAt,
      pausedAt: _pausedAt,
      pausedStoppageId: _pausedStoppageId,
      endedAt: _endedAt,
      stoppages: _stoppages,
      metaUpdatedAt: _metaUpdatedAt,
      ...nonLifecycle
    } = run;
    if (intent.preEndLifecycle) {
      return { ...nonLifecycle, ...intent.preEndLifecycle } as T;
    }
    // Compatibility for an End queued by the immediately preceding client
    // version, which retained only its generation. New records never use this.
    const separator = intent.observedGeneration.lastIndexOf(":");
    const observedStamp = Number(intent.observedGeneration.slice(separator + 1));
    return {
      ...run,
      endedAt: undefined,
      ...(Number.isFinite(observedStamp) ? { metaUpdatedAt: observedStamp } : {}),
    };
  });
}
/** Safe to call repeatedly; stable intent IDs make timeout and restart retries idempotent. */
export async function flushOperationalIntentOutbox(senderId = ""): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;
  for (const item of readOperationalIntentOutbox().filter((x) => x.state === "pending")
    .sort((a, b) => a.effectiveAt - b.effectiveAt || a.id.localeCompare(b.id))) {
    try {
      const res = await fetch(`/api/sync/operational-intents?today=${encodeURIComponent(item.date)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId,
          // preEndLifecycle is local fencing evidence only; the server receives
          // the immutable inventory data and observed generation.
          intent: (({ state: _state, preEndLifecycle: _preEndLifecycle, ...wire }) => wire)(item),
        }),
      });
      const body = await res.json();
      if (!res.ok || !["accepted", "rebased", "review-required"].includes(body.outcome)) continue;
      // Adoption precedes terminalization: a rebased/review response is still
      // authoritative and must not leave this tab projecting stale counters.
      if (body.data) adoptCanonical?.(body.data, item, body.outcome as OperationalIntentState);
      const terminal = readOperationalIntentOutbox().filter((x) => x.state !== "pending");
      const resolved = { ...item, state: body.outcome as OperationalIntentState };
      // This item only: other tabs' pending keys are never touched.
      localStorage.removeItem(`${PENDING_PREFIX}${item.id}`);
      localStorage.setItem(TERMINAL_KEY, JSON.stringify([...terminal, resolved].slice(-100)));
      window.dispatchEvent(new Event(OPERATIONAL_INTENT_OUTBOX_EVENT));
    } catch { /* retain for the next online/focus attempt */ }
  }
}