export const SYNC_SNAPSHOT_ID_RE = /^[a-f0-9]{64}$/;

export const SYNC_DELTA_MAP_SECTIONS = [
  "runValues",
  "runValuesUpdatedAt",
  "packagingProgress",
] as const;

const SYNC_DELTA_METADATA_KEYS = new Set([
  "syncVersion",
  "completeness",
  "baseSnapshotId",
  "resultingSnapshotId",
]);
const SYNC_DELTA_MAP_SECTION_SET = new Set<string>(SYNC_DELTA_MAP_SECTIONS);

export function isSyncRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function canonicalSyncValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSyncValue);
  if (isSyncRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalSyncValue(child)]),
    );
  }
  return value;
}

export function canonicalSyncJson(value: unknown): string {
  return JSON.stringify(canonicalSyncValue(value));
}

export function isValidSyncSnapshotId(value: unknown): value is string {
  return typeof value === "string" && SYNC_SNAPSHOT_ID_RE.test(value);
}

export function buildSyncDeltaData(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (SYNC_DELTA_METADATA_KEYS.has(key)) continue;
    const before = previous[key];
    const after = next[key];
    if (canonicalSyncJson(before) === canonicalSyncJson(after)) continue;
    if (SYNC_DELTA_MAP_SECTION_SET.has(key) && isSyncRecord(before) && isSyncRecord(after)) {
      const sparse: Record<string, unknown> = {};
      const childKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const child of childKeys) {
        if (canonicalSyncJson(before[child]) !== canonicalSyncJson(after[child])) {
          sparse[child] = child in after ? after[child] : null;
        }
      }
      delta[key] = sparse;
    } else {
      delta[key] = key in next ? after : null;
    }
  }
  return delta;
}

export function applySyncDeltaData(
  base: Record<string, unknown>,
  delta: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    if (SYNC_DELTA_MAP_SECTION_SET.has(key)) {
      if (!isSyncRecord(value)) return null;
      const baseSection = base[key];
      const section = { ...(isSyncRecord(baseSection) ? baseSection : {}) };
      for (const [child, childValue] of Object.entries(value)) {
        if (childValue === null) delete section[child];
        else section[child] = childValue;
      }
      merged[key] = section;
    } else if (key === "dayState" && isSyncRecord(value)) {
      merged.dayState = value;
    } else if (key !== "deletions") {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
  }

  if (isSyncRecord(delta.deletions)) {
    for (const [sectionName, ids] of Object.entries(delta.deletions)) {
      const target = merged[sectionName];
      if (!isSyncRecord(target) || !Array.isArray(ids)) continue;
      const copy = { ...target };
      for (const id of ids) if (typeof id === "string") delete copy[id];
      merged[sectionName] = copy;
    }
  }
  return merged;
}