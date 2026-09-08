/** Durable, per-command browser work queue for operational commands. */
import { todayStr } from "./utils";
import { getStoredResetEpoch } from "./adapters/browserResetPersistence";

export const OPERATIONAL_INTENT_OUTBOX_EVENT = "run-calculator:operational-intent-outbox";
const KEY = "run-calculator:operational-intent-outbox:v1";
const PENDING_PREFIX = `${KEY}:pending:`;
const TERMINAL_PREFIX = `${KEY}:terminal:`;
const LEGACY_TERMINAL_KEY = `${KEY}:terminal`;
const LOCK_KEY = `${KEY}:flush-lock`;
const MAX_TERMINAL = 100;
const BACKOFF_MAX_MS = 5 * 60_000;
const RETRY_AFTER_MAX_MS = 24 * 60 * 60_000;
const DELIVERY_TIMEOUT_MS = 25_000;
const LOCK_LEASE_MS = 30_000;
const LOCK_RENEW_MS = 10_000;
let activeFlush: Promise<void> | undefined;
let retryTimer: number | undefined;
let activeOwner: string | undefined;
let adoptCanonical: ((data: unknown, intent: OperationalIntent, outcome: OperationalIntentState) => void | Promise<void>) | undefined;
type OperationalIntentStorageFailure = "corrupt" | "unavailable" | "write";
const storageHealth = {
  corruptRecords: 0,
  unavailableReads: 0,
  writeFailures: 0,
};

export type OperationalIntentState = "pending" | "sending" | "accepted" | "superseded" | "rebased" | "conflicted" | "review-required" | "blocked" | "permanently-rejected";
export type OperationalIntentFailure = "network" | "rate-limited" | "server" | "authentication" | "permission" | "validation" | "quota";
export type OperationalIntentCanonicalReceipt = {
  cursor?: number;
  canonicalRevision?: number;
  serverTime?: number;
  snapshotId?: string;
  adoptedAt: number;
};
export type PreEndLifecycle = {
  startedAt?: number; pausedAt?: number; pausedStoppageId?: string; endedAt?: number;
  stoppages?: unknown[]; metaUpdatedAt?: number;
};
export type OperationalIntent = {
  version: 1; id: string; date: string; runId: string; observedGeneration: string;
  resetEpoch: number; effectiveAt: number; action: "pause" | "resume" | "lifecycle" | "correction";
  commandCategory: "lifecycle" | "correction";
  deviceId: string;
  baseRevision: number;
  occurredAt: number;
  serverTimeOffsetMs?: number;
  lifecycle?: "start" | "end"; values?: Record<string, number>;
  inventoryLines?: Array<{ itemKey: string; qty: number }>;
  preLifecycle?: PreEndLifecycle;
  preEndLifecycle?: PreEndLifecycle;
  deferredOffline?: boolean;
  state: OperationalIntentState;
  owner?: string;
  deliveryToken?: string;
  attempts?: number; nextRetryAt?: number; lastAttemptAt?: number;
  failure?: OperationalIntentFailure; guidance?: string; resolvedAt?: number;
  canonicalCursor?: number; canonicalRevision?: number; serverTime?: number; snapshotId?: string;
  canonicalAdoptedAt?: number;
};

export type OperationalIntentStorageHealth = {
  corruptRecords: number;
  unavailableReads: number;
  writeFailures: number;
};

export type OperationalIntentRecoveryTelemetry = {
  unresolved: number;
  pending: number;
  sending: number;
  repeatedlyFailing: number;
  storageFailures: number;
  corruptRecords: number;
};

function noteStorageFailure(kind: OperationalIntentStorageFailure): void {
  if (kind === "corrupt") storageHealth.corruptRecords = Math.min(1000, storageHealth.corruptRecords + 1);
  if (kind === "unavailable") storageHealth.unavailableReads = Math.min(1000, storageHealth.unavailableReads + 1);
  if (kind === "write") storageHealth.writeFailures = Math.min(1000, storageHealth.writeFailures + 1);
}

