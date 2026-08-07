// Brand+flavor setup profiles — server-pool sync glue (web).
//
// Profiles used to travel inside the per-day sync payload as an unstamped
// map where the last push won, so a stale device re-publishing an old form
// could clobber a fresher edit. They are now factory-wide master data in
// their own server pool (like Cheese / Dough / Sauce recipes) with a
// per-profile last-write-wins stamp enforced SERVER-side.
//
// localStorage stays the read cache — loadProfile/saveProfile keep reading
// and writing the same `run-calc-profile-*` / `run-calc-crust-profile-*`
// blobs synchronously. This module adds:
//
//   • a per-profile local edit-stamp map (ms epoch) bumped on every real edit
//   • a persisted push queue + serialized flush, so edits survive offline
//     stretches and are retried on the next kick/poll
//   • `reconcileProfilesFromServer()` — adopt server-newer profiles into the
//     cache, push local-newer ones up, push never-synced local profiles up
//     (self-healing migration), and drop local copies of profiles that were
//     deleted on the server (guarded by the "was ever synced" map so a
//     never-pushed local profile is never destroyed)
//   • a marker-guarded one-time migration that enqueues every existing local
//     profile with stamp fallback 1, so first-migrator wins on ties but ANY
//     real edit (Date.now() stamps) beats a migrated blob
//
// Everything here is fail-safe: storage errors and network failures are
// swallowed (the queue persists and retries), so profile saving never breaks
// the run form even fully offline.

import { inventoryClientId } from "./inventoryShared";

const DOUGH_PREFIX = "run-calc-profile-";
const CRUST_PREFIX = "run-calc-crust-profile-";
// Bookkeeping keys deliberately do NOT start with `run-calc-profile-` so the
// existing profile-key scans (delete-by-brand, die-type heal, …) never mistake
// them for a profile blob.
const STAMPS_KEY = "run-calc-profilesync-stamps-v1";
const SYNCED_KEY = "run-calc-profilesync-synced-v1";
const QUEUE_KEY = "run-calc-profilesync-queue-v1";
const MIGRATED_KEY = "run-calc-profiles-server-migrated-v1";

/** Canonical profile key `${brandLc}__${flavorLc}` — identical to the suffix of PROFILE_KEY. */
export function canonicalProfileKey(brand: string, flavor: string): string {
  return `${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
}

function doughStorageKey(key: string): string {
  return `${DOUGH_PREFIX}${key}`;
}
function crustStorageKey(key: string): string {
  return `${CRUST_PREFIX}${key}`;
}

type StampMap = Record<string, number>;
type QueueOp = { t: "up" | "del"; key: string };

// In-memory fallbacks for when localStorage writes FAIL (quota exceeded).
// Without these, a full localStorage made enqueue()/writeQueue() silently
// no-op and the edit never synced. When a persist throws, the latest value is
// kept here and becomes AUTHORITATIVE for reads (it was derived from the
// persisted state plus every later change, so it is always a superset of the
// stale persisted copy). The immediate flush kick pushes queued edits straight
// from memory; the fallback is cleared the moment a persist succeeds again.
// Ops held only in memory do not survive a reload — hence flushing right away.
let memoryQueue: QueueOp[] | null = null;
const memoryMaps = new Map<string, StampMap>();

/** Test-only: clear the in-memory storage fallbacks between test cases. */
export function resetProfileSyncMemoryFallbackForTests(): void {
  memoryQueue = null;
  memoryMaps.clear();
}

function readMap(storageKey: string): StampMap {
  const mem = memoryMaps.get(storageKey);
  if (mem) return { ...mem };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StampMap;
    }
  } catch {}
  return {};
}

function writeMap(storageKey: string, map: StampMap): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
    memoryMaps.delete(storageKey);
  } catch {
    // Quota exceeded (or storage unavailable) — keep the latest value in
    // memory so the pending edit's stamp is not silently lost.
    memoryMaps.set(storageKey, { ...map });
  }
}

function readQueue(): QueueOp[] {
  if (memoryQueue !== null) return [...memoryQueue];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (op): op is QueueOp =>
          !!op &&
          typeof op === "object" &&
          (op.t === "up" || op.t === "del") &&
          typeof op.key === "string" &&
          op.key.length > 0,
      );
    }
  } catch {}
  return [];
}

function writeQueue(ops: QueueOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
    memoryQueue = null;
  } catch {
    // Quota exceeded — the queue lives in memory until storage recovers; the
    // caller's flush kick still pushes these ops to the server right away.
    memoryQueue = [...ops];
  }
}

/** Last op per key wins (an edit followed by a delete must delete, and vice versa). */
function enqueue(op: QueueOp): void {
  const ops = readQueue().filter((o) => o.key !== op.key);
  ops.push(op);
  writeQueue(ops);
}

export function getProfileStamp(key: string): number {
  return readMap(STAMPS_KEY)[key] ?? 0;
}

/**
 * Record a REAL local edit to the profile `key` (canonical `${brandLc}__${flavorLc}`):
 * bump its edit stamp (monotonic — never behind a stamp we already hold, so an
 * adopted-then-edited profile always outranks the adopted copy), enqueue an
 * upsert, and kick a background flush. Call AFTER the localStorage blobs were
 * written.
 */
export function markProfileEdited(key: string): void {
  if (!key || key === "__") return;
  const stamps = readMap(STAMPS_KEY);
  stamps[key] = Math.max(Date.now(), (stamps[key] ?? 0) + 1);
  writeMap(STAMPS_KEY, stamps);
  enqueue({ t: "up", key });
  void flushProfileQueue();
}

/**
 * Record a local deletion of profile `key`: drop its stamps, enqueue a server
 * delete, kick a flush. Call AFTER the localStorage blobs were removed.
 */
export function markProfileDeleted(key: string): void {
  if (!key || key === "__") return;
  const stamps = readMap(STAMPS_KEY);
  delete stamps[key];
  writeMap(STAMPS_KEY, stamps);
  enqueue({ t: "del", key });
  void flushProfileQueue();
}

type ApiProfile = {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
  crustValues: Record<string, unknown>;
  updatedAt: number;
};

function parseBlob(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
}

function splitKey(key: string): { brand: string; flavor: string } {
  const idx = key.indexOf("__");
  if (idx < 0) return { brand: key, flavor: "" };
  return { brand: key.slice(0, idx), flavor: key.slice(idx + 2) };
}

async function apiList(): Promise<ApiProfile[]> {
  const res = await fetch("/api/brand-profiles", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List brand profiles failed (${res.status})`);
  const data = (await res.json()) as { items: ApiProfile[] };
  return Array.isArray(data.items) ? data.items : [];
}

