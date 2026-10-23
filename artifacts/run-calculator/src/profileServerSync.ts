// Brand+flavor setup profiles — server-pool sync glue (web).
//
// Profiles used to travel inside the per-day sync payload as an unstamped
// map where the last push won, so a stale device re-publishing an old form
// could clobber a fresher edit. They are now factory-wide master data in
// their own server pool (like Cheese / Dough / Sauce recipes) with a
// per-profile last-write-wins stamp enforced SERVER-side.
//
// Authenticated reads populate observable scoped memory. Durable operations own
// their payload/revision; acknowledged directory copies are not persisted.
// Legacy bytes remain review evidence unless ownership and exact canonical
// equality permit safe reconciliation. Reconnect/focus/poll retry owned work.
// Network failures retain pending operations; explicit saves reject missing
// acknowledgements and storage exhaustion is surfaced separately in the UI.

import { inventoryClientId } from "./inventoryShared";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { masterDataEpoch, masterDataEpochHeaders } from "./masterDataEpoch";
import {
  activeProfileCacheOwnsLegacyData,
  cachedProfileKeys,
  getProfileCacheGeneration,
  profileCacheGenerationIsCurrent,
  profileCacheIsActive,
  readCachedProfileBlobs,
  replaceCachedProfiles,
  scopeProfileCacheStorageKey,
  writeCachedProfileBlobs,
  reconcileLegacyProfileReads,
  setProfileReadStatus,
  notifyProfileRecoveryChanged,
} from "./profileCache";

const DOUGH_PREFIX = "run-calc-profile-";
const CRUST_PREFIX = "run-calc-crust-profile-";
// Bookkeeping keys deliberately do NOT start with `run-calc-profile-` so the
// existing profile-key scans (delete-by-brand, die-type heal, …) never mistake
// them for a profile blob.
const STAMPS_KEY = "run-calc-profilesync-stamps-v1";
const SYNCED_KEY = "run-calc-profilesync-synced-v1";
const QUEUE_KEY = "run-calc-profilesync-queue-v1";
const MIGRATED_KEY = "run-calc-profiles-server-migrated-v1";
// Marker for the one-time migration that injects legacy :subtab fast-access
// keys into the dough profile blobs so the server-pool sync distributes them.
const SUBTAB_MIGRATION_MARKER = "run-calc-subtab-blob-migration-v1";

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
// `force` (upserts only) marks an explicit authoritative write (manager Apply
// — e.g. spec import): the server bypasses its strictly-newer stamp guard and
// advances the stored stamp, so the apply lands even when the stored profile
// carries a newer (wrong) stamp. Sticky until flushed.
// `g` is a per-op generation: a flush may only remove the EXACT op it sent, so
// an op re-enqueued while a round-trip is in flight (e.g. a forced apply
// replacing an in-flight plain save) is never mistaken for the completed one
// and silently dropped before it was ever sent.
type QueueOp = {
  t: "up" | "del"; key: string; force?: boolean; g?: number;
  blobs?: { dough: string | null; crust: string | null };
  updatedAt?: number;
  undoEpoch?: string;
};

let genCounter = Date.now();
function nextGen(): number {
  genCounter += 1;
  return genCounter;
}

// In-memory fallbacks for when localStorage writes FAIL (quota exceeded).
// Without these, a full localStorage made enqueue()/writeQueue() silently
// no-op and the edit never synced. When a persist throws, the latest value is
// kept here and becomes AUTHORITATIVE for reads (it was derived from the
// persisted state plus every later change, so it is always a superset of the
// stale persisted copy). The immediate flush kick pushes queued edits straight
// from memory; the fallback is cleared the moment a persist succeeds again.
// Ops held only in memory do not survive a reload — hence flushing right away.
const memoryQueues = new Map<string, QueueOp[]>();
const memoryMaps = new Map<string, StampMap>();
export function profileRecoveryIsMemoryOnly(): boolean {
  return (memoryQueues.get(scopeProfileCacheStorageKey(QUEUE_KEY))?.length ?? 0) > 0;
}

/** Test-only: clear the in-memory storage fallbacks between test cases. */
export function resetProfileSyncMemoryFallbackForTests(): void {
  memoryQueues.clear();
  memoryMaps.clear();
}

