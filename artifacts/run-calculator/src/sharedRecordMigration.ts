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
export type RetainedRecordEvidence = { key: string; kind: string };
const unownedKeys = new Set([
  "run-calc-templates", "run-calc-templates:live", "run-calc-templates:sandbox",
  "run-calc-templates-outbox-v1:live", "run-calc-templates-outbox-v1:sandbox",
  "run-calc-history", "run-calc-completed-history-cache.live",
  "run-calc-completed-history-cache.sandbox", "run-calc-completed-history-outbox.live",
  "run-calc-completed-history-outbox.sandbox",
]);
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
    return [{ key, kind: conflict ? "Completion conflict"
      : key.startsWith(LEGACY_SYNC_HISTORY_REVIEW_PREFIX) ? "Owned legacy daily-sync history (review only)"
      : owned ? "Owned legacy profile" : "Legacy records with unverified ownership" }];
  });
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
