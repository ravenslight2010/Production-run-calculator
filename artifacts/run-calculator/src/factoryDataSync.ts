// Factory directories are read from the authenticated server into memory.
// Only scoped pending commands, conflict metadata and unresolved legacy evidence
// are durable. None of those records is used as an offline read cache.
import { OPERATIONAL_DIRECTORY_KEYS, OPERATIONAL_FACTORY_SETTING_KEYS } from "@workspace/factory-constants";
import { inventoryClientId } from "./inventoryShared";
import { fetchWithDiagnostics } from "./performanceDiagnostics";
import { masterDataEpochHeaders } from "./masterDataEpoch";
import {
  MEMORY_DIRECTORY_KEYS, directoryRaw, setDirectoryRaw, factoryDirectoryState,
  setFactoryDirectoryIdentity, setFactoryDirectoryStatus, resetFactoryDirectoryForTests, batchDirectoryUpdates,
  notifyFactoryDirectory,
} from "./factoryDirectory";
import { browserStorage } from "./adapters/browserRecordStore";
import {
  STOP_REASONS_KEY, CIRCLES_KEY, SHIPPER_KEY, SKID_STACKING_KEY, GRIP_SHEETS_KEY,
  SHIFT_START_TIME_KEY, PRODUCTION_START_TIME_KEY, DEFAULT_STOP_REASONS,
  DEFAULT_CIRCLES, DEFAULT_SHIPPERS, DEFAULT_SKID_STACKING, DEFAULT_GRIP_SHEETS,
  DEFAULT_SHIFT_START_TIME, DEFAULT_PRODUCTION_START_TIME,
} from "./types";

/** Compatibility name: these keys no longer designate persistent read caches. */
export const FACTORY_KV_CACHED_KEYS: ReadonlySet<string> = new Set(OPERATIONAL_DIRECTORY_KEYS);
const settingsKeys: ReadonlySet<string> = new Set(OPERATIONAL_FACTORY_SETTING_KEYS);
const allKeys = new Set([...FACTORY_KV_CACHED_KEYS, ...settingsKeys]);
// Legacy server-only settings also need a recovery path. They are not new live
// caches and must not be silently assigned to the account that first loads.
const legacyReviewKeys = allKeys;
const STAMP_PREFIX = "run-calc-fkv-stamp-";
const QUEUE_PREFIX = "run-calc-fkv-queue-v2:";
const LEGACY_QUEUE = "run-calc-fkv-queue-v1";
const UNOWNED_REVIEW_PREFIX = "run-calc-fkv-legacy-review:unowned:";
let scopeIdentity: string | null = null;
let canWrite = false;
let scopeEpoch = 0;
let generation = 0;
let readOrder = 0;
let appliedReadOrder = 0;
const readReceipts = new WeakMap<object, { epoch: number; order: number; writeEpoch: string }>();
let adoptedWriteEpoch = "unbound";
let memoryQueue: FactoryQueueOp[] | null = null;
let flushInFlight: Promise<void> | null = null;
const settings = new Map<string, unknown>();
type FactoryQueueOp = { key: string; value: unknown; updatedAt: number; g: number; undoEpoch?: string };
export type FactoryDataEntry = { value: unknown; updatedAt: string };
export type FactoryDataMap = Record<string, FactoryDataEntry>;

