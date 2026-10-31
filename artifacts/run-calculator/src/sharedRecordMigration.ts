import { browserRecordStore, browserStorage } from "./adapters/browserRecordStore";
import type { SyncPayload } from "./types";

export const LEGACY_SYNC_HISTORY_REVIEW_PREFIX = "run-calc-shared-history-review-v1:";
export function omitArchivedSyncHistory(payload: SyncPayload): SyncPayload {
  const { history: _readCopy, ...activeSnapshot } = payload;
  return activeSnapshot;
}
/** Only legacy unsent intents enter this review store, never normal reads. */
export function withoutArchivedSyncHistory(payload: SyncPayload, scope: string): SyncPayload {
  if (payload.history === undefined) return payload;
  if (!scope) throw new Error("Cannot reconcile legacy history without an authenticated owner");
  const key = `${LEGACY_SYNC_HISTORY_REVIEW_PREFIX}${encodeURIComponent(scope)}`;
  const record = browserRecordStore.record<unknown[]>(key, () => [], {
    decode: (value) => Array.isArray(value) ? value : null,
  });
  const raw = browserStorage.getItem(key);
  const old: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(old)) throw new Error("Legacy history review evidence is unreadable; original bytes retained");
  const incoming: unknown[] = Array.isArray(payload.history) ? payload.history : [payload.history];
  const distinct = new Map([...old, ...incoming].map((day) => [stableRecordJson(day), day]));
  const evidence = [...distinct.values()];
  if (!record.write(evidence)) throw new Error("Legacy history review evidence could not be preserved");
  return omitArchivedSyncHistory(payload);
}

/** Kept outside live repositories. No value here is an upload authority. */
export type RetainedRecordEvidence = {
  key: string;
  kind: string;
  summary: string;
  canRemove: boolean;
  recordIndex: number | null;
  recordCount: number;
  removeBlockedReason?: string;
};
const retainedRecordSnapshots = new WeakMap<RetainedRecordEvidence, { raw: string; recordIndex: number }>();
const unownedKeys = new Set([
  "run-calc-templates", "run-calc-templates:live", "run-calc-templates:sandbox",
  "run-calc-history", "run-calc-completed-history-cache.live",
  "run-calc-completed-history-cache.sandbox",
]);
const removableLocalRecordKeys = new Set([
  "run-calc-history",
  "run-calc-completed-history-cache.live",
  "run-calc-completed-history-cache.sandbox",
]);

function retainedRecordDate(record: unknown): string | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const date = (record as Record<string, unknown>).date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}

function isSafelyIdentifiableRetainedRecord(key: string, record: unknown): boolean {
  if (!retainedRecordDate(record)) return false;
  if (key !== "run-calc-history") return removableLocalRecordKeys.has(key);
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const day = record as Record<string, unknown>;
  return Array.isArray(day.runs)
    && day.runValues !== null
    && typeof day.runValues === "object"
    && !Array.isArray(day.runValues);
}

function retainedRecordEvidenceForKey(key: string, kind: string, raw: string): RetainedRecordEvidence[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{
        key, kind,
        summary: "This saved copy could not be safely separated into individual records. Nothing has been changed.",
        canRemove: false,
        recordIndex: null,
        recordCount: 0,
        removeBlockedReason: "Kept because the saved format cannot be safely split into individual records.",
      }];
    }
    return parsed.map((record, recordIndex) => {
      const date = retainedRecordDate(record);
      const canRemove = isSafelyIdentifiableRetainedRecord(key, record);
      const evidence: RetainedRecordEvidence = {
        key,
        kind,
        summary: `${parsed.length > 1 ? `Item ${recordIndex + 1} of ${parsed.length}` : "Saved record"} on this device.${date ? ` Date: ${date}.` : " The date could not be verified."}`,
        canRemove,
        recordIndex,
        recordCount: parsed.length,
        ...(!canRemove ? {
          removeBlockedReason: !date
            ? "Kept because this item has no clear date and cannot be safely identified for individual removal."
            : key === "run-calc-history"
              ? "Kept because its date is known, but it is not a complete historical-day record."
              : "Kept because its saved format cannot be safely identified for individual removal.",
        } : {}),
      };
      retainedRecordSnapshots.set(evidence, { raw, recordIndex });
      return evidence;
    });
  } catch {
    return [{
      key, kind,
      summary: "The saved contents could not be read. Nothing has been changed.",
      canRemove: false,
      recordIndex: null,
      recordCount: 0,
      removeBlockedReason: "Kept because the saved contents could not be read safely.",
    }];
  }
}