function readProfileBlobs(key: string): { dough: string | null; crust: string | null } {
  if (profileCacheIsActive()) return readCachedProfileBlobs(key);
  return {
    dough: localStorage.getItem(doughStorageKey(key)),
    crust: localStorage.getItem(crustStorageKey(key)),
  };
}

function readMap(storageKey: string): StampMap {
  const scopedKey = scopeProfileCacheStorageKey(storageKey);
  const mem = memoryMaps.get(scopedKey);
  if (mem) return { ...mem };
  try {
    const raw = localStorage.getItem(scopedKey)
      ?? (scopedKey !== storageKey && activeProfileCacheOwnsLegacyData()
        ? localStorage.getItem(storageKey)
        : null);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StampMap;
    }
  } catch {}
  return {};
}

function writeMap(storageKey: string, map: StampMap): void {
  const scopedKey = scopeProfileCacheStorageKey(storageKey);
  try {
    localStorage.setItem(scopedKey, JSON.stringify(map));
    memoryMaps.delete(scopedKey);
  } catch {
    // Quota exceeded (or storage unavailable) — keep the latest value in
    // memory so the pending edit's stamp is not silently lost.
    memoryMaps.set(scopedKey, { ...map });
  }
}

function readQueue(): QueueOp[] {
  const scopedKey = scopeProfileCacheStorageKey(QUEUE_KEY);
  const memoryQueue = memoryQueues.get(scopedKey);
  if (memoryQueue) return [...memoryQueue];
  try {
    const raw = localStorage.getItem(scopedKey)
      ?? (scopedKey !== QUEUE_KEY && activeProfileCacheOwnsLegacyData()
        ? localStorage.getItem(QUEUE_KEY)
        : null);
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
  const scopedKey = scopeProfileCacheStorageKey(QUEUE_KEY);
  try {
    localStorage.setItem(scopedKey, JSON.stringify(ops));
    memoryQueues.delete(scopedKey);
  } catch {
    // Quota exceeded — the queue lives in memory until storage recovers; the
    // caller's flush kick still pushes these ops to the server right away.
    memoryQueues.set(scopedKey, [...ops]);
  }
  notifyProfileRecoveryChanged();
}

/**
 * Last op per key wins (an edit followed by a delete must delete, and vice
 * versa). A pending upsert's `force` flag is sticky across later plain edits:
 * the authoritative write hasn't landed yet, and the newer local blob still
 * needs to beat the server's (possibly newer-stamped) wrong row.
 */
function enqueue(op: QueueOp): void {
  const prev = readQueue().find((o) => o.key === op.key);
  const ops = readQueue().filter((o) => o.key !== op.key);
  const stamped = {
    ...op, g: nextGen(), undoEpoch: op.undoEpoch ?? (prev ? prev.undoEpoch ?? "unbound"
      : adoptedProfileEpochGeneration === getProfileCacheGeneration() ? adoptedProfileWriteEpoch : "unbound"),
    ...(op.t === "up" ? {
      blobs: op.blobs ?? readProfileBlobs(op.key),
      updatedAt: op.updatedAt ?? (getProfileStamp(op.key) || 1),
    } : {}),
  };
  if (op.t === "up" && prev?.t === "up" && prev.force && !op.force) {
    ops.push({ ...stamped, force: true });
  } else {
    ops.push(stamped);
  }
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
  if (!profileCacheIsActive()) return;
  if (!key || key === "__") return;
  const stamps = readMap(STAMPS_KEY);
  stamps[key] = Math.max(Date.now(), (stamps[key] ?? 0) + 1);
  writeMap(STAMPS_KEY, stamps);
  enqueue({ t: "up", key });
  void flushProfileQueue();
}

/**
 * Record an explicit, AUTHORITATIVE profile write (a manager Apply action —
 * currently the spec-import commit): like markProfileEdited, but the queued
 * upsert carries `force: true` so the server overwrites the stored row even
 * when its LWW stamp is newer. This is what makes "Apply" always win over a
 * wrong profile that happens to carry a fresher stamp (the Hannaford Tikka
 * Masala reimport-blocked incident). Call AFTER the localStorage blobs were
 * written.
 */
export function markProfileForceEdited(key: string): void {
  if (!profileCacheIsActive()) return;
  if (!key || key === "__") return;
  const stamps = readMap(STAMPS_KEY);
  stamps[key] = Math.max(Date.now(), (stamps[key] ?? 0) + 1);
  writeMap(STAMPS_KEY, stamps);
  enqueue({ t: "up", key, force: true });
  void flushProfileQueue();
}

/**
 * Record a local deletion of profile `key`: drop its stamps, enqueue a server
 * delete, kick a flush. Call AFTER the localStorage blobs were removed.
 */
export function markProfileDeleted(key: string): void {
  if (!profileCacheIsActive()) return;
  if (!key || key === "__") return;
  const stamps = readMap(STAMPS_KEY);
  delete stamps[key];
  writeMap(STAMPS_KEY, stamps);
  enqueue({ t: "del", key });
  void flushProfileQueue();
}

export type ServerBrandProfileSnapshot = {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
  crustValues: Record<string, unknown>;
  updatedAt: number;
};

type ApiProfile = ServerBrandProfileSnapshot & {
  /** Upserts only: authoritative write — server bypasses the LWW stamp guard. */
  force?: boolean;
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function profileValuesMatch(a: ApiProfile, b: ApiProfile): boolean {
  return canonicalJson(a.values) === canonicalJson(b.values)
    && canonicalJson(a.crustValues) === canonicalJson(b.crustValues);
}

async function apiList(): Promise<ApiProfile[]> {
  const cacheGeneration = getProfileCacheGeneration();
  if (apiListInFlight?.generation === cacheGeneration) return apiListInFlight.promise;
  const promise = (async () => {
    const res = await fetchWithTimeout(
      "/api/brand-profiles",
      { headers: { "x-client-id": inventoryClientId() } },
      10_000,
    );
    if (!res.ok) throw new Error(`List brand profiles failed (${res.status})`);
    const data = (await res.json()) as { items: ApiProfile[] };
    if (!Array.isArray(data?.items) || data.items.some((item) =>
      !item || typeof item.key !== "string" || !item.key.includes("__")
      || !Number.isFinite(item.updatedAt)
      || !item.values || typeof item.values !== "object" || Array.isArray(item.values)
      || !item.crustValues || typeof item.crustValues !== "object" || Array.isArray(item.crustValues)
    )) throw new Error("Invalid profile directory response");
    profileReadEpochs.set(data.items, { generation: cacheGeneration, epoch: res.headers.get("x-master-data-epoch") ?? "unbound" });
    return data.items;
  })();
  apiListInFlight = { generation: cacheGeneration, promise };
  try {
    return await promise;
  } finally {
    if (apiListInFlight?.promise === promise) apiListInFlight = null;
  }
}

let apiListInFlight: { generation: number; promise: Promise<ApiProfile[]> } | null = null;
const profileReadEpochs = new WeakMap<ApiProfile[], { generation: number; epoch: string }>();
let adoptedProfileWriteEpoch = "unbound";
let adoptedProfileEpochGeneration = -1;

/**
 * Read a fresh profile snapshot for exports. Unlike reconciliation this does
 * not adopt anything into local/offline storage; export must describe the
 * server-acknowledged profile state, not a possibly stale browser cache.
 */
export async function fetchBrandProfilesSnapshot(): Promise<ServerBrandProfileSnapshot[]> {
  const res = await fetchWithTimeout(
    "/api/brand-profiles",
    {
      headers: { "x-client-id": inventoryClientId() },
      cache: "no-store",
    },
    10_000,
  );
  if (!res.ok) throw new Error(`List brand profiles failed (${res.status})`);
  const data = (await res.json()) as { items?: unknown };
  if (!Array.isArray(data?.items)) {
    throw new Error("List brand profiles returned an invalid response");
  }
  const items = data.items;
  if (items.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const profile = item as Record<string, unknown>;
    return typeof profile.key !== "string"
      || typeof profile.brand !== "string"
      || typeof profile.flavor !== "string"
      || !profile.values || typeof profile.values !== "object" || Array.isArray(profile.values)
      || !profile.crustValues || typeof profile.crustValues !== "object" || Array.isArray(profile.crustValues)
      || typeof profile.updatedAt !== "number" || !Number.isFinite(profile.updatedAt);
  })) {
    throw new Error("List brand profiles returned an invalid profile");
  }
  return items as ServerBrandProfileSnapshot[];
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

/**
 * POST the items; returns the server's stored stamp per key (from the full
 * list the save endpoint echoes back). Needed after FORCED saves, where the
 * server advances the stored stamp past the previous row's — the client must
 * adopt that authoritative stamp or its next plain edit is stamped below it
 * and silently rejected by LWW.
 */
/**
 * Thrown when the server rejects a profile write with 403. The operation stays
 * queued: an explicit import must visibly fail instead of claiming a profile
 * repair persisted when it did not, and a later role/session refresh may make
 * the write valid.
 */
class ProfileWriteForbiddenError extends Error {
  constructor(kind: string) {
    super(`${kind} brand profiles forbidden (403)`);
  }
}

async function apiSave(items: ApiProfile[], undoEpoch: string): Promise<Map<string, number>> {
  const generation = getProfileCacheGeneration();
  const serverStamps = new Map<string, number>();
  for (const part of chunk(items, SERVER_MAX_BATCH)) {
    if (generation !== getProfileCacheGeneration()) throw new Error("Profile identity changed");
    const res = await fetchWithTimeout(
      "/api/brand-profiles",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": inventoryClientId(),
          ...masterDataEpochHeaders("brand-profiles", undoEpoch),
        },
        body: JSON.stringify({ items: part }),
      },
      10_000,
    );
    if (res.status === 403) throw new ProfileWriteForbiddenError("Save");
    if (!res.ok) throw new Error(`Save brand profiles failed (${res.status})`);
    let data: { items?: ApiProfile[] };
    try {
      data = (await res.json()) as { items?: ApiProfile[] };
    } catch {
      throw new Error("Save brand profiles was not acknowledged by the server");
    }
    if (!data || !Array.isArray(data.items)) {
      throw new Error("Save brand profiles was not acknowledged by the server");
    }
    const canonicalByKey = new Map(data.items.map((item) => [item?.key, item]));
    for (const item of data.items) {
      if (item && typeof item.key === "string" && typeof item.updatedAt === "number") {
        serverStamps.set(item.key, item.updatedAt);
      }
    }
    // The endpoint's response is the acknowledgement boundary. A stamp/key
    // echo alone is not enough: a stamp-guarded server may have kept an older
    // canonical row while still returning HTTP 200 and the full profile list.
    // Treat that as a conflict so explicit saves stay visible and queued.
    for (const submitted of part) {
      const canonical = canonicalByKey.get(submitted.key);
      if (
        !canonical
        || typeof canonical.updatedAt !== "number"
        || !profileValuesMatch(submitted, canonical)
      ) {
        throw new Error(
          `Save brand profile "${submitted.key}" was not acknowledged by the server; canonical values differ, retry the save`,
        );
      }
    }
  }
  return serverStamps;
}

