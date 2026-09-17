import type { OperationalProjection } from "@workspace/live-calc";
import {
  applySyncDeltaData,
  canonicalSyncValue,
  isSyncRecord,
  isValidSyncSnapshotId,
} from "@workspace/sync-contract";
import type { SyncPayload } from "./types";

export { isValidSyncSnapshotId };

export interface SyncWriteResponseBody<T> {
  data?: T;
  stale?: boolean;
  epoch?: number;
  unchanged?: boolean;
  snapshotId?: string;
  partialFallback?: boolean;
  operationalProjection?: OperationalProjection | null;
}

export type PartialSyncEnvelope = {
  syncVersion?: unknown;
  completeness?: unknown;
  baseSnapshotId?: unknown;
  snapshotId?: unknown;
  resultingSnapshotId?: unknown;
  data?: unknown;
};

interface ConsumeSyncWriteResponseOptions<T> {
  applyCanonical?: (data: T) => void | Promise<void>;
  onStale?: (body: SyncWriteResponseBody<T>) => void | Promise<void>;
  shouldConsume?: () => boolean;
}

export async function consumeSyncWriteResponse<T>(
  response: Response,
  options: ConsumeSyncWriteResponseOptions<T> = {},
): Promise<{ body: SyncWriteResponseBody<T> | null; stale: boolean }> {
  const parsed = await response.clone().json().catch(() => null);
  const body =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SyncWriteResponseBody<T>
      : null;
  if (options.shouldConsume && !options.shouldConsume()) {
    return { body, stale: false };
  }
  const stale = body?.stale === true;

  if (stale) {
    await options.onStale?.(body);
  } else if (response.ok && body?.data !== undefined) {
    await options.applyCanonical?.(body.data);
  }

  return { body, stale };
}

/** Removes server-owned read models that are transported beside, but not hashed into, the canonical document. */
export function persistedSyncPayload(payload: SyncPayload): SyncPayload {
  const {
    operationalProjection: _operationalProjection,
    serverTime: _serverTime,
    canonicalRevision: _canonicalRevision,
    ...persisted
  } = payload;
  return persisted as SyncPayload;
}

export async function syncPayloadSnapshotId(
  payload: SyncPayload,
  options: { stripReadModel?: boolean } = {},
): Promise<string> {
  const snapshotDocument = options.stripReadModel ? persistedSyncPayload(payload) : payload;
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalSyncValue(snapshotDocument)));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function syncPayloadMatchesSnapshot(
  payload: SyncPayload,
  snapshotId: string,
  options: { stripReadModel?: boolean } = {},
): Promise<boolean> {
  if (!isValidSyncSnapshotId(snapshotId)) return false;
  return await syncPayloadSnapshotId(payload, options) === snapshotId;
}

/**
 * Applies the deliberately narrow peer delta wire format.  A delta is never
 * merged into whatever happens to be in React state: its base must be the
 * exact canonical snapshot most recently adopted from the server.
 */
export async function reconstructPartialSyncPayload(
  base: SyncPayload | null | undefined,
  baseSnapshotId: unknown,
  envelope: PartialSyncEnvelope,
): Promise<SyncPayload | null> {
  if (!base || envelope.syncVersion !== 1 || envelope.completeness !== "partial") return null;
  if (!isValidSyncSnapshotId(baseSnapshotId) || envelope.baseSnapshotId !== baseSnapshotId) return null;
  if (!isValidSyncSnapshotId(envelope.snapshotId) || !isSyncRecord(envelope.data)) return null;
  if (
    !isValidSyncSnapshotId(envelope.resultingSnapshotId)
    || envelope.resultingSnapshotId !== envelope.snapshotId
  ) return null;
  if (!await syncPayloadMatchesSnapshot(base, baseSnapshotId)) return null;
  const merged = applySyncDeltaData(
    base as unknown as Record<string, unknown>,
    envelope.data,
  );
  if (!merged) return null;
  delete merged.completeness;
  delete merged.baseSnapshotId;
  delete merged.resultingSnapshotId;
  merged.syncVersion = 1;
  merged.completeness = "complete";
  return await syncPayloadMatchesSnapshot(merged as SyncPayload, envelope.snapshotId)
    ? merged as SyncPayload
    : null;
}

export async function readCurrentRecoveryJson(
  response: Response,
  isCurrent: () => boolean,
): Promise<{ current: boolean; body: unknown }> {
  const body = await response.json();
  return { current: isCurrent(), body };
}

export function isCanonicalRecoverySyncPayload(
  value: unknown,
  expectedDate: string,
  completeness: unknown,
): value is SyncPayload {
  if (completeness !== "complete") return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.completeness === "partial") return false;
  if (payload.syncVersion !== undefined && payload.syncVersion !== 1) return false;

  const dayState = payload.dayState;
  if (!dayState || typeof dayState !== "object" || Array.isArray(dayState)) return false;
  const day = dayState as Record<string, unknown>;
  if (day.date !== expectedDate || !Array.isArray(day.runs)) return false;
  const runIds = new Set<string>();
  if (!day.runs.every((run) => {
    if (!run || typeof run !== "object" || Array.isArray(run)) return false;
    const candidate = run as Record<string, unknown>;
    const valid = typeof candidate.id === "string"
      && candidate.id.length > 0
      && typeof candidate.brand === "string"
      && typeof candidate.flavor === "string";
    if (!valid || runIds.has(candidate.id as string)) return false;
    runIds.add(candidate.id as string);
    return true;
  })) return false;

  const runValues = payload.runValues;
  if (!runValues || typeof runValues !== "object" || Array.isArray(runValues)) return false;
  const valuesByRun = runValues as Record<string, unknown>;
  if (!Object.values(valuesByRun).every(
    (entry) => !!entry && typeof entry === "object" && !Array.isArray(entry),
  )) return false;
  const valueIds = Object.keys(valuesByRun);
  return valueIds.length === runIds.size && valueIds.every((id) => runIds.has(id));
}

export function isUnchangedSyncResponse(body: SyncWriteResponseBody<unknown> | null): boolean {
  return body?.unchanged === true
    && body.data === undefined
    && isValidSyncSnapshotId(body.snapshotId);
}