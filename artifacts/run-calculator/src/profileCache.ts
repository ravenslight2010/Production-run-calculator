import { browserStorage } from "./adapters/browserRecordStore";

const LEGACY_DOUGH_PREFIX = "run-calc-profile-";
const LEGACY_CRUST_PREFIX = "run-calc-crust-profile-";
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

function persist(): void {
  const key = scopedStorageKey();
  if (!key) return;
  try {
    browserStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function importLegacyProfilesOnce(nextIdentityKey: string): Map<string, CachedProfileBlobs> {
  try {
    const owner = browserStorage.getItem(LEGACY_MIGRATION_OWNER_KEY);
    if (owner && owner !== nextIdentityKey) return new Map();
    const imported = new Map<string, CachedProfileBlobs>();
    for (let index = 0; index < browserStorage.length; index++) {
      const storageKey = browserStorage.key(index);
      if (!storageKey) continue;
      let key = "";
      let field: keyof CachedProfileBlobs | null = null;
      if (storageKey.startsWith(LEGACY_CRUST_PREFIX)) {
        key = storageKey.slice(LEGACY_CRUST_PREFIX.length);
        field = "crust";
      } else if (storageKey.startsWith(LEGACY_DOUGH_PREFIX)) {
        key = storageKey.slice(LEGACY_DOUGH_PREFIX.length);
        field = "dough";
      }
      if (!field || !isProfileKey(key)) continue;
      const raw = browserStorage.getItem(storageKey);
      if (raw === null) continue;
      const current = imported.get(key) ?? { dough: null, crust: null };
      imported.set(key, { ...current, [field]: raw });
    }
    // Fold the old unscoped fast-access preference into the canonical dough
    // blob before retiring those keys.
    for (const [key, blobs] of imported) {
      const subTab = browserStorage.getItem(`${key}:subtab`);
      if ((subTab !== "dough" && subTab !== "crusts") || blobs.dough === null) continue;
      try {
        const dough = JSON.parse(blobs.dough) as Record<string, unknown>;
        dough._subTab = subTab;
        imported.set(key, { ...blobs, dough: JSON.stringify(dough) });
      } catch {}
    }
    browserStorage.setItem(LEGACY_MIGRATION_OWNER_KEY, nextIdentityKey);
    return imported;
  } catch {
    return new Map();
  }
}

export function setProfileCacheIdentity(identity: ProfileCacheIdentity | null): void {
  const nextIdentityKey = identity ? makeIdentityKey(identity) : null;
  if (nextIdentityKey === identityKey) return;
  identityKey = nextIdentityKey;
  generation += 1;
  if (!nextIdentityKey) {
    entries = new Map();
    notify();
    return;
  }
  const persistedRaw = browserStorage.getItem(`${SCOPED_CACHE_PREFIX}${nextIdentityKey}`);
  entries = parsePersisted(persistedRaw);
  if (persistedRaw === null) {
    entries = importLegacyProfilesOnce(nextIdentityKey);
    persist();
    // Legacy profile blobs are an import source, never a live mirror. Removing
    // them prevents later identities and forgotten prefix scans from observing
    // the first authenticated user's data.
    for (let index = browserStorage.length - 1; index >= 0; index--) {
      const key = browserStorage.key(index);
      if (!key) continue;
      const legacyDoughKey = key.startsWith(LEGACY_DOUGH_PREFIX)
        ? key.slice(LEGACY_DOUGH_PREFIX.length)
        : "";
      const legacyCrustKey = key.startsWith(LEGACY_CRUST_PREFIX)
        ? key.slice(LEGACY_CRUST_PREFIX.length)
        : "";
      const legacySubTabKey = key.endsWith(":subtab")
        ? key.slice(0, -":subtab".length)
        : "";
      if (
        isProfileKey(legacyDoughKey) ||
        isProfileKey(legacyCrustKey) ||
        isProfileKey(legacySubTabKey)
      ) {
        browserStorage.removeItem(key);
      }
    }
  }
  notify();
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
  persist();
  notify();
}

export function deleteCachedProfile(key: string): void {
  if (!identityKey || !entries.delete(key)) return;
  persist();
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
  persist();
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
  listeners.clear();
}