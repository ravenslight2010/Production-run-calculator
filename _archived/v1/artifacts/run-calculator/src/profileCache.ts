import { browserStorage } from "./adapters/browserRecordStore";
import { stableRecordJson } from "./sharedRecordMigration";

const LEGACY_MIGRATION_OWNER_KEY = "run-calc-profile-cache-legacy-owner-v1";
const SCOPED_CACHE_PREFIX = "run-calc-profile-cache-v1:";

export type ProfileCacheIdentity = {
  userId: string;
  scope: "live" | "sandbox";
  /**
   * Authentication currently binds every request to one facility. Keep the
   * facility dimension explicit so adding a facility selector cannot silently
   * broaden this cache's lifetime.
   */
  facilityId?: string;
};

export type CachedProfileBlobs = {
  dough: string | null;
  crust: string | null;
};

type PersistedProfileCache = Record<string, CachedProfileBlobs>;
type ProfileCacheListener = () => void;

let identityKey: string | null = null;
let generation = 0;
let version = 0;
let entries = new Map<string, CachedProfileBlobs>();
const listeners = new Set<ProfileCacheListener>();
let notificationsSuppressed = false;

function makeIdentityKey(identity: ProfileCacheIdentity): string {
  return [
    identity.scope,
    identity.facilityId?.trim() || "authenticated-facility",
    identity.userId.trim(),
  ].join(":");
}

function scopedStorageKey(): string | null {
  return identityKey ? `${SCOPED_CACHE_PREFIX}${identityKey}` : null;
}

function isProfileKey(key: string): boolean {
  return key.includes("__") && key !== "__";
}

function parsePersisted(raw: string | null): Map<string, CachedProfileBlobs> {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as PersistedProfileCache;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (!isProfileKey(key) || !value || typeof value !== "object") return [];
        const dough = typeof value.dough === "string" ? value.dough : null;
        const crust = typeof value.crust === "string" ? value.crust : null;
        return dough === null && crust === null ? [] : [[key, { dough, crust }] as const];
      }),
    );
  } catch {
    return new Map();
  }
}

export type ProfileReadStatus = "loading" | "ready" | "unavailable";
let readStatus: ProfileReadStatus = "loading";
export function profileReadStatus(): ProfileReadStatus { return readStatus; }
export function setProfileReadStatus(next: ProfileReadStatus): void {
  readStatus = next;
  notify();
}

function notify(): void {
  if (notificationsSuppressed) return;
  version += 1;
  for (const listener of listeners) listener();
}
export const notifyProfileRecoveryChanged = notify;

export function withProfileCacheProjection<T>(run: () => T): T {
  const savedEntries = entries;
  const savedVersion = version;
  const savedSuppression = notificationsSuppressed;
  entries = new Map(
    [...savedEntries].map(([key, value]) => [key, { ...value }]),
  );
  notificationsSuppressed = true;
  try {
    return run();
  } finally {
    entries = savedEntries;
    version = savedVersion;
    notificationsSuppressed = savedSuppression;
  }
}

export function setProfileCacheIdentity(identity: ProfileCacheIdentity | null): void {
  const nextIdentityKey = identity ? makeIdentityKey(identity) : null;
  if (nextIdentityKey === identityKey) return;
  identityKey = nextIdentityKey;
  generation += 1;
  readStatus = "loading";
  if (!nextIdentityKey) {
    entries = new Map();
    notify();
    return;
  }
  entries = new Map();
  // Only explicit, self-contained unsent work may recover on a cold load.
  try {
    const pendingKey = `run-calc-profilesync-queue-v1:${nextIdentityKey}`;
    const pending = JSON.parse(browserStorage.getItem(
      pendingKey,
    ) ?? "[]");
    // Previously scoped key-only operations have trustworthy account ownership.
    // Capture their original payload before retiring any read copy. A partial
    // migration is harmless: the source bytes remain until canonical equality.
    const oldReads = parsePersisted(browserStorage.getItem(`${SCOPED_CACHE_PREFIX}${nextIdentityKey}`));
    const stamps = JSON.parse(browserStorage.getItem(
      `run-calc-profilesync-stamps-v1:${nextIdentityKey}`,
    ) ?? "{}");
    if (Array.isArray(pending)) {
      let upgraded = false;
      for (const op of pending) {
        if (op?.t !== "up" || op.blobs || !oldReads.has(op.key)) continue;
        const stamp = stamps?.[op.key];
        if (typeof stamp !== "number" || !Number.isFinite(stamp)) continue;
        op.blobs = oldReads.get(op.key); op.updatedAt = stamp; upgraded = true;
      }
      if (upgraded) {
        const serialized = JSON.stringify(pending);
        browserStorage.setItem(pendingKey, serialized);
        if (browserStorage.getItem(pendingKey) !== serialized) { notify(); return; }
      }
    }
    if (Array.isArray(pending)) for (const op of pending) {
      if (op?.t !== "up" || !isProfileKey(op.key) || !op.blobs
        || typeof op.updatedAt !== "number") continue;
      const restored = parsePersisted(JSON.stringify({ [op.key]: op.blobs }));
      const blobs = restored.get(op.key);
      if (blobs) entries.set(op.key, blobs);
    }
  } catch {}
  notify();
}

