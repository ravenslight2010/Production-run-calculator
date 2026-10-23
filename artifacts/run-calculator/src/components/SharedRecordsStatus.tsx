import { useEffect, useReducer, useSyncExternalStore } from "react";
import { useAuth } from "../useAuth";
import { getProfileCacheVersion, profileReadStatus, subscribeProfileCache } from "../profileCache";
import { reconcileProfilesFromServer, pendingProfileWriteCount, profileRecoveryIsMemoryOnly } from "../profileServerSync";
import {
  reconcileRunTemplates, flushRunTemplates, runTemplatesStatus,
  runTemplatesVersion, subscribeRunTemplates,
  pendingRunTemplateCount,
} from "../runTemplatesRepository";
import {
  completedHistoryStatus, COMPLETED_HISTORY_OUTBOX_EVENT,
  flushCompletedHistoryOutbox, hydrateCompletedHistory, pendingCompletedHistoryCount,
} from "../completedHistorySync";
import { retainedSharedRecordEvidence } from "../sharedRecordMigration";

/** Separate empty server results from unavailable cold reads. Recovery commands
 * and unresolved migration evidence are never presented as canonical history. */
export function SharedRecordsStatus() {
  const { me } = useAuth();
  useSyncExternalStore(subscribeProfileCache, getProfileCacheVersion);
  useSyncExternalStore(subscribeRunTemplates, runTemplatesVersion);
  const [, update] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(COMPLETED_HISTORY_OUTBOX_EVENT, update);
    return () => window.removeEventListener(COMPLETED_HISTORY_OUTBOX_EVENT, update);
  }, []);
  if (!me) return null;
  const identity = `${me.sandbox ? "sandbox" : "live"}:authenticated-facility:${me.userId}`;
  const evidence = retainedSharedRecordEvidence(identity, me.capabilities.includes("manage-profiles"));
  const unavailable = [
    profileReadStatus() !== "ready" ? "Setup profiles" : null,
    runTemplatesStatus() !== "ready" ? "Run templates" : null,
    completedHistoryStatus() !== "ready" ? "Completed history" : null,
  ].filter(Boolean);
  const pending = pendingCompletedHistoryCount();
  const pendingProfiles = pendingProfileWriteCount();
  const pendingTemplates = pendingRunTemplateCount();
  if (!unavailable.length && !pending && !pendingProfiles && !pendingTemplates && !evidence.length) return null;
  return <aside role="status" data-testid="shared-records-status" className="mb-3 rounded-md border border-amber-500 p-3 text-sm">
    {profileRecoveryIsMemoryOnly() && <p role="alert">
      Device storage could not save some profile edits. Keep this page open and reconnect
      before leaving; those edits cannot survive a reload until acknowledged by the server.
    </p>}
    {unavailable.length > 0 && <>
      <p>{unavailable.join(", ")}: not loaded from the server. This does not mean they are empty.
        Connect online and retry. Already loaded records and saved run recovery remain usable.</p>
      <button type="button" className="mt-2 underline" onClick={() => {
        void Promise.allSettled([
          reconcileProfilesFromServer(),
          reconcileRunTemplates().then(() => flushRunTemplates()),
          flushCompletedHistoryOutbox().then(() => hydrateCompletedHistory([], () => {})),
        ]);
      }}>Retry shared records</button>
    </>}
    {pending > 0 && <p>{pending} pending local completion{pending === 1 ? "" : "s"} — not yet acknowledged by the server.</p>}
    {(pendingProfiles > 0 || pendingTemplates > 0) && <p>
      Pending local edits: {pendingProfiles} profiles, {pendingTemplates} templates.
      They remain on this device for this account until acknowledged. Conflicting edits require review.
    </p>}
    {evidence.length > 0 && <details className="mt-2">
      <summary>{evidence.length} retained record source{evidence.length === 1 ? "" : "s"} need review</summary>
      <p>These records are not a shared directory or authoritative history. Unverified ownership,
        differing values, and immutable conflicts are preserved without automatic upload.</p>
      <ul>{evidence.map((item) => <li key={item.key}>{item.kind}: {item.key}</li>)}</ul>
      <button type="button" className="mt-2 underline" onClick={() => {
        const payload = {
          provenance: "local-unresolved-review-evidence-not-authoritative",
          records: evidence.map(({ key, kind }) => ({ key, kind, raw: localStorage.getItem(key) })),
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url; link.download = "retained-record-review.json"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }}>Download retained records for review</button>
    </details>}
  </aside>;
}