async function apiDelete(keys: string[], undoEpoch: string): Promise<void> {
  const generation = getProfileCacheGeneration();
  for (const part of chunk(keys, SERVER_MAX_BATCH)) {
    if (generation !== getProfileCacheGeneration()) throw new Error("Profile identity changed");
    const res = await fetchWithTimeout(
      "/api/brand-profiles",
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": inventoryClientId(),
          ...masterDataEpochHeaders("brand-profiles", undoEpoch),
        },
        body: JSON.stringify({ keys: part }),
      },
      10_000,
    );
    if (res.status === 403) throw new ProfileWriteForbiddenError("Delete");
    if (!res.ok) throw new Error(`Delete brand profiles failed (${res.status})`);
  }
}

let flushInFlight: Promise<void> | null = null;
let flushAgain = false;
let lastFlushError: unknown = null;

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
      lastFlushError = null;
    } catch (err) {
      lastFlushError = err;
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

export function hasPendingProfileWrite(key: string): boolean {
  return readQueue().some((op) => op.t === "up" && op.key === key);
}
export const pendingProfileWriteCount = () => profileCacheIsActive() ? readQueue().length : 0;

/**
 * Explicit-save acknowledgement boundary. Unlike ordinary background saves,
 * this rejects unless every pending profile write completed with a valid server
 * echo containing the submitted values. The queue is intentionally retained on
 * failure so the same manager edit can be retried.
 */
export async function flushProfileQueueStrict(): Promise<void> {
  // A background kick can enqueue a follow-up flush while the flight we just
  // awaited is finishing. Awaiting only that first promise can therefore
  // observe the queue in the small window between its completion and the
  // follow-up kick, making a healthy import report a misleading pending-save
  // error. Keep draining until the coalesced work has settled.
  const MAX_STRICT_FLUSH_ROUNDS = 3;
  for (let round = 0; ; round++) {
    if (round >= MAX_STRICT_FLUSH_ROUNDS) {
      // A background reconciliation can keep re-enqueuing work while an
      // acknowledged recipe save is waiting. Leave that work queued for the
      // ordinary retry path rather than holding the recipe editor forever.
      throw new Error("Profile write queue did not settle");
    }
    const queueBefore = JSON.stringify(readQueue());
    await flushProfileQueue();
    if (lastFlushError) throw lastFlushError;
    if (flushInFlight || flushAgain) continue;
    const queueAfter = JSON.stringify(readQueue());
    if (queueAfter === "[]") return;
    // A profile-cache identity handoff can temporarily make the queue
    // ineligible for a flush. The ordinary background retry will try again
    // once the cache is current, but an explicit recipe acknowledgement must
    // not spin forever waiting for that retry.
    if (queueAfter === queueBefore) {
      throw new Error("Profile write queue made no progress");
    }
  }
}

async function flushOnce(): Promise<void> {
  if (!profileCacheIsActive()) return;
  const cacheGeneration = getProfileCacheGeneration();
  const ops = readQueue();
  if (ops.length === 0) return;
  if (profileCacheIsActive() && !profileCacheGenerationIsCurrent(cacheGeneration)) return;

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
    // Old key-only operations cannot acquire a new payload from a later read.
    // Preserve them for review rather than inventing or silently dropping work.
    if (profileCacheIsActive() && (!op.blobs || !Number.isFinite(op.updatedAt))) continue;
    const { dough, crust } = op.blobs ?? readProfileBlobs(op.key);
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
      updatedAt: op.updatedAt ?? stamps[op.key] ?? 1,
      ...(op.force ? { force: true } : {}),
    });
    upsertKeys.push(op.key);
  }

  let doneKeys: string[] = [...dropKeys];

  if (upserts.length > 0) {
    let serverStamps: Map<string, number> | null = null;
    try {
      const epochs = new Set(ops.map((op) => op.undoEpoch ?? "unbound"));
      if (epochs.size !== 1) throw new Error("Pending profiles cross a shared Undo boundary. Review the pending edits; none were sent.");
      serverStamps = await apiSave(upserts, ops[0]!.undoEpoch ?? "unbound");
      if (cacheGeneration !== getProfileCacheGeneration()) return;
    } catch (err) {
      // Includes 403: keeping the operation is the only safe outcome. A
      // background retry is harmless, while dropping it makes an authoritative
      // import correction silently local-only forever.
      throw err;
    }
    if (serverStamps) {
    const synced = readMap(SYNCED_KEY);
    const localStamps = readMap(STAMPS_KEY);
    // Keys re-enqueued while the round-trip was in flight (newer edit or a
    // forced apply): their pending push must outrank whatever just landed.
    // The sent ops themselves are still queued at this point (removed below),
    // so only count queue entries whose generation differs from what was sent.
    const pendingKeys = new Set(
      readQueue()
        .filter((op) => {
          const sent = ops.find((o) => o.key === op.key);
          return !sent || sent.t !== op.t || sent.g !== op.g;
        })
        .map((o) => o.key),
    );
    let localStampsChanged = false;
    for (const item of upserts) {
      let stamp = item.updatedAt;
      if (item.force) {
        // The server advanced the stored stamp past the previous row's; adopt
        // it, or the next plain edit here is stamped below the row we just
        // wrote and gets silently ignored by LWW until a reconcile pass.
        const s = serverStamps.get(item.key);
        if (typeof s === "number" && s > stamp) {
          stamp = s;
          // An edit queued during the flight must still win: seed its next
          // push one past the authoritative stamp.
          const floor = pendingKeys.has(item.key) ? s + 1 : s;
          if ((localStamps[item.key] ?? 0) < floor) {
            localStamps[item.key] = floor;
            localStampsChanged = true;
          }
        }
      }
      synced[item.key] = stamp;
    }
    if (localStampsChanged) {
      writeMap(STAMPS_KEY, localStamps);
      writeQueue(readQueue().map((op) => pendingKeys.has(op.key) && op.t === "up"
        ? { ...op, updatedAt: Math.max(op.updatedAt ?? 0, localStamps[op.key] ?? 0) }
        : op));
    }
    writeMap(SYNCED_KEY, synced);
    doneKeys = doneKeys.concat(upsertKeys);
    }
  }

  if (deleteKeys.length > 0) {
    let deleted = true;
    try {
      const epochs = new Set(ops.map((op) => op.undoEpoch ?? "unbound"));
      if (epochs.size !== 1) throw new Error("Pending profiles cross a shared Undo boundary. Review the pending edits; none were sent.");
      await apiDelete(deleteKeys, ops[0]!.undoEpoch ?? "unbound");
      if (cacheGeneration !== getProfileCacheGeneration()) return;
    } catch (err) {
      throw err;
    }
    if (deleted) {
      const synced = readMap(SYNCED_KEY);
      for (const key of deleteKeys) delete synced[key];
      writeMap(SYNCED_KEY, synced);
    }
    if (deleted) doneKeys = doneKeys.concat(deleteKeys);
  }

  // Remove completed ops — but ONLY the exact ops that were sent (matched by
  // generation). An op re-enqueued while the round-trip was in flight (a
  // newer edit, or a forced apply replacing a plain in-flight save) has a new
  // generation and MUST survive, or an authoritative write could be marked
  // done without ever being sent.
  const done = new Set(doneKeys);
  const current = readQueue();
  const remaining = current.filter((op) => {
    if (!done.has(op.key)) return true;
    const sent = ops.find((o) => o.key === op.key);
    return !sent || sent.t !== op.t || sent.g !== op.g;
  });
  if (remaining.length !== current.length) writeQueue(remaining);
}

