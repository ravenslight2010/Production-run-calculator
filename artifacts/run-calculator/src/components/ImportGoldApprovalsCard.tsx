import { useCallback, useEffect, useRef, useState } from "react";
import {
  createImportGoldApproval,
  listImportGoldApprovals,
  revokeImportGoldApproval,
  verifyImportGoldApproval,
  type ImportGoldApproval,
} from "@workspace/api-client-react";
import { useAuth } from "@/useAuth";
import ApprovalRow from "./import-gold-approvals/ApprovalRow";
import CreateApprovalForm from "./import-gold-approvals/CreateApprovalForm";
import ExpiryReminderPanel from "./import-gold-approvals/ExpiryReminderPanel";
import LookupBar from "./import-gold-approvals/LookupBar";
import {
  Explainer, POLL_MS, Shell, Skeleton, btn, checkedApproval, checkedApprovalPage, checkedReminders, safeMessage,
  type ExpiryReminders,
} from "./import-gold-approvals/shared";

// recordRef is an additive optional query parameter; typed locally until generated types include it.
type ListParams = { before?: number; recordRef?: string };
const listPage = (params: ListParams) =>
  listImportGoldApprovals(params as Parameters<typeof listImportGoldApprovals>[0]);

export { approvalStatus, EVALUATION_DIGEST_PATTERN, OPAQUE_REF_PATTERN } from "./import-gold-approvals/shared";


export default function ImportGoldApprovalsCard() {
  const { me, isLoading } = useAuth();
  if (isLoading) {
    return (
      <Shell>
        <Skeleton />
      </Shell>
    );
  }
  if (!me) {
    return (
      <Shell>
        <p className="mt-3 text-sm text-muted-foreground" data-testid="gold-approvals-signed-out">
          Sign in to review Gold Lab approvals.
        </p>
      </Shell>
    );
  }
  const roleOk = me.role === "manager" || me.role === "qc-manager";
  const capOk = me.capabilities.includes("manage-staff") || me.capabilities.includes("manage-qc");
  if (!roleOk || !capOk) {
    return (
      <Shell>
        <p
          className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
          data-testid="gold-approvals-denied"
        >
          Approval review is limited to a Manager or QC Manager with manage-staff or manage-qc capability. Ask a manager
          to update your role if you need access.
        </p>
      </Shell>
    );
  }
  // Key by identity and scope so stale requests and form contents are discarded.
  return <ApprovalsInner key={`${me.userId}:${me.sandbox ? "sandbox" : "live"}`} />;
}