export function retainedSharedRecordEvidence(identity: string | null, manager: boolean): RetainedRecordEvidence[] {
  if (!identity) return [];
  return browserRecordStore.keys().flatMap((key) => {
    const owned = key === `run-calc-profile-cache-v1:${identity}`
      || key === `run-calc-profilesync-queue-v1:${identity}`
      || key === `${LEGACY_SYNC_HISTORY_REVIEW_PREFIX}${encodeURIComponent(identity.split(":").filter((_, i) => i !== 1).join(":"))}`;
    const unowned = manager && (unownedKeys.has(key)
      || (!key.startsWith("run-calc-profile-cache-") && /^run-calc-(?:crust-)?profile-.+__.+/.test(key)));
    const conflict = key.startsWith("run-calc-completed-history-conflicts.")
      && key.endsWith(identity.split(":").filter((_, i) => i !== 1).join(":"));
    if (!owned && !unowned && !conflict) return [];
    const raw = browserStorage.getItem(key);
    if (!raw || raw === "[]" || raw === "{}") return [];
    if (owned && key.includes("queue")) {
      try {
        const ops = JSON.parse(raw);
        if (Array.isArray(ops) && ops.every((op) => op?.t === "del" || op?.blobs)) return [];
      } catch {}
    }
    const canRemove = removableLocalRecordKeys.has(key);
    const kind = key === "run-calc-history" ? "Older device history"
      : key.startsWith("run-calc-completed-history-cache.") ? "Saved completed-history copy"
        : conflict ? "Saved completion conflict"
          : key.startsWith(LEGACY_SYNC_HISTORY_REVIEW_PREFIX) ? "Older daily-sync history"
            : owned ? "Saved setup-profile copy" : "Older saved records";
    if (canRemove) return retainedRecordEvidenceForKey(key, kind, raw);
    return [{
      key,
      kind,
      summary: retainedRecordEvidenceForKey(key, kind, raw)[0]?.summary ?? "Saved copy is kept for review.",
      canRemove: false,
      recordIndex: null,
      recordCount: 0,
      removeBlockedReason: conflict
        ? "Kept here because it may be the only record of a difference that needs review."
        : key.includes("queue") || key.includes("outbox")
          ? "Kept here because it may contain work that has not finished syncing."
          : "Kept here because it may contain setup or recovery data still in use.",
    }];
  });
}

/**
 * Permanently removes only one reviewed, allowlisted local copy. The exact bytes
 * are compared again immediately before removal so a newer write is never lost.
 * This function never writes to, clears, or changes shared server data.
 */
export function removeRetainedSharedRecord(
  identity: string | null,
  manager: boolean,
  selected: RetainedRecordEvidence,
): boolean {
  if (!identity || !manager || !removableLocalRecordKeys.has(selected.key)) return false;
  try {
    const snapshot = retainedRecordSnapshots.get(selected);
    if (!snapshot || !selected.canRemove) return false;
    const stillReviewed = retainedSharedRecordEvidence(identity, manager).some((item) =>
      item.key === selected.key && item.recordIndex === snapshot.recordIndex
      && retainedRecordSnapshots.get(item)?.raw === snapshot.raw && item.canRemove);
    if (!stillReviewed || localStorage.getItem(selected.key) !== snapshot.raw) return false;
    const current: unknown = JSON.parse(snapshot.raw);
    if (!Array.isArray(current) || snapshot.recordIndex < 0 || snapshot.recordIndex >= current.length) return false;
    const remaining = current.filter((_, index) => index !== snapshot.recordIndex);
    if (remaining.length === 0) {
      localStorage.removeItem(selected.key);
      return localStorage.getItem(selected.key) === null;
    }
    const nextRaw = JSON.stringify(remaining);
    localStorage.setItem(selected.key, nextRaw);
    return localStorage.getItem(selected.key) === nextRaw;
  } catch {
    return false;
  }
}

export function stableRecordJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableRecordJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableRecordJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Restart-safe, per-record retirement. Malformed and differing values survive.
 * Never use on a command/outbox; only on acknowledged legacy read snapshots. */
export function retireMatchingLegacyArray(
  key: string, matchesCanonical: (value: unknown) => boolean,
): void {
  const record = browserRecordStore.record<unknown[] | null>(key, () => null, {
    decode: (value) => Array.isArray(value) ? value : null,
  });
  const original = record.read();
  if (!original) return;
  const unresolved = original.filter((item) => !matchesCanonical(item));
  if (unresolved.length === original.length) return;
  if (unresolved.length) record.write(unresolved);
  else record.remove();
}