/** Every canonical profile key that exists in the local cache (dough or crust blob). */
function localProfileKeys(): string[] {
  if (profileCacheIsActive()) return cachedProfileKeys();
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
  // Migration is read reconciliation only. Owned legacy queued payloads are
  // upgraded by setProfileCacheIdentity; unowned snapshots are review evidence.
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
export type ProfileReconcileResult = {
  changed: boolean;
  adoptedKeys: string[];
  deletedKeys: string[];
  deletedSnapshots: Record<string, { dough: string; crust: string }>;
};

/**
 * Detailed reconciliation result for foreground recovery consumers. The legacy
 * boolean wrapper below is intentionally kept for existing boot/poll callers.
 */
export async function reconcileProfilesFromServerDetailed(): Promise<ProfileReconcileResult> {
  if (!profileCacheIsActive()) {
    return { changed: false, adoptedKeys: [], deletedKeys: [], deletedSnapshots: {} };
  }
  const cacheGeneration = getProfileCacheGeneration();
  migrateLocalProfilesToServerIfNeeded();
  const pendingAtRead = readQueue().map((op) => op.key);
  const stampsAtRead = readMap(STAMPS_KEY);

  let serverItems: ApiProfile[];
  try {
    serverItems = await apiList();
  } catch {
    // Offline / signed-out — retry queued pushes anyway and bail quietly.
    void flushProfileQueue();
    if (profileCacheGenerationIsCurrent(cacheGeneration)) setProfileReadStatus("unavailable");
    return { changed: false, adoptedKeys: [], deletedKeys: [], deletedSnapshots: {} };
  }
  if (cacheGeneration !== getProfileCacheGeneration()) {
    return { changed: false, adoptedKeys: [], deletedKeys: [], deletedSnapshots: {} };
  }

  let changed = false;
  const adoptedKeys: string[] = [];
  const deletedKeys: string[] = [];
  const deletedSnapshots: Record<string, { dough: string; crust: string }> = {};
  const stamps = readMap(STAMPS_KEY);
  const synced = readMap(SYNCED_KEY);
  const serverByKey = new Map(serverItems.map((it) => [it.key, it]));
  const pending = new Set([...pendingAtRead, ...readQueue().map((op) => op.key)]);
  for (const key of new Set([...Object.keys(stamps), ...Object.keys(stampsAtRead)])) {
    if (stamps[key] !== stampsAtRead[key]) pending.add(key);
  }
  const nextCache = new Map(
    localProfileKeys().map((key) => [key, readProfileBlobs(key)] as const),
  );

  for (const item of serverItems) {
    if (!item.key || item.key === "__") continue;
    if (pending.has(item.key)) continue;
    // A scoped cache with no value must always adopt the authenticated server
    // row. Legacy/global stamps are bookkeeping only and must never make an
    // empty new identity look newer than its canonical facility data.
    const localStamp = nextCache.has(item.key) ? (stamps[item.key] ?? 0) : 0;
    if (profileCacheIsActive() || item.updatedAt > localStamp) {
      try {
        if (!profileCacheIsActive()) {
          localStorage.setItem(doughStorageKey(item.key), JSON.stringify(item.values ?? {}));
          localStorage.setItem(
            crustStorageKey(item.key),
            JSON.stringify(item.crustValues ?? {}),
          );
        }
        nextCache.set(item.key, {
          dough: JSON.stringify(item.values ?? {}),
          crust: JSON.stringify(item.crustValues ?? {}),
        });
        stamps[item.key] = item.updatedAt;
        synced[item.key] = item.updatedAt;
        changed = true;
        adoptedKeys.push(item.key);
        // Seed the fast-access :subtab key from the embedded _subTab field so
        // loadProfileSubTab() can return the correct mode without parsing the
        // full profile blob on every call. This is the mechanism that propagates
        // a manager's Dough/Crust toggle to all other tablets.
        const subTab = (item.values as Record<string, unknown> | undefined)?._subTab;
        if (!profileCacheIsActive() && (subTab === "dough" || subTab === "crusts")) {
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
        const { dough, crust } = readProfileBlobs(key);
        if (dough !== null || crust !== null) {
          deletedSnapshots[key] = { dough: dough ?? "{}", crust: crust ?? "{}" };
        }
        if (!profileCacheIsActive()) {
          localStorage.removeItem(doughStorageKey(key));
          localStorage.removeItem(crustStorageKey(key));
          localStorage.removeItem(key + ":subtab");
        }
        nextCache.delete(key);
        delete stamps[key];
        delete synced[key];
        changed = true;
        deletedKeys.push(key);
      } catch {}
    } else {
      // Local-only profile the server has never seen (offline creation, or a
      // blob written after migration ran) — push it up.
      if (!profileCacheIsActive()) enqueue({ t: "up", key });
    }
  }

  writeMap(STAMPS_KEY, stamps);
  writeMap(SYNCED_KEY, synced);
  if (profileCacheIsActive() && !replaceCachedProfiles(nextCache, cacheGeneration)) {
    return { changed: false, adoptedKeys: [], deletedKeys: [], deletedSnapshots: {} };
  }
  if (profileCacheIsActive()) {
    reconcileLegacyProfileReads(new Map(serverItems.map((item) => [item.key, {
      dough: JSON.stringify(item.values), crust: JSON.stringify(item.crustValues),
    }])));
    setProfileReadStatus("ready");
  }

  // One-time: inject legacy :subtab preferences into dough profile blobs so
  // the server pool carries them to fresh tablets. Runs here — after server
  // items are already merged into localStorage — so the check never races
  // against a newer server _subTab value.
  if (!profileCacheIsActive()) injectSubTabIntoProfileBlobsIfNeeded(stamps);

  const epochReceipt = profileReadEpochs.get(serverItems);
  if (epochReceipt?.generation === getProfileCacheGeneration()) {
    adoptedProfileWriteEpoch = epochReceipt.epoch; adoptedProfileEpochGeneration = epochReceipt.generation;
  }
  void flushProfileQueue();
  return { changed, adoptedKeys, deletedKeys, deletedSnapshots };
}

export async function reconcileProfilesFromServer(): Promise<boolean> {
  return (await reconcileProfilesFromServerDetailed()).changed;
}

/** Reconnect/focus retries belong to the authenticated repository generation,
 * not to the daily-sync baseline (which may already be acknowledged). */
export function startProfileReconciliation(
  onReconciled: (result: ProfileReconcileResult) => void,
): () => void {
  if (!profileCacheIsActive()) return () => {};
  const generation = getProfileCacheGeneration();
  let cancelled = false;
  let running = false;
  const current = () => !cancelled && profileCacheGenerationIsCurrent(generation);
  const pass = async () => {
    if (!current() || running) return;
    running = true;
    try {
      await flushProfileQueue();
      if (!current()) return;
      const result = await reconcileProfilesFromServerDetailed();
      if (current()) onReconciled(result);
    } finally {
      running = false;
    }
  };
  const kick = () => { void pass().catch(() => {}); };
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  const poll = window.setInterval(kick, 30_000);
  kick();
  return () => {
    cancelled = true;
    window.removeEventListener("online", kick);
    window.removeEventListener("focus", kick);
    window.clearInterval(poll);
  };
}

/**
 * One-time migration that embeds the fast-access `<key>:subtab` preference
 * into the dough profile blob as `_subTab`, then enqueues the profile for a
 * server push. Must be called AFTER the server reconcile loop has written any
 * newer server blobs, so the local blob reflects authoritative server state
 * before we inspect it. If the blob already carries the right `_subTab` (from
 * a prior toggle or a server-adopted value), the profile is skipped and no
 * stamp is bumped. Marker-guarded: runs exactly once per device.
 */
function injectSubTabIntoProfileBlobsIfNeeded(stamps: Record<string, number>): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(SUBTAB_MIGRATION_MARKER)) return;
    // Collect :subtab keys in a first pass (avoid mutating while iterating).
    const subtabEntries: Array<{ canonicalKey: string; subTab: "dough" | "crusts" }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.endsWith(":subtab")) continue;
      const v = localStorage.getItem(k);
      if (v !== "dough" && v !== "crusts") continue;
      // The canonical key is everything before the trailing ":subtab".
      subtabEntries.push({
        canonicalKey: k.slice(0, -":subtab".length),
        subTab: v,
      });
    }
    for (const { canonicalKey, subTab } of subtabEntries) {
      try {
        const doughBlobKey = DOUGH_PREFIX + canonicalKey;
        const raw = localStorage.getItem(doughBlobKey);
        const blob: Record<string, unknown> = raw
          ? (JSON.parse(raw) as Record<string, unknown>)
          : {};
        // Skip when the blob already carries the right value — the server-
        // reconcile loop just wrote it (or a prior toggle already embedded it).
        if (blob._subTab === subTab) continue;
        blob._subTab = subTab;
        localStorage.setItem(doughBlobKey, JSON.stringify(blob));
        // Bump the stamp and enqueue so the server receives this preference.
        // Using the same monotonic logic as markProfileEdited so the upload
        // stamp is always > any previously-adopted server stamp for this key.
        stamps[canonicalKey] = Math.max(Date.now(), (stamps[canonicalKey] ?? 0) + 1);
        enqueue({ t: "up", key: canonicalKey });
      } catch {
        // Skip unreadable blobs — one bad entry must never block the rest.
      }
    }
    // Persist updated stamps so the enqueued writes carry the right values.
    writeMap(STAMPS_KEY, stamps);
    localStorage.setItem(SUBTAB_MIGRATION_MARKER, "1");
  } catch {
    // localStorage unavailable — marker left unset, retry on next successful
    // reconcile.
  }
}

/**
 * Fetch all profiles from the server and seed any that are NOT already in
 * localStorage (gap-fill only — never clobbers a local copy).  Does NOT touch
 * sync stamps or the upload queue, so this is safe to call at any time.
 *
 * Returns the complete list of { brand, flavor } pairs from the server so the
 * caller can iterate the full factory profile pool without depending on the
 * boot reconciliation having finished first.
 */
export async function seedProfilesFromServer(): Promise<{ brand: string; flavor: string }[]> {
  if (!profileCacheIsActive()) return [];
  const cacheGeneration = getProfileCacheGeneration();
  // Use the same pending-edit/deletion and generation fences as ordinary reads.
  // Never recreate an unscoped snapshot if logout happens during this request.
  const [items] = await Promise.all([apiList(), reconcileProfilesFromServerDetailed()]);
  if (!profileCacheGenerationIsCurrent(cacheGeneration)) return [];
  return items.map(i => ({ brand: i.brand, flavor: i.flavor }));
}
