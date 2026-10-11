import { createHash } from "node:crypto";
import {
  SYNC_SNAPSHOT_ID_RE,
  buildSyncDeltaData,
  canonicalSyncJson,
  isSyncRecord,
} from "@workspace/sync-contract";

export { SYNC_SNAPSHOT_ID_RE, canonicalSyncJson };

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

/**
 * Builds the version-one peer delta. `null` is intentional: it is the wire
 * tombstone for both a removed top-level section and a removed keyed entry.
 * The result is safe to apply only to `baseSnapshotId`; callers must fall
 * back to a complete frame when that dependency is not available.
 */
export function buildSyncPeerDelta(previous: unknown, next: unknown): Record<string, unknown> | null {
  if (!isSyncRecord(previous) || !isSyncRecord(next)) return null;
  const baseSnapshotId = syncSnapshotId(previous);
  const resultingSnapshotId = syncSnapshotId(next);
  if (baseSnapshotId === resultingSnapshotId) return null;
  const delta: Record<string, unknown> = {
    syncVersion: 1,
    completeness: "partial",
    baseSnapshotId,
    resultingSnapshotId,
  };
  Object.assign(delta, buildSyncDeltaData(previous, next));
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
  options: {
    requestedSnapshotId?: unknown;
    partialFallback?: boolean;
    snapshotIdOverride?: string;
  },
): SyncWriteEnvelope<T> {
  const snapshotId = options.snapshotIdOverride
    ?? (data === null || data === undefined ? undefined : syncSnapshotId(data));
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