import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
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
import { retainedSharedRecordEvidence, removeRetainedSharedRecord } from "../sharedRecordMigration";

/** Separate empty server results from unavailable cold reads. Recovery commands
 * and unresolved migration evidence are never presented as canonical history. */
export function SharedRecordsStatus() {
  const { me } = useAuth();
  useSyncExternalStore(subscribeProfileCache, getProfileCacheVersion);
  useSyncExternalStore(subscribeRunTemplates, runTemplatesVersion);
  const [, update] = useReducer((n) => n + 1, 0);
  const [reviewError, setReviewError] = useState("");
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
      <summary>{evidence.length} saved local item{evidence.length === 1 ? "" : "s"} to review</summary>
      <p className="mt-2">These are saved copies from this device, not a list of confirmed shared records. They were not uploaded automatically because their owner or history is unclear. Pending work and conflict records stay protected.</p>
      <ul className="mt-2 space-y-3">
        {evidence.map((item) => <li key={`${item.key}:${item.recordIndex ?? "unreadable"}`} className="rounded border border-border p-3">
          <p className="font-medium">{item.kind}</p>
          <p>{item.summary}</p>
          <p className="text-muted-foreground">Removing this copy affects only this device. It does not delete the facility’s shared records, but this may be the only offline copy here.</p>
          {item.canRemove ? <button type="button" className="mt-2 underline" onClick={() => {
            if (!window.confirm(`Permanently remove only this saved item: ${item.summary} This cannot be undone here. Shared facility data will not be changed.`)) return;
            const removed = removeRetainedSharedRecord(identity, me.capabilities.includes("manage-profiles"), item);
            if (removed) {
              setReviewError("");
              update();
            } else {
              setReviewError("This saved copy changed or could not be removed. Nothing else was removed; refresh the review and try again.");
            }
          }}>Remove this saved copy from this device</button> : <p className="mt-2 text-muted-foreground">{item.removeBlockedReason}</p>}
        </li>)}
      </ul>
      {reviewError && <p role="alert" className="mt-2">{reviewError}</p>}
    </details>}
  </aside>;
}
