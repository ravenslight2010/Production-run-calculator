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

export async function syncPayloadSnapshotId(
  payload: SyncPayload,
  options: { stripReadModel?: boolean } = {},
): Promise<string> {
  const snapshotDocument = options.stripReadModel
    ? (() => {
        const {
          operationalProjection: _operationalProjection,
          serverTime: _serverTime,
          canonicalRevision: _canonicalRevision,
          ...persisted
        } = payload;
        return persisted;
      })()
    : payload;
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