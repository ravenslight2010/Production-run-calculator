import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteImportGoldCase,
  fetchImportGoldRetention,
  recordImportGoldCaseDeletionVerified,
  type ImportGoldRetentionRecord,
} from "@/importGold";

const RETENTION_STATUS_LABEL: Record<ImportGoldRetentionRecord["status"], string> = {
  within_limit: "Within 30-day limit",
  due_soon: "Due within 7 days",
  overdue: "Overdue",
  deletion_incomplete: "Score history remains",
  verification_needed: "Deletion verification needed",
  verified: "App deletion verified",
};

type ImportGoldRetentionCardProps = {
  canDeleteCase?: boolean;
  standalone?: boolean;
};

export default function ImportGoldRetentionCard({
  canDeleteCase = false,
  standalone = false,
}: ImportGoldRetentionCardProps) {
  const [records, setRecords] = useState<ImportGoldRetentionRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<ImportGoldRetentionRecord["status"] | "all">("all");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const requestIdRef = useRef(0);
  const revisionRef = useRef<string | undefined>(undefined);

  const setActionBusy = (next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  };

  const refresh = useCallback(async (allowWhileBusy = false) => {
    if (busyRef.current && !allowWhileBusy) return;
    const requestId = ++requestIdRef.current;
    try {
      setError(null);
      const page = await fetchImportGoldRetention(0, statusFilter === "all" ? undefined : statusFilter);
      if (requestId !== requestIdRef.current) return;
      revisionRef.current = page.revision;
      setRecords(page.records);
      setNextOffset(page.nextOffset);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load deletion deadlines.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 15_000);
    const onFocus = () => {
      if (!busyRef.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      requestIdRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const loadMore = async () => {
    if (nextOffset === null || busy) return;
    const requestId = ++requestIdRef.current;
    setActionBusy(true);
    setError(null);
    try {
      const page = await fetchImportGoldRetention(nextOffset, statusFilter === "all" ? undefined : statusFilter, revisionRef.current);
      if (requestId !== requestIdRef.current) return;
      setRecords((current) => [...current, ...page.records]);
      setNextOffset(page.nextOffset);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 409) {
        setRecords([]);
        setNextOffset(null);
        revisionRef.current = undefined;
        await refresh(true);
        return;
      }
      setError(cause instanceof Error ? cause.message : "Could not load more deadlines.");
    } finally {
      setActionBusy(false);
    }
  };

  const removeCase = async (caseId: number) => {
    if (!canDeleteCase || !window.confirm(`Permanently delete evaluation case #${caseId} and its scores?`)) return;
    requestIdRef.current += 1;
    setActionBusy(true);
    setError(null);
    try {
      await deleteImportGoldCase(caseId);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the application case.");
    } finally {
      setActionBusy(false);
    }
  };

  const verifyDeletion = async (caseId: number) => {
    requestIdRef.current += 1;
    setActionBusy(true);
    setError(null);
    try {
      await recordImportGoldCaseDeletionVerified(caseId);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record deletion verification.");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      aria-labelledby="import-gold-retention-heading"
      data-testid="import-gold-retention"
    >
      <h2 id="import-gold-retention-heading" className="font-semibold">
        {standalone ? "Gold Lab retention" : "Deletion deadlines"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The 7-day reminder and overdue status are manual reminders; this register does not delete cases.
      </p>
      <p className="mt-2 rounded bg-muted/40 p-2 text-xs text-muted-foreground">
        This register covers application case and score deletion only. Workbook copies, exports, evaluator or
        diagnostic copies, and database backups are separate and are not verified here. No automated erasure is
        performed.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-sm sm:max-w-sm">
        <span className="font-medium">Filter by status</span>
        <select
          value={statusFilter}
          disabled={busy}
          onChange={(event) => {
            requestIdRef.current += 1;
            setRecords([]);
            setNextOffset(null);
            setLoading(true);
            setStatusFilter(event.target.value as ImportGoldRetentionRecord["status"] | "all");
          }}
          className="min-h-11 rounded border border-border bg-background px-3 py-2 text-foreground [color-scheme:light] dark:[color-scheme:dark] disabled:opacity-50"
          aria-label="Filter retention records by status"
          data-testid="gold-retention-status-filter"
        >
          <option value="all">All statuses</option>
          {Object.entries(RETENTION_STATUS_LABEL).map(([status, label]) => (
            <option key={status} value={status}>{label}</option>
          ))}
        </select>
      </label>
      {standalone && !canDeleteCase && (
        <p className="mt-2 text-xs text-muted-foreground">
          Use the Gold Lab case controls to delete an application case. Either a Manager or QC Manager can record
          verification after the case and score history are gone.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading deletion deadlines…</p>
      ) : records.length === 0 ? (
        !error && <p className="mt-3 text-sm text-muted-foreground">
          {statusFilter === "all"
            ? "No case deadlines are registered in this scope."
            : "No case deadlines match this status in this scope."}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {records.map((item) => (
            <article
              key={item.caseId}
              className="flex flex-col gap-2 rounded border border-border p-2 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`gold-retention-record-${item.caseId}`}
            >
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  Case #{item.caseId} · {RETENTION_STATUS_LABEL[item.status]}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Captured {new Date(item.capturedAt).toLocaleString()} · delete by {new Date(item.deleteBy).toLocaleString()}
                </div>
                {item.status === "deletion_incomplete" && (
                  <div className="mt-1 text-xs text-destructive">
                    Application score history remains; verification is blocked until it is removed.
                  </div>
                )}
                {item.status === "verified" && item.verifiedAt && (
                  <div
                    className="mt-1 text-xs text-muted-foreground"
                    data-testid={`gold-retention-verification-${item.caseId}`}
                  >
                    Verified by {item.verifiedBy ?? "authorized manager"} · {new Date(item.verifiedAt).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {canDeleteCase && ["within_limit", "due_soon", "overdue"].includes(item.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeCase(item.caseId)}
                    className="min-h-11 rounded border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50"
                    data-testid={`button-delete-gold-case-${item.caseId}`}
                  >
                    Delete app case
                  </button>
                )}
                {item.status === "verification_needed" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void verifyDeletion(item.caseId)}
                    className="min-h-11 rounded border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
                    data-testid={`button-verify-gold-case-${item.caseId}`}
                  >
                    Record app deletion verified
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {nextOffset !== null && (
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void loadMore()}
          className="mt-3 min-h-11 rounded border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
          data-testid="button-load-more-gold-retention"
        >
          Load more deadlines
        </button>
      )}
    </section>
  );
}