// The server processes at most this many items per request (its MAX_BATCH) —
// anything beyond is silently truncated, so every save/delete call is chunked
// to this size or a large migration/retry would drop the unsent tail while the
// client marked all keys as done.
const SERVER_MAX_BATCH = 500;

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function apiSave(items: ApiProfile[]): Promise<void> {
  for (const part of chunk(items, SERVER_MAX_BATCH)) {
    const res = await fetch("/api/brand-profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": inventoryClientId(),
      },
      body: JSON.stringify({ items: part }),
    });
    if (!res.ok) throw new Error(`Save brand profiles failed (${res.status})`);
  }
}

async function apiDelete(keys: string[]): Promise<void> {
  for (const part of chunk(keys, SERVER_MAX_BATCH)) {
    const res = await fetch("/api/brand-profiles", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": inventoryClientId(),
      },
      body: JSON.stringify({ keys: part }),
    });
    if (!res.ok) throw new Error(`Delete brand profiles failed (${res.status})`);
  }
}

let flushInFlight: Promise<void> | null = null;
let flushAgain = false;

/**
 * Push the persisted op queue to the server (serialized — concurrent kicks
 * coalesce). Best-effort: on any failure the queue is left intact and will be
 * retried on the next kick or reconcile poll.
 */
export function flushProfileQueue(): Promise<void> {
  if (flushInFlight) {
    flushAgain = true;
    return flushInFlight;
  }
  flushInFlight = (async () => {
    try {
      await flushOnce();
    } catch {
      // best-effort: queue stays persisted for the next kick
    } finally {
      flushInFlight = null;
      if (flushAgain) {
        flushAgain = false;
        void flushProfileQueue();
      }
    }
  })();
  return flushInFlight;
}

async function flushOnce(): Promise<void> {
  const ops = readQueue();
  if (ops.length === 0) return;

  const upserts: ApiProfile[] = [];
  const upsertKeys: string[] = [];
  const deleteKeys: string[] = [];
  const dropKeys: string[] = [];
  const stamps = readMap(STAMPS_KEY);

  for (const op of ops) {
    if (op.t === "del") {
      deleteKeys.push(op.key);
      continue;
    }
    const dough = localStorage.getItem(doughStorageKey(op.key));
    const crust = localStorage.getItem(crustStorageKey(op.key));
    if (dough === null && crust === null) {
      // Blobs vanished since the edit (deleted meanwhile) — drop the stale op;
      // the deletion path enqueued its own delete op.
      dropKeys.push(op.key);
      continue;
    }
    const { brand, flavor } = splitKey(op.key);
    upserts.push({
      key: op.key,
      brand,
      flavor,
      values: parseBlob(dough),
      crustValues: parseBlob(crust),
      updatedAt: stamps[op.key] ?? 1,
    });
    upsertKeys.push(op.key);
  }

  let doneKeys: string[] = [...dropKeys];

  if (upserts.length > 0) {
    await apiSave(upserts);
    const synced = readMap(SYNCED_KEY);
    for (const item of upserts) synced[item.key] = item.updatedAt;
    writeMap(SYNCED_KEY, synced);
    doneKeys = doneKeys.concat(upsertKeys);
  }

  if (deleteKeys.length > 0) {
    await apiDelete(deleteKeys);
    const synced = readMap(SYNCED_KEY);
    for (const key of deleteKeys) delete synced[key];
    writeMap(SYNCED_KEY, synced);
    doneKeys = doneKeys.concat(deleteKeys);
  }

  // Remove completed ops — but keep any op that was re-enqueued (newer edit)
  // while the network round-trip was in flight.
  const done = new Set(doneKeys);
  const current = readQueue();
  const remaining = current.filter((op) => {
    if (!done.has(op.key)) return true;
    const sent = ops.find((o) => o.key === op.key);
    return !sent || sent.t !== op.t;
  });
  if (remaining.length !== current.length) writeQueue(remaining);
}

