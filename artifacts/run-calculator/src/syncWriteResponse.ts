import type { OperationalProjection } from "@workspace/live-calc";
import type { SyncPayload } from "./types";

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

/** Snapshot identities are server-produced SHA-256 digests. */
export function isValidSyncSnapshotId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function canonicalSyncValue(value: unknown): unknown {
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
  if (!isValidSyncSnapshotId(envelope.snapshotId) || !envelope.data
    || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return null;
  if (
    !isValidSyncSnapshotId(envelope.resultingSnapshotId)
    || envelope.resultingSnapshotId !== envelope.snapshotId
  ) return null;
  if (!await syncPayloadMatchesSnapshot(base, baseSnapshotId)) return null;
  const delta = envelope.data as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(delta)) {
    if (key === "runValues" || key === "runValuesUpdatedAt" || key === "packagingProgress") {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const section = {
        ...((base as unknown as Record<string, unknown>)[key] as Record<string, unknown> ?? {}),
      };
      for (const [child, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (childValue === null) delete section[child];
        else section[child] = childValue;
      }
      merged[key] = section;
    } else if (key === "dayState" && value && typeof value === "object" && !Array.isArray(value)) {
      // dayState is a replacement section. This preserves removals within the
      // object without introducing nested patch semantics.
      merged.dayState = value;
    } else if (key !== "deletions") {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
  }
  // Deletions are explicit and scoped to map sections; omission never means
  // deletion. This is compatible with the server's sparse map merge.
  if (delta.deletions && typeof delta.deletions === "object" && !Array.isArray(delta.deletions)) {
    for (const [section, ids] of Object.entries(delta.deletions as Record<string, unknown>)) {
      const target = merged[section];
      if (!target || typeof target !== "object" || Array.isArray(target) || !Array.isArray(ids)) continue;
      const copy = { ...(target as Record<string, unknown>) };
      for (const id of ids) if (typeof id === "string") delete copy[id];
      merged[section] = copy;
    }
  }
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