import { createHash } from "node:crypto";

export const SYNC_SNAPSHOT_ID_RE = /^[a-f0-9]{64}$/;

export function canonicalSyncValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSyncValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalSyncValue(child)]),
    );
  }
  return value;
}

export function canonicalSyncJson(value: unknown): string {
  return JSON.stringify(canonicalSyncValue(value));
}

/** Stable identity for a canonical sync document (object key order independent). */
export function syncSnapshotId(data: unknown): string {
  return createHash("sha256").update(canonicalSyncJson(data)).digest("hex");
}

export function emptySyncData(date: string): Record<string, unknown> {
  return {
    dayState: { date, runs: [] },
    runValues: {},
    runValuesUpdatedAt: {},
  };
}

export function isPartialSyncPayload(payload: unknown): payload is Record<string, unknown> {
  return !!payload && typeof payload === "object" && !Array.isArray(payload)
    && (payload as Record<string, unknown>).completeness === "partial";
}

export function isValidPartialSyncContract(payload: Record<string, unknown>): boolean {
  return payload.syncVersion === 1
    && typeof payload.baseSnapshotId === "string"
    && SYNC_SNAPSHOT_ID_RE.test(payload.baseSnapshotId)
    && (payload.resultingSnapshotId === undefined
      || (typeof payload.resultingSnapshotId === "string"
        && SYNC_SNAPSHOT_ID_RE.test(payload.resultingSnapshotId)));
}

const DELTA_SECTIONS = new Set(["runValues", "runValuesUpdatedAt", "packagingProgress"]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Builds the version-one peer delta. `null` is intentional: it is the wire
 * tombstone for both a removed top-level section and a removed keyed entry.
 * The result is safe to apply only to `baseSnapshotId`; callers must fall
 * back to a complete frame when that dependency is not available.
 */
export function buildSyncPeerDelta(previous: unknown, next: unknown): Record<string, unknown> | null {
  if (!isObject(previous) || !isObject(next)) return null;
  const baseSnapshotId = syncSnapshotId(previous);
  const resultingSnapshotId = syncSnapshotId(next);
  if (baseSnapshotId === resultingSnapshotId) return null;
  const delta: Record<string, unknown> = {
    syncVersion: 1,
    completeness: "partial",
    baseSnapshotId,
    resultingSnapshotId,
  };
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === "syncVersion" || key === "completeness" || key === "baseSnapshotId" || key === "resultingSnapshotId") continue;
    const before = previous[key];
    const after = next[key];
    if (canonicalSyncJson(before) === canonicalSyncJson(after)) continue;
    if (DELTA_SECTIONS.has(key) && isObject(before) && isObject(after)) {
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

export function syncWireBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

export type SyncWriteEnvelope<T> =
  | { ok: true; stale: true; epoch: number }
  | { ok: true; unchanged: true; snapshotId: string }
  | { ok: true; data: T; snapshotId?: string; partialFallback?: true };

export function buildSyncWriteEnvelope<T>(
  data: T,
  options: { requestedSnapshotId?: unknown; partialFallback?: boolean },
): SyncWriteEnvelope<T> {
  const snapshotId = data === null || data === undefined ? undefined : syncSnapshotId(data);
  if (!options.partialFallback && snapshotId && options.requestedSnapshotId === snapshotId) {
    return { ok: true, unchanged: true, snapshotId };
  }
  return {
    ok: true,
    data,
    ...(snapshotId ? { snapshotId } : {}),
    ...(options.partialFallback ? { partialFallback: true as const } : {}),
  };
}