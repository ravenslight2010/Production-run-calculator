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
    && SYNC_SNAPSHOT_ID_RE.test(payload.baseSnapshotId);
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