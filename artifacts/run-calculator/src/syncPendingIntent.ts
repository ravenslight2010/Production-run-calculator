import { browserRecordStore } from "./adapters/browserRecordStore";
import type { SyncPayload } from "./types";

export type PendingSyncIntent = {
  version: 1;
  id: string;
  scope: string;
  date: string;
  epoch: number;
  baseSnapshotId: string;
  baseline: SyncPayload;
  payload: SyncPayload;
};

const MAX_PENDING_RECORD_CHARS = 2_500_000;

function recordKey(scope: string, date: string): string {
  return `run-calculator:sync-pending-v1:${encodeURIComponent(scope)}:${date}`;
}

function isSyncPayload(value: unknown): value is SyncPayload {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && !!(value as Record<string, unknown>).dayState
    && typeof (value as Record<string, unknown>).dayState === "object"
    && !!(value as Record<string, unknown>).runValues
    && typeof (value as Record<string, unknown>).runValues === "object";
}

function isPendingIntent(value: unknown): value is PendingSyncIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1
    && typeof item.id === "string"
    && typeof item.scope === "string"
    && typeof item.date === "string"
    && Number.isFinite(item.epoch)
    && typeof item.baseSnapshotId === "string"
    && isSyncPayload(item.baseline)
    && isSyncPayload(item.payload);
}

export function loadPendingSyncIntent(scope: string, date: string): PendingSyncIntent | null {
  if (!scope || !date) return null;
  const item = browserRecordStore.record<PendingSyncIntent | null>(
    recordKey(scope, date),
    () => null,
    { decode: (value) => isPendingIntent(value) ? value : null },
  ).read();
  return item?.scope === scope && item.date === date ? item : null;
}

export function savePendingSyncIntent(intent: PendingSyncIntent): boolean {
  if (!isPendingIntent(intent)) return false;
  try {
    if (JSON.stringify(intent).length > MAX_PENDING_RECORD_CHARS) return false;
  } catch {
    return false;
  }
  return browserRecordStore.record<PendingSyncIntent | null>(
    recordKey(intent.scope, intent.date),
    () => null,
    { decode: (value) => isPendingIntent(value) ? value : null },
  ).write(intent);
}

export function clearPendingSyncIntent(
  scope: string,
  date: string,
  expectedId?: string,
): boolean {
  if (!scope || !date) return false;
  const record = browserRecordStore.record<PendingSyncIntent | null>(
    recordKey(scope, date),
    () => null,
    { decode: (value) => isPendingIntent(value) ? value : null },
  );
  const existing = record.read();
  if (expectedId && existing?.id !== expectedId) return false;
  return record.remove();
}