export function operationalIntentStorageHealth(): OperationalIntentStorageHealth {
  return { ...storageHealth };
}

export function setOperationalIntentIdentity(identity: { scope: "live" | "sandbox"; userId: string } | null): void {
  activeOwner = identity ? `${identity.scope}:${identity.userId}` : undefined;
  scheduleNextFlush();
  if (typeof window !== "undefined") notify();
}

/** Registered by Home; avoids coupling this storage module to React/sync. */
export function setOperationalIntentCanonicalAdopter(callback: ((data: unknown, intent: OperationalIntent, outcome: OperationalIntentState) => void | Promise<void>) | undefined): void {
  adoptCanonical = callback;
}
const DEVICE_KEY = "run-calculator:operational-device-id";
export function getOperationalDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length <= 160) return existing;
    const created = `device:${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    // The command itself remains durable when localStorage is available. This
    // fallback is only for an unavailable browser storage implementation.
    return `device:${crypto.randomUUID()}`;
  }
}
function validPreEndLifecycle(value: unknown): value is PreEndLifecycle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  const allowed = new Set(["startedAt", "pausedAt", "pausedStoppageId", "endedAt", "stoppages", "metaUpdatedAt"]);
  if (Object.keys(x).some((key) => !allowed.has(key))) return false;
  for (const key of ["startedAt", "pausedAt", "endedAt", "metaUpdatedAt"]) if (x[key] !== undefined && (typeof x[key] !== "number" || !Number.isFinite(x[key]))) return false;
  if (x.pausedStoppageId !== undefined && (typeof x.pausedStoppageId !== "string" || x.pausedStoppageId.length > 160)) return false;
  if (x.stoppages !== undefined && (!Array.isArray(x.stoppages) || x.stoppages.length > 200)) return false;
  try { return JSON.stringify(value).length <= 64_000; } catch { return false; }
}
export function capturePreEndLifecycle(run: PreEndLifecycle): PreEndLifecycle {
  const snapshot: PreEndLifecycle = {
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.pausedAt === undefined ? {} : { pausedAt: run.pausedAt }),
    ...(run.pausedStoppageId === undefined ? {} : { pausedStoppageId: run.pausedStoppageId }),
    ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    ...(run.stoppages === undefined ? {} : { stoppages: JSON.parse(JSON.stringify(run.stoppages)) as unknown[] }),
    ...(run.metaUpdatedAt === undefined ? {} : { metaUpdatedAt: run.metaUpdatedAt }),
  };
  if (!validPreEndLifecycle(snapshot)) throw new Error("Run completion lifecycle snapshot is invalid");
  return snapshot;
}
function valid(item: unknown): item is OperationalIntent {
  const x = item as Partial<OperationalIntent>;
  return !!x && x.version === 1 && typeof x.id === "string" && typeof x.date === "string" && typeof x.runId === "string"
    && typeof x.observedGeneration === "string" && Number.isFinite(x.resetEpoch) && Number.isFinite(x.effectiveAt)
    && ["pause", "resume", "lifecycle", "correction"].includes(String(x.action))
    && (x.lifecycle !== "end" || (Array.isArray(x.inventoryLines) && x.inventoryLines.length <= 200))
    && (x.preLifecycle === undefined || validPreEndLifecycle(x.preLifecycle))
    && (x.lifecycle !== "end" || x.preEndLifecycle === undefined || validPreEndLifecycle(x.preEndLifecycle))
    && ["pending", "sending", "accepted", "superseded", "rebased", "conflicted", "review-required", "blocked", "permanently-rejected"].includes(String(x.state));
}
function notify(): void { window.dispatchEvent(new Event(OPERATIONAL_INTENT_OUTBOX_EVENT)); }
function readKeys(prefix: string): OperationalIntent[] {
  const records: OperationalIntent[] = [];
  let length = 0;
  try {
    length = localStorage.length;
  } catch {
    noteStorageFailure("unavailable");
    return records;
  }
  for (let i = 0; i < length; i++) {
    let key: string | null = null;
    try {
      key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!valid(value)) {
        noteStorageFailure("corrupt");
        continue;
      }
      if (!activeOwner) continue;
      // Pre-identity records are visible for explicit recovery, but are never
      // silently submitted under whichever account happens to sign in first.
      if (!value.owner) {
        records.push({
          ...value,
          state: "blocked",
          failure: "authentication",
          guidance: "Saved by an earlier app version. Choose Retry to recover it under this signed-in account.",
        });
        continue;
      }
      if (value.owner === activeOwner) records.push(value);
    } catch {
      noteStorageFailure("corrupt");
    }
  }
  return records;
}
function migrate(): void {
  const raw = localStorage.getItem(KEY);
  if (raw !== null) {
    try {
      const records = JSON.parse(raw);
      if (Array.isArray(records)) for (const item of records.filter(valid)) {
        const prefix = ["accepted", "superseded", "rebased", "conflicted", "review-required", "blocked", "permanently-rejected"].includes(item.state) ? TERMINAL_PREFIX : PENDING_PREFIX;
        if (!localStorage.getItem(`${prefix}${item.id}`)) localStorage.setItem(`${prefix}${item.id}`, JSON.stringify(item));
      }
      localStorage.removeItem(KEY);
    } catch {
      noteStorageFailure("corrupt");
      /* leave malformed legacy data for a later repair path */
    }
  }
  // A previous release kept terminals in one RMW blob. Split it without ever replacing another tab's records.
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_TERMINAL_KEY) ?? "[]");
    if (Array.isArray(old)) for (const item of old.filter(valid)) localStorage.setItem(`${TERMINAL_PREFIX}${item.id}`, JSON.stringify(item));
    localStorage.removeItem(LEGACY_TERMINAL_KEY);
  } catch {
    noteStorageFailure("corrupt");
    /* malformed display history is non-production evidence */
  }
}
export const readOperationalIntentOutbox = (): OperationalIntent[] => {
  if (typeof window === "undefined") return [];
  try {
    migrate();
    return [...readKeys(PENDING_PREFIX), ...readKeys(TERMINAL_PREFIX)]
      .sort((a, b) => a.effectiveAt - b.effectiveAt || a.id.localeCompare(b.id));
  } catch {
    noteStorageFailure("unavailable");
    return [];
  }
};
function persistPending(item: OperationalIntent): boolean {
  try {
    localStorage.setItem(`${PENDING_PREFIX}${item.id}`, JSON.stringify(item));
    return true;
  } catch {
    noteStorageFailure("write");
    return false;
  }
}
function pruneTerminals(): void {
  // Review-required records are unresolved production evidence and are never
  // part of the bounded display-history eviction.
  const terminals = readKeys(TERMINAL_PREFIX)
    .filter((item) => item.state !== "review-required" && item.state !== "conflicted")
    .sort((a, b) => (a.resolvedAt ?? a.effectiveAt) - (b.resolvedAt ?? b.effectiveAt));
  for (const item of terminals.slice(0, Math.max(0, terminals.length - MAX_TERMINAL))) localStorage.removeItem(`${TERMINAL_PREFIX}${item.id}`);
}
function currentDeliveryMatches(item: OperationalIntent): boolean {
  if (!activeOwner || item.owner !== activeOwner || !item.deliveryToken) return false;
  try {
    const current = JSON.parse(localStorage.getItem(`${PENDING_PREFIX}${item.id}`) ?? "null");
    return valid(current)
      && current.owner === item.owner
      && current.state === "sending"
      && current.deliveryToken === item.deliveryToken;
  } catch {
    return false;
  }
}
function terminalize(item: OperationalIntent, state: Extract<OperationalIntentState, "accepted" | "superseded" | "rebased" | "conflicted" | "review-required" | "blocked" | "permanently-rejected">, fields: Partial<OperationalIntent> = {}): boolean {
  if (!currentDeliveryMatches(item)) return false;
  const record = { ...item, ...fields, state, resolvedAt: Date.now() };
  try {
    // Adopt the terminal receipt before removing the pending record. If the
    // browser is full or dies here, the sending record remains replayable.
    localStorage.setItem(`${TERMINAL_PREFIX}${item.id}`, JSON.stringify(record));
  } catch {
    noteStorageFailure("write");
    notify();
    return false;
  }
  try {
    localStorage.removeItem(`${PENDING_PREFIX}${item.id}`);
  } catch {
    noteStorageFailure("write");
    notify();
    return false;
  }
  pruneTerminals();
  notify();
  return true;
}
function canonicalInventoryLines(lines: Array<{ itemKey: string; qty: number }> | undefined): Array<{ itemKey: string; qty: number }> {
  const totals = new Map<string, number>();
  for (const line of lines ?? []) {
    if (!line || typeof line.itemKey !== "string" || line.itemKey.length < 1 || line.itemKey.length > 300 || !Number.isFinite(line.qty) || line.qty <= 0) throw new Error("Run completion inventory data is invalid");
    totals.set(line.itemKey, (totals.get(line.itemKey) ?? 0) + line.qty);
  }
  if (totals.size > 200) throw new Error("Run completion has too many inventory lines");
  const output = [...totals].map(([itemKey, qty]) => ({ itemKey, qty })).sort((a, b) => a.itemKey.localeCompare(b.itemKey));
  if (output.some((line) => line.qty > 1_000_000)) throw new Error("Run completion inventory quantity is out of range");
  return output;
}
export function operationalIntentSummary(): Record<OperationalIntentState, number> {
  const result: Record<OperationalIntentState, number> = { pending: 0, sending: 0, accepted: 0, superseded: 0, rebased: 0, conflicted: 0, "review-required": 0, blocked: 0, "permanently-rejected": 0 };
  for (const item of readOperationalIntentOutbox()) result[item.state]++;
  return result;
}

export function operationalIntentRecoveryTelemetry(): OperationalIntentRecoveryTelemetry {
  const records = readOperationalIntentOutbox();
  const unresolved = records.filter((item) => !["accepted", "superseded", "rebased"].includes(item.state));
  return {
    unresolved: Math.min(1000, unresolved.length),
    pending: Math.min(1000, records.filter((item) => item.state === "pending").length),
    sending: Math.min(1000, records.filter((item) => item.state === "sending").length),
    repeatedlyFailing: Math.min(1000, records.filter((item) => (item.attempts ?? 0) >= 3).length),
    storageFailures: Math.min(1000, storageHealth.unavailableReads + storageHealth.writeFailures),
    corruptRecords: storageHealth.corruptRecords,
  };
}
export function queueOperationalIntent(input: Omit<OperationalIntent, "version" | "id" | "date" | "resetEpoch" | "state" | "commandCategory" | "deviceId" | "baseRevision" | "occurredAt"> & {
  date?: string;
  commandCategory?: OperationalIntent["commandCategory"];
  deviceId?: string;
  baseRevision?: number;
  occurredAt?: number;
}): OperationalIntent {
  const inventoryLines = input.action === "lifecycle" && input.lifecycle === "end" ? canonicalInventoryLines(input.inventoryLines) : input.inventoryLines;
  if (input.action === "lifecycle" && input.lifecycle === "end" && !validPreEndLifecycle(input.preEndLifecycle)) throw new Error("Run completion lifecycle snapshot is invalid");
  if (!activeOwner) throw new Error("Offline action could not be saved before sign-in completed");
  const requestedBaseRevision = input.baseRevision;
  const baseRevision = typeof requestedBaseRevision === "number"
    && Number.isSafeInteger(requestedBaseRevision)
    && requestedBaseRevision >= 0
    ? requestedBaseRevision
    : 0;
  const requestedOccurredAt = input.occurredAt;
  const occurredAt = typeof requestedOccurredAt === "number" && Number.isFinite(requestedOccurredAt)
    ? requestedOccurredAt
    : input.effectiveAt;
  const intent: OperationalIntent = {
    ...input,
    inventoryLines,
    commandCategory: input.action === "correction" ? "correction" : "lifecycle",
    deviceId: input.deviceId ?? getOperationalDeviceId(),
    baseRevision,
    occurredAt,
    version: 1,
    id: `offline:${crypto.randomUUID()}`,
    date: input.date ?? todayStr(),
    resetEpoch: getStoredResetEpoch(),
    state: "pending",
    owner: activeOwner,
    attempts: 0,
    deferredOffline: typeof navigator !== "undefined" && navigator.onLine === false,
  };
  if (!persistPending(intent)) throw new Error("Offline action could not be saved on this device (storage may be full)");
  notify(); return intent;
}
export function retryOperationalIntent(id: string): boolean {
  const terminalKey = `${TERMINAL_PREFIX}${id}`;
  try {
    const item = JSON.parse(localStorage.getItem(`${PENDING_PREFIX}${id}`) ?? localStorage.getItem(terminalKey) ?? "null");
    if (!valid(item) || item.state === "sending" || ["accepted", "superseded", "rebased", "conflicted", "review-required"].includes(item.state)) return false;
    if (item.owner && item.owner !== activeOwner) return false;
    if (item.failure === "rate-limited" && (item.nextRetryAt ?? 0) > Date.now()) return false;
    if (!persistPending({ ...item, owner: activeOwner, resetEpoch: getStoredResetEpoch(), state: "pending", deliveryToken: undefined, nextRetryAt: 0, failure: undefined, guidance: undefined })) return false;
    localStorage.removeItem(terminalKey); notify(); scheduleNextFlush(); return true;
  } catch { return false; }
}
/** Review-required records are intentionally immutable evidence and cannot be discarded. */
export function discardOperationalIntent(id: string): boolean {
  try {
    const raw = localStorage.getItem(`${PENDING_PREFIX}${id}`) ?? localStorage.getItem(`${TERMINAL_PREFIX}${id}`);
    const item = JSON.parse(raw ?? "null");
    if (!valid(item) || (item.owner && item.owner !== activeOwner) || ["sending", "conflicted", "review-required"].includes(item.state)) return false;
    localStorage.removeItem(`${PENDING_PREFIX}${id}`); localStorage.removeItem(`${TERMINAL_PREFIX}${id}`); notify(); return true;
  } catch { return false; }
}
export function operationalIntentBlocksLifecycle(runId: string, intents = readOperationalIntentOutbox()): boolean {
  return intents.some((intent) =>
    intent.runId === runId
    && ["pending", "sending", "blocked", "permanently-rejected", "conflicted", "review-required"].includes(intent.state)
    && ["pause", "resume", "lifecycle"].includes(intent.action),
  );
}
export function fencePendingOperationalValues<T extends object>(
  runValues: T,
  intents = readOperationalIntentOutbox(),
): T {
  const output = { ...runValues } as T;
  for (const intent of intents) {
    if (
      intent.action !== "correction"
      || !["pending", "sending", "blocked", "permanently-rejected", "conflicted", "review-required"].includes(intent.state)
      || !intent.values
    ) continue;
    const current = (output as Record<string, Record<string, unknown>>)[intent.runId];
    if (!current) continue;
    const next = { ...current };
    for (const field of Object.keys(intent.values)) delete next[field];
    if (Object.keys(next).length === 0) delete (output as Record<string, unknown>)[intent.runId];
    else (output as Record<string, Record<string, unknown>>)[intent.runId] = next;
  }
  return output;
}
export function fencePendingOperationalSnapshots<T extends { id: string; startedAt?: number; pausedAt?: number; pausedStoppageId?: string; endedAt?: number; stoppages?: unknown[]; metaUpdatedAt?: number }>(runs: T[], intents = readOperationalIntentOutbox()): T[] {
  // Lifecycle commands remain authoritative until their receipt is adopted.
  // Strip optimistic lifecycle fields from the ordinary snapshot path so a
  // stale/offline projection cannot bypass the command reducer.
  const pending = new Map(intents.filter((x) =>
    ["pending", "sending", "blocked", "permanently-rejected", "conflicted", "review-required"].includes(x.state)
    && (x.action === "lifecycle" || x.action === "pause" || x.action === "resume")
  ).map((x) => [x.runId, x]));
  return runs.map((run) => {
    const intent = pending.get(run.id); if (!intent) return run;
    const { startedAt: _a, pausedAt: _b, pausedStoppageId: _c, endedAt: _d, stoppages: _e, metaUpdatedAt: _f, ...nonLifecycle } = run;
    if (intent.preLifecycle) return { ...nonLifecycle, ...intent.preLifecycle } as T;
    if (intent.preEndLifecycle) return { ...nonLifecycle, ...intent.preEndLifecycle } as T;
    const stamp = Number(intent.observedGeneration.slice(intent.observedGeneration.lastIndexOf(":") + 1));
    return { ...run, endedAt: undefined, ...(Number.isFinite(stamp) ? { metaUpdatedAt: stamp } : {}) };
  });
}
/** Backwards-compatible name used by existing callers and tests. */
export function fencePendingEndSnapshots<T extends { id: string; startedAt?: number; pausedAt?: number; pausedStoppageId?: string; endedAt?: number; stoppages?: unknown[]; metaUpdatedAt?: number }>(runs: T[], intents = readOperationalIntentOutbox()): T[] {
  return fencePendingOperationalSnapshots(runs, intents);
}
function jitter(id: string): number { let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return hash % 1000; }
function retryAfter(res: Response): number | undefined {
  const value = res.headers?.get("Retry-After"); if (!value) return undefined;
  const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value); return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}
function temporary(item: OperationalIntent, failure: OperationalIntentFailure, guidance: string, wait?: number): void {
  if (!currentDeliveryMatches(item)) return;
  const attempts = (item.attempts ?? 0) + 1;
  const delay = wait === undefined
    ? Math.min(BACKOFF_MAX_MS, 1000 * 2 ** Math.min(attempts - 1, 8) + jitter(item.id))
    : Math.min(RETRY_AFTER_MAX_MS, wait);
  persistPending({ ...item, state: "pending", deliveryToken: undefined, attempts, lastAttemptAt: Date.now(), nextRetryAt: Date.now() + delay, failure, guidance });
  notify();
  scheduleNextFlush();
}
type FlushLock = { owner: string; key: string };

function lockKey(identity = activeOwner): string { return `${LOCK_KEY}:${identity ?? "signed-out"}`; }
function acquireLock(): FlushLock | undefined {
  const now = Date.now();
  try {
    const key = lockKey();
    const existing = JSON.parse(localStorage.getItem(key) ?? "null") as { until?: number } | null;
    if (existing?.until && existing.until > now) return undefined;
    const owner = crypto.randomUUID();
    localStorage.setItem(key, JSON.stringify({ until: now + LOCK_LEASE_MS, owner }));
    // A same-millisecond contender must not proceed unless it owns the lock it wrote.
    return JSON.parse(localStorage.getItem(key) ?? "null").owner === owner ? { owner, key } : undefined;
  } catch { return undefined; }
}
function renewLock(lock: FlushLock): boolean {
  try {
    const current = JSON.parse(localStorage.getItem(lock.key) ?? "null") as { owner?: string } | null;
    if (current?.owner !== lock.owner) return false;
    localStorage.setItem(lock.key, JSON.stringify({ owner: lock.owner, until: Date.now() + LOCK_LEASE_MS }));
    return true;
  } catch {
    return false;
  }
}
function releaseLock(lock: FlushLock): void {
  try {
    if (JSON.parse(localStorage.getItem(lock.key) ?? "null").owner === lock.owner) localStorage.removeItem(lock.key);
  } catch { /* the expired lock can be reclaimed later */ }
}
function scheduleNextFlush(): void {
  if (typeof window === "undefined") return;
  if (retryTimer !== undefined) window.clearTimeout(retryTimer);
  retryTimer = undefined;
  if (!activeOwner) return;
  const next = readOperationalIntentOutbox()
    .filter((item) => item.state === "pending" && (item.nextRetryAt ?? 0) > Date.now())
    .reduce((earliest, item) => Math.min(earliest, item.nextRetryAt!), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(next)) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void flushOperationalIntentOutbox();
  }, Math.max(0, next - Date.now()));
}
async function flushWithStorageLock(senderId: string): Promise<void> {
    if (typeof window === "undefined" || !activeOwner) return;
    if (!navigator.onLine) {
      for (const item of readOperationalIntentOutbox().filter((candidate) =>
        ["pending", "sending"].includes(candidate.state) && !candidate.deferredOffline
      )) {
        persistPending({ ...item, deferredOffline: true });
      }
      return;
    }
    const ownerAtStart = activeOwner;
    const lock = acquireLock();
    if (!lock) return;
    let deliveryController: AbortController | undefined;
    const renewal = window.setInterval(() => {
      if (!renewLock(lock)) deliveryController?.abort();
    }, LOCK_RENEW_MS);
    try {
      for (const original of readOperationalIntentOutbox().filter((x) => ["pending", "sending"].includes(x.state)).sort((a, b) => a.effectiveAt - b.effectiveAt || a.id.localeCompare(b.id))) {
        if (activeOwner !== ownerAtStart) return;
        if (original.state === "pending" && (original.nextRetryAt ?? 0) > Date.now()) continue;
        const item = {
          ...original,
          state: "sending" as const,
          deliveryToken: crypto.randomUUID(),
          lastAttemptAt: Date.now(),
        };
        persistPending(item); notify();
        if (item.resetEpoch < getStoredResetEpoch()) {
          terminalize(item, "blocked", {
            failure: "validation",
            guidance: "This action was created before a reset. Review the current run, then choose Retry or Discard.",
          });
          continue;
        }
        deliveryController = new AbortController();
        const deliveryTimeout = window.setTimeout(() => deliveryController?.abort(), DELIVERY_TIMEOUT_MS);
        try {
           const res = await fetch(`/api/sync/operational-intents?today=${encodeURIComponent(item.date)}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: deliveryController.signal, body: JSON.stringify({
             senderId,
             deviceId: item.deviceId || senderId || getOperationalDeviceId(),
             baseRevision: item.baseRevision ?? 0,
             intent: (({ state: _state, owner: _owner, deliveryToken: _token, deviceId: _deviceId, preLifecycle: _preLifecycle, preEndLifecycle: _local, attempts: _a, nextRetryAt: _n, lastAttemptAt: _l, failure: _f, guidance: _g, resolvedAt: _r, deferredOffline: _offline, canonicalCursor: _cursor, canonicalRevision: _revision, serverTime: _serverTime, snapshotId: _snapshotId, canonicalAdoptedAt: _adoptedAt, serverTimeOffsetMs: _offset, ...wire }) => wire)(item),
           }) });
           let body: { outcome?: string; data?: unknown; cursor?: number; canonicalRevision?: number; serverTime?: number; snapshotId?: string } = {}; try { body = await res.json(); } catch { /* status classification still applies */ }
          if (activeOwner !== ownerAtStart || !currentDeliveryMatches(item)) continue;
          if (res.ok && ["accepted", "superseded", "rebased", "conflicted", "review-required"].includes(body.outcome ?? "")) {
            const outcome = body.outcome as "accepted" | "superseded" | "rebased" | "conflicted" | "review-required";
             const receipt: OperationalIntentCanonicalReceipt = {
               ...(Number.isSafeInteger(body.cursor) ? { cursor: body.cursor } : {}),
               ...(Number.isSafeInteger(body.canonicalRevision) ? { canonicalRevision: body.canonicalRevision } : {}),
               ...(Number.isFinite(body.serverTime) ? { serverTime: body.serverTime } : {}),
               ...(typeof body.snapshotId === "string" ? { snapshotId: body.snapshotId } : {}),
               adoptedAt: Date.now(),
             };
             const receiptIntent: OperationalIntent = {
               ...item,
               ...(receipt.cursor !== undefined ? { canonicalCursor: receipt.cursor } : {}),
               ...(receipt.canonicalRevision !== undefined ? { canonicalRevision: receipt.canonicalRevision } : {}),
               ...(receipt.serverTime !== undefined ? { serverTime: receipt.serverTime, serverTimeOffsetMs: receipt.serverTime - Date.now() } : {}),
               ...(receipt.snapshotId !== undefined ? { snapshotId: receipt.snapshotId } : {}),
               canonicalAdoptedAt: receipt.adoptedAt,
             };
             // Older server responses may omit data for a duplicate outcome.
             // There is nothing to install in that case; retain the receipt and
             // let the idempotent command terminalize normally.
             if (adoptCanonical && body.data) await adoptCanonical(body.data, receiptIntent, outcome);
            if (item.deferredOffline) {
              window.dispatchEvent(new CustomEvent("calculator-field-check-signal", {
                detail: { checkName: "offline-queue-replay", outcome: "success" },
              }));
            }
             terminalize(item, outcome, {
               ...(receipt.cursor !== undefined ? { canonicalCursor: receipt.cursor } : {}),
               ...(receipt.canonicalRevision !== undefined ? { canonicalRevision: receipt.canonicalRevision } : {}),
               ...(receipt.serverTime !== undefined ? { serverTime: receipt.serverTime, serverTimeOffsetMs: receipt.serverTime - Date.now() } : {}),
               ...(receipt.snapshotId !== undefined ? { snapshotId: receipt.snapshotId } : {}),
               canonicalAdoptedAt: receipt.adoptedAt,
             }); continue;
          }
          if (res.status === 401) terminalize(item, "blocked", { failure: "authentication", guidance: "Sign in again, then choose Retry." });
          else if (res.status === 403) terminalize(item, "blocked", { failure: "permission", guidance: "You do not have permission. Ask a manager, then Retry if access changes." });
          else if (res.status === 400 || res.status === 422) terminalize(item, "permanently-rejected", { failure: "validation", guidance: "This action was rejected as invalid. Review the run and create a corrected action." });
          else if (res.status === 413 || res.status === 507) terminalize(item, "blocked", { failure: "quota", guidance: "Device or server storage is full. Free space, then choose Retry." });
          else if (res.status === 429) temporary(item, "rate-limited", "Server is busy. This action will retry after the requested wait.", retryAfter(res));
          else temporary(item, "server", "Server problem. This action is saved locally and will retry with backoff.");
        } catch { temporary(item, "network", "No network connection. This action is saved locally and will retry with backoff."); }
        finally {
          window.clearTimeout(deliveryTimeout);
          deliveryController = undefined;
        }
      }
    } finally {
      window.clearInterval(renewal);
      deliveryController?.abort();
      releaseLock(lock);
      scheduleNextFlush();
    }
}
export async function flushOperationalIntentOutbox(senderId = getOperationalDeviceId()): Promise<void> {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    const locks = typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: { request: (name: string, callback: () => Promise<void>) => Promise<void> } }).locks
      : undefined;
    if (locks && activeOwner) {
      await locks.request(`operational-intent-outbox:${activeOwner}`, () => flushWithStorageLock(senderId));
    } else {
      await flushWithStorageLock(senderId);
    }
  })().finally(() => { activeFlush = undefined; });
  return activeFlush;
}