/** Remove only byte-equivalent acknowledged legacy reads. Interrupted passes
 * resume by comparing again; differing/unknown-owner evidence is untouched. */
export function reconcileLegacyProfileReads(
  canonical: ReadonlyMap<string, CachedProfileBlobs>,
): void {
  const key = scopedStorageKey();
  if (!key) return;
  const raw = browserStorage.getItem(key);
  const legacy = parsePersisted(raw);
  let preserved: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) preserved = parsed as Record<string, unknown>;
  } catch {}
  for (const [id, blobs] of legacy) {
    const remote = canonical.get(id);
    if (!remote) continue;
    try {
      if (stableRecordJson(JSON.parse(blobs.dough ?? "{}")) === stableRecordJson(JSON.parse(remote.dough ?? "{}"))
        && stableRecordJson(JSON.parse(blobs.crust ?? "{}")) === stableRecordJson(JSON.parse(remote.crust ?? "{}"))) {
        legacy.delete(id);
        if (preserved) delete preserved[id];
      }
    } catch {}
  }
  if (preserved && Object.keys(preserved).length === 0) {
    browserStorage.removeItem(key);
  } else if (preserved && legacy.size < parsePersisted(raw).size) {
    browserStorage.setItem(key, JSON.stringify(preserved));
  }
  const owner = browserStorage.getItem(LEGACY_MIGRATION_OWNER_KEY);
  if (owner && owner !== identityKey) return;
  for (const [id, remote] of canonical) {
    for (const [prefix, field] of [
      ["run-calc-profile-", "dough"], ["run-calc-crust-profile-", "crust"],
    ] as const) {
      const legacyKey = `${prefix}${id}`;
      const original = browserStorage.getItem(legacyKey);
      if (original === null || remote[field] === null) continue;
      try {
        if (stableRecordJson(JSON.parse(original)) === stableRecordJson(JSON.parse(remote[field]!))) {
          browserStorage.removeItem(legacyKey);
        }
      } catch {}
    }
  }
}

export function getProfileCacheGeneration(): number {
  return generation;
}

export function profileCacheGenerationIsCurrent(candidate: number): boolean {
  return identityKey !== null && candidate === generation;
}

export function profileCacheIsActive(): boolean {
  return identityKey !== null;
}

export function scopeProfileCacheStorageKey(key: string): string {
  return identityKey ? `${key}:${identityKey}` : key;
}

export function activeProfileCacheOwnsLegacyData(): boolean {
  return identityKey !== null
    && browserStorage.getItem(LEGACY_MIGRATION_OWNER_KEY) === identityKey;
}

export function readCachedProfileBlobs(key: string): CachedProfileBlobs {
  const value = entries.get(key);
  return value ? { ...value } : { dough: null, crust: null };
}

export function cachedProfileKeys(): string[] {
  return [...entries.keys()];
}

export function writeCachedProfileBlobs(
  key: string,
  patch: Partial<CachedProfileBlobs>,
): void {
  if (!identityKey || !isProfileKey(key)) return;
  const current = entries.get(key) ?? { dough: null, crust: null };
  const next = { ...current, ...patch };
  if (current.dough === next.dough && current.crust === next.crust) return;
  if (next.dough === null && next.crust === null) entries.delete(key);
  else entries.set(key, next);
  notify();
}

export function deleteCachedProfile(key: string): void {
  if (!identityKey || !entries.delete(key)) return;
  notify();
}

export function replaceCachedProfiles(
  next: ReadonlyMap<string, CachedProfileBlobs>,
  expectedGeneration: number,
): boolean {
  if (!profileCacheGenerationIsCurrent(expectedGeneration)) return false;
  const replacement = new Map(
    [...next.entries()].map(([key, value]) => [key, { ...value }]),
  );
  const unchanged =
    replacement.size === entries.size &&
    [...replacement].every(([key, value]) => {
      const current = entries.get(key);
      return current?.dough === value.dough && current?.crust === value.crust;
    });
  if (unchanged) return true;
  entries = replacement;
  notify();
  return true;
}

export function subscribeProfileCache(listener: ProfileCacheListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProfileCacheVersion(): number {
  return version;
}

export function resetProfileCacheForTests(): void {
  identityKey = null;
  generation += 1;
  version += 1;
  entries = new Map();
  readStatus = "loading";
  listeners.clear();
}