/** Every canonical profile key that exists in the local cache (dough or crust blob). */
function localProfileKeys(): string[] {
  const keys = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name) continue;
      if (name.startsWith(CRUST_PREFIX)) keys.add(name.slice(CRUST_PREFIX.length));
      else if (name.startsWith(DOUGH_PREFIX)) keys.add(name.slice(DOUGH_PREFIX.length));
    }
  } catch {}
  keys.delete("");
  keys.delete("__");
  // Canonical profile keys are always `${brand}__${flavor}`. Anything without
  // the separator is NOT a profile blob — e.g. the spec-sheet cleanup marker
  // ("run-calc-profile-cleanup-v1") shares the dough prefix and must never be
  // migrated to the server pool as a junk profile.
  return [...keys].filter((k) => k.includes("__"));
}

/**
 * Marker-guarded one-time migration: enqueue EVERY existing local profile for
 * upload with stamp fallback 1 (server keeps the first migrator's copy on
 * stamp ties, and any real edit — a Date.now() stamp — always outranks a
 * migrated blob). The queue is persisted, so the marker is set as soon as the
 * enqueue completes; the actual upload retries until it succeeds.
 */
export function migrateLocalProfilesToServerIfNeeded(): void {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
  } catch {
    return;
  }
  for (const key of localProfileKeys()) enqueue({ t: "up", key });
  try {
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch {}
  void flushProfileQueue();
}

/**
 * Reconcile the local profile cache against the server pool. Returns true when
 * any local blob changed (so callers can refresh profile-derived UI).
 *
 *   server newer  → overwrite the local blobs + adopt the server stamp
 *   local newer   → enqueue an upsert (self-heal for a lost queue)
 *   never-synced local profile absent from server → enqueue an upsert
 *   previously-synced local profile absent from server → deleted remotely;
 *     drop the local copy (skipped while an op for that key is still queued)
 */
export async function reconcileProfilesFromServer(): Promise<boolean> {
  migrateLocalProfilesToServerIfNeeded();

  let serverItems: ApiProfile[];
  try {
    serverItems = await apiList();
  } catch {
    // Offline / signed-out — retry queued pushes anyway and bail quietly.
    void flushProfileQueue();
    return false;
  }

  let changed = false;
  const stamps = readMap(STAMPS_KEY);
  const synced = readMap(SYNCED_KEY);
  const serverByKey = new Map(serverItems.map((it) => [it.key, it]));
  const pending = new Set(readQueue().map((op) => op.key));

  for (const item of serverItems) {
    if (!item.key || item.key === "__") continue;
    const localStamp = stamps[item.key] ?? 0;
    if (item.updatedAt > localStamp) {
      try {
        localStorage.setItem(doughStorageKey(item.key), JSON.stringify(item.values ?? {}));
        localStorage.setItem(
          crustStorageKey(item.key),
          JSON.stringify(item.crustValues ?? {}),
        );
        stamps[item.key] = item.updatedAt;
        synced[item.key] = item.updatedAt;
        changed = true;
        // Seed the fast-access :subtab key from the embedded _subTab field so
        // loadProfileSubTab() can return the correct mode without parsing the
        // full profile blob on every call. This is the mechanism that propagates
        // a manager's Dough/Crust toggle to all other tablets.
        const subTab = (item.values as Record<string, unknown> | undefined)?._subTab;
        if (subTab === "dough" || subTab === "crusts") {
          try { localStorage.setItem(item.key + ":subtab", subTab); } catch {}
        }
      } catch {}
    } else if (localStamp > item.updatedAt) {
      if (!pending.has(item.key)) enqueue({ t: "up", key: item.key });
    } else {
      synced[item.key] = item.updatedAt;
    }
  }

  for (const key of localProfileKeys()) {
    if (serverByKey.has(key)) continue;
    if (pending.has(key)) continue; // our own push hasn't landed yet
    if (synced[key] !== undefined) {
      // Was on the server before and is gone now — deleted remotely.
      try {
        localStorage.removeItem(doughStorageKey(key));
        localStorage.removeItem(crustStorageKey(key));
        delete stamps[key];
        delete synced[key];
        changed = true;
      } catch {}
    } else {
      // Local-only profile the server has never seen (offline creation, or a
      // blob written after migration ran) — push it up.
      enqueue({ t: "up", key });
    }
  }

  writeMap(STAMPS_KEY, stamps);
  writeMap(SYNCED_KEY, synced);
  void flushProfileQueue();
  return changed;
}