export function setFactoryDataIdentity(identity: string | null, writable: boolean): void {
  if (identity === scopeIdentity && writable === canWrite) return;
  scopeIdentity = identity; canWrite = writable; scopeEpoch++; adoptedWriteEpoch = "unbound";
  memoryQueue = null; flushInFlight = null; settings.clear();
  setFactoryDirectoryIdentity(identity);
}
function queueKey(): string | null { return scopeIdentity ? QUEUE_PREFIX + encodeURIComponent(scopeIdentity) : null; }
function stampKey(key: string): string { return `${STAMP_PREFIX}${scopeIdentity ?? "unbound"}:${key}`; }
function localStamp(key: string): number {
  try { return Number(localStorage.getItem(stampKey(key))) || 0; } catch { return 0; }
}
function setStamp(key: string, stamp: number): void {
  try { localStorage.setItem(stampKey(key), String(stamp)); } catch {}
}
export function stampLocalWrite(key: string): number {
  const stamp = Math.max(Date.now(), localStamp(key) + 1);
  setStamp(key, stamp); return stamp;
}
function readQueue(): FactoryQueueOp[] {
  if (memoryQueue) return [...memoryQueue];
  const key = queueKey();
  if (!key) return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw) || !raw.every((op): op is FactoryQueueOp =>
      !!op && allKeys.has(op.key) && validValue(op.key, op.value)
      && Number.isFinite(op.updatedAt) && op.updatedAt >= 0 && Number.isFinite(op.g))) {
      throw new Error("Invalid pending command");
    }
    return raw;
  } catch {
    setFactoryDirectoryStatus("unavailable", "Pending factory edits could not be read. Stored edits were retained; do not clear browser data. Ask a manager to review this device.");
    throw new Error("Pending factory edits unavailable; stored commands retained.");
  }
}
function writeQueue(queue: FactoryQueueOp[]): void {
  const key = queueKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(queue)); memoryQueue = null; }
  catch {
    memoryQueue = [...queue];
    setFactoryDirectoryStatus("unavailable", "This device could not save pending factory edits. Keep this tab open, free browser storage, then retry online before closing it.");
  }
}
function enqueue(key: string, value: unknown, updatedAt: number): void {
  generation = Math.max(generation + 1, Date.now());
  const previous = readQueue().find((op) => op.key === key);
  writeQueue([...readQueue().filter((op) => op.key !== key), { key, value, updatedAt, g: generation,
    undoEpoch: previous ? previous.undoEpoch ?? "unbound" : adoptedWriteEpoch }]);
}
function validValue(key: string, value: unknown): boolean {
  if (key === SHIFT_START_TIME_KEY || key === PRODUCTION_START_TIME_KEY) return typeof value === "string";
  if (key.includes("presets") || key.includes("brand-flavors") || key.includes("deleted-")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entries = Object.values(value);
    const strings = (item: unknown) => Array.isArray(item) && item.every((entry) => typeof entry === "string");
    const rows = (item: unknown) => Array.isArray(item) && item.every((row) =>
      row && typeof row === "object" && !Array.isArray(row)
      && typeof row.ingredient === "string" && typeof row.lbs === "number" && Number.isFinite(row.lbs));
    if (key.includes("brand-flavors") || key === "run-calc-deleted-items") return entries.every(strings);
    if (key.includes("deleted-stamps")) return entries.every((item) =>
      item && typeof item === "object" && !Array.isArray(item)
      && Object.values(item).every((stamp) => typeof stamp === "number" && Number.isFinite(stamp)));
    return key === "run-calc-dough-recipe-presets"
      ? entries.every((preset) => preset && typeof preset === "object" && !Array.isArray(preset)
        && rows((preset as { rows?: unknown }).rows))
      : entries.every(rows);
  }
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function applyValue(key: string, value: unknown): void {
  if (MEMORY_DIRECTORY_KEYS.has(key)) setDirectoryRaw(key, JSON.stringify(value));
  else if (settingsKeys.has(key)) settings.set(key, value);
  else if (FACTORY_KV_CACHED_KEYS.has(key)) {
    // Conflict/tombstone metadata remains durable, but is not a directory.
    try { browserStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
}
export function getStopReasons(): string[] { return settings.get(STOP_REASONS_KEY) as string[] ?? DEFAULT_STOP_REASONS; }
export function setStopReasonsModuleState(value: string[]): void { settings.set(STOP_REASONS_KEY, value); }
export function getShiftStartTime(): string { return settings.get(SHIFT_START_TIME_KEY) as string ?? DEFAULT_SHIFT_START_TIME; }
export function getProductionStartTime(): string { return settings.get(PRODUCTION_START_TIME_KEY) as string ?? DEFAULT_PRODUCTION_START_TIME; }
export function setShiftStartTimeModuleState(value: string): void { settings.set(SHIFT_START_TIME_KEY, value); }
export function setProductionStartTimeModuleState(value: string): void { settings.set(PRODUCTION_START_TIME_KEY, value); }
export interface PackagingSettings { circles: string[]; shipper: string[]; skidStacking: string[]; gripSheets: string[] }
export function getPackagingSettings(): PackagingSettings {
  return {
    circles: settings.get(CIRCLES_KEY) as string[] ?? DEFAULT_CIRCLES,
    shipper: settings.get(SHIPPER_KEY) as string[] ?? DEFAULT_SHIPPERS,
    skidStacking: settings.get(SKID_STACKING_KEY) as string[] ?? DEFAULT_SKID_STACKING,
    gripSheets: settings.get(GRIP_SHEETS_KEY) as string[] ?? DEFAULT_GRIP_SHEETS,
  };
}
export function setPackagingSettingsModuleState(value: PackagingSettings): void {
  settings.set(CIRCLES_KEY, value.circles); settings.set(SHIPPER_KEY, value.shipper);
  settings.set(SKID_STACKING_KEY, value.skidStacking); settings.set(GRIP_SHEETS_KEY, value.gripSheets);
}
function validateMap(body: unknown): FactoryDataMap {
  if (!body || typeof body !== "object" || !("data" in body)) throw new Error("Invalid directory response");
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid directory response");
  for (const [key, entry] of Object.entries(data)) {
    if (!allKeys.has(key)) continue;
    if (!entry || typeof entry !== "object" || !validValue(key, entry.value)
      || typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) {
      throw new Error("Invalid directory entry");
    }
  }
  return Object.fromEntries(Object.entries(data).filter(([key]) => allKeys.has(key))) as FactoryDataMap;
}
export async function fetchFactoryData(): Promise<FactoryDataMap> {
  const epoch = scopeEpoch;
  const order = ++readOrder;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetchWithDiagnostics(canWrite ? "/api/factory-data" : "/api/factory-data/operational", {
      headers: { "x-client-id": inventoryClientId() }, cache: "no-store", signal: controller.signal,
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Session expired. Sign in again." : `Directory unavailable (${res.status}). Retry online.`);
    const data = validateMap(await res.json());
    if (epoch !== scopeEpoch) throw new Error("Directory request superseded by account change");
    readReceipts.set(data, { epoch, order, writeEpoch: res.headers.get("x-master-data-epoch") ?? "unbound" });
    return data;
  } catch (error) {
    if (epoch === scopeEpoch) setFactoryDirectoryStatus("unavailable", error instanceof Error ? error.message : "Directory unavailable. Retry online.");
    throw error;
  } finally { clearTimeout(timer); }
}
export function putFactoryKey(key: string, value: unknown): void {
  // No defaults, failed bootstrap, signed-out session or staff code path may
  // manufacture a durable replacement for the real server directory.
  if (!scopeIdentity || !canWrite || factoryDirectoryState().status !== "ready") return;
  if (!allKeys.has(key) || !validValue(key, value)) return;
  applyValue(key, value);
  enqueue(key, value, stampLocalWrite(key));
  void flushFactoryQueue();
}
export const pendingFactoryDataWriteCount = () => readQueue().length;
export function flushFactoryQueue(): Promise<void> {
  if (!scopeIdentity || !canWrite || factoryDirectoryState().status !== "ready") return Promise.resolve();
  if (flushInFlight) return flushInFlight;
  const epoch = scopeEpoch;
  const request = Promise.resolve().then(async () => {
    try {
      while (epoch === scopeEpoch && canWrite) {
        const op = readQueue()[0];
        if (!op) return;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        let res: Response;
        try { res = await fetchWithDiagnostics("/api/factory-data", {
          method: "PUT",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "x-client-id": inventoryClientId(), ...masterDataEpochHeaders("factory-data", op.undoEpoch ?? "unbound") },
          body: JSON.stringify({ key: op.key, value: op.value, updatedAt: op.updatedAt }),
        }); } finally { clearTimeout(timeout); }
        if (!res.ok || epoch !== scopeEpoch) return;
        const body = await res.json();
        if (epoch !== scopeEpoch) return;
        // HTTP success alone is not an acknowledgment. A canonical timestamp
        // and valid value are required before retiring the exact generation.
        if (typeof body?.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))
          || !validValue(op.key, body.value)) return;
        const current = readQueue();
        if (current[0]?.g !== op.g) continue;
        const stamp = Date.parse(body.updatedAt);
        if (stamp < op.updatedAt && JSON.stringify(body.value) !== JSON.stringify(op.value)) return;
        applyValue(op.key, body.value);
        setStamp(op.key, stamp);
        writeQueue(current.slice(1));
        cleanLegacy(op.key, body.value);
      }
    } catch { /* Durable operation remains pending for reconnect. */ }
    finally { if (epoch === scopeEpoch) flushInFlight = null; }
  });
  flushInFlight = request;
  return request;
}
function cleanLegacy(key: string, canonical: unknown): void {
  if (!MEMORY_DIRECTORY_KEYS.has(key)) return;
  try {
    const raw = localStorage.getItem(key);
    // Unresolved legacy evidence is retained separately, never read at boot.
    if (raw !== null && JSON.stringify(JSON.parse(raw)) !== JSON.stringify(canonical)) {
      localStorage.setItem(`${UNOWNED_REVIEW_PREFIX}${key}`, raw);
    }
    localStorage.removeItem(key);
    notifyFactoryDirectory();
  } catch { /* Preserve source if review storage is unavailable or malformed. */ }
}
export function hydrateFromServer(data: FactoryDataMap): void {
  const receipt = readReceipts.get(data);
  if (receipt && (receipt.epoch !== scopeEpoch || receipt.order < appliedReadOrder)) {
    throw new Error("Factory directory read superseded; newer session/data retained.");
  }
  const validated = validateMap({ data });
  batchDirectoryUpdates(() => {
  for (const key of allKeys) {
    const entry = validated[key];
    const pending = readQueue().find((op) => op.key === key);
    // Hydration never acknowledges an outbox item: deliver it and validate its
    // canonical response, including stale-write rejection.
    if (pending && (!entry || pending.updatedAt > Date.parse(entry.updatedAt))) {
      applyValue(key, pending.value);
    } else if (entry) {
      if ((directoryRaw(key) !== null || settings.has(key)) && Date.parse(entry.updatedAt) < localStamp(key)) continue;
      applyValue(key, entry.value);
      setStamp(key, Date.parse(entry.updatedAt));
      cleanLegacy(key, entry.value);
    } else if (MEMORY_DIRECTORY_KEYS.has(key)) {
      setDirectoryRaw(key, key.includes("presets") || key.includes("brand-flavors") ? "{}" : "[]");
    }
  }
  if (receipt) adoptedWriteEpoch = receipt.writeEpoch;
  setFactoryDirectoryStatus("ready");
  if (receipt) appliedReadOrder = receipt.order;
  });
}
export type LegacyDirectoryReview = {
  id: string;
  source: string;
  sourceRaw: string;
  key: string;
  value: unknown;
  queueIndex?: number;
  problem?: string;
  canApply: boolean;
  canRemove: boolean;
  removeBlockedReason?: string;
};
/** Explicit review, never a bootstrap source or an automatically deliverable queue. */
export function legacyDirectoryReviews(): LegacyDirectoryReview[] {
  const reviews: LegacyDirectoryReview[] = [];
  if (!scopeIdentity || !canWrite) return reviews;
  try {
    const prefix = `run-calc-fkv-legacy-review:${encodeURIComponent(scopeIdentity)}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const source = localStorage.key(i);
      const matchedPrefix = source?.startsWith(prefix) ? prefix
        : source?.startsWith(UNOWNED_REVIEW_PREFIX) ? UNOWNED_REVIEW_PREFIX : null;
      if (!source || !matchedPrefix) continue;
      const key = source.slice(matchedPrefix.length);
      const sourceRaw = localStorage.getItem(source);
      if (sourceRaw === null) continue;
      try {
        const value = JSON.parse(sourceRaw);
        if (legacyReviewKeys.has(key)) reviews.push({ id: `${source}:${key}`, source, sourceRaw, key, value,
          canApply: true, canRemove: true,
          ...(!validValue(key, value) ? { problem: "Unrecognized saved format. Retained for manual review; not safe to apply." } : {}) });
      } catch { reviews.push({ id: `${source}:${key}`, source, sourceRaw, key, value: null,
        canApply: false, canRemove: true, problem: "Unreadable saved format. Retained for manual review; not safe to apply." }); }
    }
    const queueRaw = localStorage.getItem(LEGACY_QUEUE);
    let queue: unknown;
    let queueReadable = false;
    try {
      queue = JSON.parse(queueRaw ?? "[]");
      queueReadable = Array.isArray(queue);
    } catch {}
    if (queueRaw !== null && !queueReadable) {
      // Preserve and identify malformed queue evidence, but do not offer an
      // action that could remove unknown queued commands.
      reviews.push({
        id: `${LEGACY_QUEUE}:unreadable`, source: LEGACY_QUEUE, sourceRaw: queueRaw,
        key: LEGACY_QUEUE, value: null, canApply: false, canRemove: false,
        removeBlockedReason: "This saved list may contain unsent work and is protected from removal.",
        problem: "This saved edit list cannot be read. It is preserved; ask a manager for help before changing browser data.",
      });
    }
    if (queueReadable && Array.isArray(queue)) {
      const malformedItems = queue.filter((op) =>
        !op || !allKeys.has(op.key) || !validValue(op.key, op.value));
      if (malformedItems.length) reviews.push({
        id: `${LEGACY_QUEUE}:unreadable-items`, source: LEGACY_QUEUE, sourceRaw: queueRaw ?? "[]",
        key: LEGACY_QUEUE, value: null, canApply: false, canRemove: false,
        removeBlockedReason: "This saved list may contain unsent work and is protected from removal.",
        problem: `${malformedItems.length} item${malformedItems.length === 1 ? "" : "s"} in this saved edit list could not be identified. The list is preserved; ask a manager for help before changing browser data.`,
      });
      for (const [queueIndex, op] of queue.entries()) {
      if (op && allKeys.has(op.key) && validValue(op.key, op.value)) {
        reviews.push({
          id: `${LEGACY_QUEUE}:${queueIndex}:${op.key}`,
          source: LEGACY_QUEUE, sourceRaw: queueRaw ?? "[]", key: op.key, value: op.value,
          queueIndex, canApply: true, canRemove: false,
          removeBlockedReason: "This saved edit may not have been sent to the facility yet. Apply it or leave it saved; it cannot be discarded from this review.",
        });
      }
      }
    }
    for (const key of legacyReviewKeys) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        const value = JSON.parse(raw);
        reviews.push({ id: `${key}:${key}`, source: key, sourceRaw: raw, key, value, canApply: true, canRemove: true,
          ...(!validValue(key, value) ? { problem: "Unrecognized saved format. Retained for manual review; not safe to apply." } : {}) });
      } catch { reviews.push({ id: `${key}:${key}`, source: key, sourceRaw: raw, key, value: null,
        canApply: false, canRemove: true, problem: "Unreadable saved format. Retained for manual review; not safe to apply." }); }
    }
    const flatFlavors = localStorage.getItem("run-calc-flavors");
    if (flatFlavors !== null) reviews.push({ source: "run-calc-flavors", key: "run-calc-brand-flavors",
      id: "run-calc-flavors:run-calc-brand-flavors", sourceRaw: flatFlavors,
      value: flatFlavors, canApply: false, canRemove: true,
      problem: "Legacy flavors have no brand assignment. Retained for manual review; assign them to brands in Manage Lists before discarding this copy." });
  } catch { /* Keep malformed evidence intact; never guess its intent. */ }
  return reviews;
}

function removeReviewedLegacySource(review: LegacyDirectoryReview): boolean {
  const currentRaw = localStorage.getItem(review.source);
  if (currentRaw === null || currentRaw !== review.sourceRaw) return false;
  if (review.source === LEGACY_QUEUE) {
    if (review.queueIndex === undefined) return false;
    const entries: unknown = JSON.parse(currentRaw);
    if (!Array.isArray(entries)) return false;
    const selected = entries[review.queueIndex] as FactoryQueueOp | undefined;
    if (!selected || selected.key !== review.key
      || JSON.stringify(selected.value) !== JSON.stringify(review.value)) return false;
    const remaining = entries.filter((_, index) => index !== review.queueIndex);
    if (remaining.length) localStorage.setItem(review.source, JSON.stringify(remaining));
    else localStorage.removeItem(review.source);
    return localStorage.getItem(review.source) === (remaining.length ? JSON.stringify(remaining) : null);
  }
  localStorage.removeItem(review.source);
  return localStorage.getItem(review.source) === null;
}

export async function resolveLegacyDirectoryReview(review: LegacyDirectoryReview, apply: boolean): Promise<boolean> {
  const epoch = scopeEpoch;
  if (!scopeIdentity || !canWrite || factoryDirectoryState().status !== "ready") return false;
  if (!legacyDirectoryReviews().some((item) => item.id === review.id && item.sourceRaw === review.sourceRaw
    && item.key === review.key && (apply ? item.canApply : item.canRemove))) return false;
  try {
    if (apply) {
      if (review.problem || !validValue(review.key, review.value)) return false;
      putFactoryKey(review.key, review.value);
      await flushFactoryQueue();
      if (epoch !== scopeEpoch || readQueue().some((op) => op.key === review.key)) return false;
    } else if (readQueue().some((op) => op.key === review.key)) {
      // Keep is not a hidden cancellation of a manager-authorized command.
      // Finish its acknowledgment before discarding the original legacy bytes.
      return false;
    }
  } catch { return false; }
  if (epoch !== scopeEpoch) return false;
  try {
    if (!removeReviewedLegacySource(review)) return false;
    setFactoryDirectoryStatus("ready");
    return true;
  } catch { return false; }
}
export async function runFactoryKvMigration(serverData: FactoryDataMap): Promise<void> {
  if (!scopeIdentity || !canWrite || factoryDirectoryState().status !== "ready") return;
  // Legacy unpartitioned commands have no trustworthy identity. Keep them for
  // explicit review, never silently deliver them as the next signed-in person.
  // Per-key stamps are preserved; unstamped values use revision zero and can
  // only seed absent rows. No fresh timestamps for stale legacy data.
  // Old v1 lists and commands carry no authenticated owner/scope. Existing
  // canonical records reconcile identical values; differences/absent records
  // require the explicit manager review above rather than a guessed owner.
  for (const key of MEMORY_DIRECTORY_KEYS) if (serverData[key]) cleanLegacy(key, serverData[key].value);
  await flushFactoryQueue();
}
export function resetFactoryDataSyncForTests(): void {
  scopeIdentity = null; canWrite = false; scopeEpoch++; generation = 0;
  adoptedWriteEpoch = "unbound";
  memoryQueue = null; flushInFlight = null; settings.clear(); resetFactoryDirectoryForTests();
}