function ApprovalsInner() {
  const [approvals, setApprovals] = useState<ImportGoldApproval[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const [lookup, setLookup] = useState<string | null>(null);
  const lookupRef = useRef<string | null>(null);
  // undefined = not loaded yet, null = server did not provide (legacy) or malformed.
  const [reminders, setReminders] = useState<ExpiryReminders | null | undefined>(undefined);
  const baseParams = (): ListParams => (lookupRef.current ? { recordRef: lookupRef.current } : {});

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setActionBusy = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const raw = await listPage(baseParams());
      const page = checkedApprovalPage(raw);
      if (!alive.current || gen !== generation.current) return;
      setReminders(checkedReminders((raw as { expiryReminders?: unknown }).expiryReminders));
      setApprovals(page.approvals);
      setNextBefore(page.nextBefore);
      setLoadError(null);
    } catch (cause) {
      if (!alive.current || gen !== generation.current) return;
      setLoadError(safeMessage(cause, "load approvals"));
    } finally {
      if (alive.current && gen === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (!busyRef.current && document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onFocus = () => {
      if (!busyRef.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const loadMore = async () => {
    if (nextBefore === null || busyRef.current) return;
    setActionBusy(true);
    const gen = generation.current;
    try {
      const page = checkedApprovalPage(await listPage({ ...baseParams(), before: nextBefore }));
      if (!alive.current || gen !== generation.current) return;
      setApprovals((cur) => {
        const seen = new Set(cur.map((a) => a.id));
        return [...cur, ...page.approvals.filter((a) => !seen.has(a.id))];
      });
      setNextBefore(page.nextBefore);
    } catch (cause) {
      if (alive.current) setActionError(safeMessage(cause, "load more approvals"));
    } finally {
      if (alive.current) setActionBusy(false);
    }
  };

  const applyLookup = (ref: string | null) => {
    if (busyRef.current || ref === lookupRef.current) return;
    lookupRef.current = ref;
    setLookup(ref);
    // Deliberately restart from the newest page: old cursor and rows belong to another query.
    generation.current += 1;
    setApprovals([]);
    setNextBefore(null);
    setLoadError(null);
    setLoading(true);
    void refresh();
  };

  const replaceApproval = (next: ImportGoldApproval) =>
    setApprovals((cur) => {
      const has = cur.some((a) => a.id === next.id);
      return has ? cur.map((a) => (a.id === next.id ? next : a)) : [next, ...cur];
    });

  const runAction = async (label: string, fn: () => Promise<ImportGoldApproval>, success: string) => {
    if (busyRef.current) return false;
    setActionBusy(true);
    setActionError(null);
    setNotice(null);
    generation.current += 1; // invalidate in-flight polls
    try {
      const approval = checkedApproval(await fn());
      if (!alive.current) return false;
      replaceApproval(approval);
      setNotice(success);
      return true;
    } catch (cause) {
      if (alive.current) setActionError(safeMessage(cause, label));
      return false;
    } finally {
      if (alive.current) setActionBusy(false);
    }
  };

  return (
    <Shell>
      <Explainer />
      <ExpiryReminderPanel reminders={reminders} />
      <LookupBar active={lookup} busy={busy} onApply={applyLookup} />
      <div aria-live="polite">
        {notice && (
          <p className="mt-3 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-2 text-sm" data-testid="gold-approvals-notice">
            {notice}
          </p>
        )}
      </div>
      {actionError && (
        <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" data-testid="gold-approvals-action-error">
          {actionError}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${btn} border-border`}
          disabled={busy}
          onClick={() => {
            setShowForm((v) => !v);
            setNotice(null);
          }}
          aria-expanded={showForm}
          data-testid="button-toggle-gold-approval-form"
        >
          {showForm ? "Close new approval" : "Record new approval metadata"}
        </button>
        <button
          type="button"
          className={`${btn} border-border`}
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
          data-testid="button-refresh-gold-approvals"
        >
          Refresh
        </button>
      </div>

      {showForm && (
        <CreateApprovalForm
          busy={busy}
          onSubmit={async (input) => {
            const ok = await runAction(
              "record the approval",
              async () => (await createImportGoldApproval(input)).approval,
              "Approval metadata recorded as pending. It cannot be edited; a reviewer must verify it separately.",
            );
            if (ok) setShowForm(false);
            return ok;
          }}
        />
      )}

      {loading ? (
        <Skeleton />
      ) : loadError && approvals.length === 0 ? (
        <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="gold-approvals-load-error">
          <p>{loadError}</p>
          <button type="button" className={`${btn} mt-2 border-destructive/40`} onClick={() => void refresh()} data-testid="button-retry-gold-approvals">
            Try again
          </button>
        </div>
      ) : approvals.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="gold-approvals-empty">
          {lookup ? <>No approval in this scope has record reference <span className="font-mono break-all">{lookup}</span>.</> : <>No approvals recorded in this scope yet.</>}{!lookup && " Record metadata once the owner and privacy review are complete."}
        </div>
      ) : (
        <>
          {loadError && (
            <p role="alert" className="mt-3 text-xs text-destructive" data-testid="gold-approvals-stale">
              {loadError} Showing the last loaded list.
            </p>
          )}
          <ul className="mt-3 space-y-3" aria-label="Approvals">
            {approvals.map((a) => (
              <ApprovalRow
                key={a.id}
                approval={a}
                busy={busy}
                onVerify={() =>
                  runAction(
                    "record verification",
                    async () => (await verifyImportGoldApproval(a.id, { reviewed: true })).approval,
                    `Approval #${a.id} verification recorded.`,
                  )
                }
                onRevoke={() =>
                  runAction(
                    "revoke the approval",
                    async () => (await revokeImportGoldApproval(a.id, { reviewed: true })).approval,
                    `Approval #${a.id} revoked. Its metadata and audit remain.`,
                  )
                }
              />
            ))}
          </ul>
        </>
      )}
      {nextBefore !== null && !loading && (
        <button type="button" disabled={busy} onClick={() => void loadMore()} className={`${btn} mt-3 border-border`} data-testid="button-load-more-gold-approvals">
          Load older approvals
        </button>
      )}
    </Shell>
  );
}
