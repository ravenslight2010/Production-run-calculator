import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BadgeCheck, FileClock, LoaderCircle, LockKeyhole, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import type {
  ListQcImportReviewsParams,
  QcImportReviewDecisionInput,
  QcImportReviewDecisionResult,
  QcImportReviewDetail,
  QcImportReviewItem,
} from "@workspace/api-client-react";
import {
  getGetQcImportReviewBadgesQueryKey,
  getGetQcImportReviewQueryKey,
  getListQcImportReviewsQueryKey,
  useDecideQcImportReview,
  useGetQcImportReview,
  useGetQcImportReviewBadges,
  useListQcImportReviews,
} from "@workspace/api-client-react";

export const QC_IMPORT_REVIEW_POLL_MS = 30_000;
type StatusFilter = "pending" | "verified" | "rejected" | "all";
type Frozen = { operationId: string; data: QcImportReviewDecisionInput };
type Failure = { kind: "network" | "conflict" | "error"; message: string };

const panel = "rounded-xl border border-border/80 bg-card shadow-sm";
const label = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const quiet = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50";

function newDecisionId(): string {
  return `qcir_${crypto.randomUUID().replace(/-/g, "")}`;
}

function errorStatus(error: unknown): number | undefined {
  const value = (error as { status?: unknown; response?: { status?: unknown } } | null);
  const status = value?.status ?? value?.response?.status;
  return typeof status === "number" ? status : undefined;
}

export function classifyDecisionError(error: unknown): Failure {
  const status = errorStatus(error);
  if (status === 409 || status === 412) {
    return { kind: "conflict", message: "This import changed or was decided elsewhere. Refresh and review the current evidence before deciding again." };
  }
  if (status === undefined || status === 0 || status >= 500 || status === 408) {
    return { kind: "network", message: "The decision may not have reached the server. Retry sends the exact same decision; it is not saved until a receipt is acknowledged." };
  }
  const message = error instanceof Error && error.message ? error.message : "The server rejected this decision.";
  return { kind: "error", message };
}

export function isActionable(item: Pick<QcImportReviewItem, "qcStatus" | "evidenceAvailable" | "resultHash" | "applyStatus">): boolean {
  return item.evidenceAvailable && Boolean(item.resultHash) && item.applyStatus === "applied";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Pill({ tone, children, testId }: { tone: "amber" | "green" | "rose" | "neutral"; children: string; testId?: string }) {
  const styles = {
    neutral: "border-border bg-muted/60 text-muted-foreground",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    green: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200",
  };
  return <span data-testid={testId} className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${styles[tone]}`}>{children}</span>;
}

function qcTone(status: string) {
  return status === "verified" ? "green" : status === "rejected" ? "rose" : "amber";
}

function Values({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (!entries.length) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="space-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-1.5"><dt className="shrink-0 text-muted-foreground">{key}:</dt><dd className="min-w-0 break-words font-mono">{value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>
      ))}
    </dl>
  );
}

/** Counts-only badge for every authenticated user. Never exposes details or navigation. */
export function QcImportReviewBadge() {
  const query = useGetQcImportReviewBadges({
    query: { queryKey: getGetQcImportReviewBadgesQueryKey(), refetchInterval: QC_IMPORT_REVIEW_POLL_MS, retry: 1 },
  });
  if (!query.data) return null;
  const { pending, rejected } = query.data;
  if (!pending && !rejected) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-2 py-1.5 sm:px-4">
      <div
        role="status"
        aria-label={`Import QC review: ${pending} pending, ${rejected} rejected`}
        data-testid="badge-qc-import-review"
        className="pointer-events-none inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] font-semibold shadow-md backdrop-blur"
      >
        <FileClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span>Import QC</span>
        <span data-testid="text-qc-import-badge-pending" className="rounded-full bg-amber-500/15 px-2 text-amber-800 dark:text-amber-200">{pending} pending</span>
        {rejected > 0 && <span data-testid="text-qc-import-badge-rejected" className="rounded-full bg-rose-500/15 px-2 text-rose-800 dark:text-rose-200">{rejected} rejected</span>}
      </div>
    </div>
  );
}

function DecisionForm({ detail, onRefresh }: { detail: QcImportReviewDetail; onRefresh: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [receipt, setReceipt] = useState<QcImportReviewDecisionResult | null>(null);
  const mutation = useDecideQcImportReview();

  const send = (attempt: Frozen) => {
    setFailure(null);
    mutation.mutate({ operationId: attempt.operationId, data: attempt.data }, {
      onSuccess: async (result) => {
        if (result.operationId !== attempt.operationId || result.resultHash !== attempt.data.expectedResultHash ||
            result.qcStatus !== attempt.data.status || !Number.isSafeInteger(result.revision) ||
            result.revision <= attempt.data.expectedRevision || typeof result.replayed !== "boolean") {
          setFailure({ kind: "network", message: "The server did not confirm this exact decision. Retry the same decision to recover its receipt." });
          return;
        }
        setReceipt(result);
        setFrozen(null);
        setReason("");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListQcImportReviewsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetQcImportReviewBadgesQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetQcImportReviewQueryKey(attempt.operationId) }),
        ]);
      },
      onError: (error) => {
        const classified = classifyDecisionError(error);
        setFailure(classified);
        if (classified.kind !== "network") setFrozen(null);
      },
    });
  };

  const decide = (status: "verified" | "rejected") => {
    if (!reason.trim() || !detail.resultHash || frozen) return;
    const attempt: Frozen = {
      operationId: detail.operationId,
      data: { decisionId: newDecisionId(), expectedResultHash: detail.resultHash, expectedRevision: detail.revision, status, reason: reason.trim() },
    };
    setFrozen(attempt);
    send(attempt);
  };

  if (receipt) {
    return (
      <div role="status" data-testid="status-qc-import-receipt" className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
        <p className="flex items-center gap-2 font-semibold"><BadgeCheck className="h-4 w-4" /> Decision saved: {receipt.qcStatus}{receipt.replayed ? " (already recorded)" : ""}</p>
        <p className="mt-1 text-xs">Revision {receipt.revision}. Hash <span className="font-mono">{receipt.resultHash.slice(0, 12)}…</span></p>
        <button type="button" className={`${quiet} mt-2`} onClick={onRefresh} data-testid="button-qc-import-reload-after-receipt">Reload review</button>
      </div>
    );
  }

  const locked = Boolean(frozen);
  return (
    <div className="space-y-3" data-testid="form-qc-import-decision">
      <label className="block">
        <span className={label}>Rationale (required)</span>
        <textarea
          className="min-h-0 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
          rows={3}
          maxLength={1000}
          value={frozen ? frozen.data.reason : reason}
          disabled={locked}
          onChange={(event) => setReason(event.target.value)}
          data-testid="textarea-qc-import-reason"
        />
      </label>
      {failure && (
        <div role="alert" data-testid={`alert-qc-import-${failure.kind}`} className="rounded-lg border border-rose-300/70 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200">
          <p className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{failure.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {failure.kind === "network" && frozen && (
              <button type="button" className={quiet} disabled={mutation.isPending} onClick={() => send(frozen)} data-testid="button-qc-import-retry">
                <RotateCcw className="h-3.5 w-3.5" /> Retry same decision
              </button>
            )}
            {failure.kind === "conflict" && (
              <button type="button" className={quiet} onClick={onRefresh} data-testid="button-qc-import-refresh">Refresh and review</button>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={locked || !reason.trim()} onClick={() => decide("verified")} data-testid="button-qc-import-verify">
          {mutation.isPending && frozen?.data.status === "verified" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Verify
        </button>
        <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 text-sm font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
          disabled={locked || !reason.trim()} onClick={() => decide("rejected")} data-testid="button-qc-import-reject">
          <ShieldAlert className="h-4 w-4" /> Reject
        </button>
      </div>
    </div>
  );
}

function ReviewDetail({ operationId }: { operationId: string }) {
  const [formKey, setFormKey] = useState(0);
  // Detail is never polled or refocus-refreshed: the open form keeps its frozen revision.
  const query = useGetQcImportReview(operationId, {
    query: { queryKey: getGetQcImportReviewQueryKey(operationId), staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false, refetchInterval: false },
  });
  const refresh = () => { void query.refetch().then((result) => { if (!result.isError) setFormKey((value) => value + 1); }); };
  if (query.isLoading) return <div className="space-y-2 p-4" data-testid="skeleton-qc-import-detail">{[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-muted" />)}</div>;
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="m-4 rounded-lg border border-rose-300/70 bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
        Could not load this import review.
        <button type="button" className="ml-2 font-semibold underline" onClick={refresh} data-testid="button-qc-import-detail-retry">Retry</button>
      </div>
    );
  }
  const detail = query.data;
  const actionable = isActionable(detail);
  return (
    <div className="space-y-4 p-4 sm:p-5" data-testid={`detail-qc-import-${detail.operationId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={qcTone(detail.qcStatus)} testId="status-qc-import-qc">{`QC ${detail.qcStatus}`}</Pill>
        <Pill tone={detail.applyStatus === "applied" ? "neutral" : "rose"} testId="status-qc-import-apply">{`Apply ${detail.applyStatus}`}</Pill>
        <span className="text-xs text-muted-foreground">Revision {detail.revision}</span>
        <button type="button" className={`${quiet} ml-auto min-h-8 text-xs`} onClick={refresh} data-testid="button-qc-import-detail-refresh">
          <RotateCcw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0"><dt className={label}>Operation ID</dt><dd className="break-all font-mono" data-testid="text-qc-import-operation-id">{detail.operationId}</dd></div>
        <div className="min-w-0"><dt className={label}>Result hash</dt><dd className="break-all font-mono" data-testid="text-qc-import-hash">{detail.resultHash ?? "Unavailable"}</dd></div>
      </dl>

      {!detail.evidenceAvailable ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm" data-testid="text-qc-import-legacy">
          Legacy import — unreviewed, evidence unavailable. No QC decision can be recorded.
        </p>
      ) : detail.summary ? (
        <section aria-label="Retained summary" className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-xs" data-testid="table-qc-import-entities">
              <thead className="text-muted-foreground"><tr><th className="py-1.5">Entity</th><th>Before</th><th>After</th><th>Created</th><th>Updated</th><th>Deleted</th></tr></thead>
              <tbody>
                {detail.summary.entities.map((row) => (
                  <tr key={row.entity} className="border-t border-border/60"><td className="py-1.5 font-semibold">{row.entity}</td><td>{row.before}</td><td>{row.after}</td><td>{row.created}</td><td>{row.updated}</td><td>{row.deleted}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2">
            {detail.summary.changes.map((change, index) => (
              <li key={`${change.entity}-${change.row}-${index}`} className="rounded-lg border border-border/70 p-3 text-xs" data-testid={`row-qc-import-change-${index}`}>
                <p className="font-semibold">{change.action} · {change.entity} · {change.row}</p>
                <p className="mt-1 break-words text-muted-foreground">Changed fields: {change.fields.join(", ") || "row identity"}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div><p className={label}>Before</p><Values values={change.before} /></div>
                  <div><p className={label}>After</p><Values values={change.after} /></div>
                </div>
              </li>
            ))}
          </ul>
          {detail.summary.omittedChanges > 0 && <p className="text-xs text-muted-foreground" data-testid="text-qc-import-omitted">{detail.summary.omittedChanges} more changes omitted from the retained summary.</p>}
        </section>
      ) : null}
      {detail.summaryLimitation && <p className="text-xs text-muted-foreground" data-testid="text-qc-import-limitation">Limitation: {detail.summaryLimitation}</p>}

      <section aria-label="Rationale history">
        <h4 className={label}>Latest rationale history</h4>
        {detail.decisions.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="text-qc-import-no-decisions">No decisions recorded.</p> : (
          <ol className="space-y-1.5">
            {detail.decisions.map((decision) => (
              <li key={decision.id} className="rounded-lg bg-muted/40 p-2 text-xs" data-testid={`row-qc-import-decision-${decision.id}`}>
                <Pill tone={qcTone(decision.status)}>{decision.status}</Pill> <span className="text-muted-foreground">{formatTime(decision.createdAt)} · {decision.actorId}</span>
                <p className="mt-1 whitespace-pre-wrap break-words">{decision.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs" data-testid="text-qc-import-undo-guidance">
        <Undo2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p><span className="font-semibold">Undo guidance{detail.undo.available ? "" : " (unavailable)"}:</span> {detail.undo.guidance} QC review never undoes or replays an import.</p>
      </div>

      {actionable ? <DecisionForm key={`${detail.operationId}-${formKey}`} detail={detail} onRefresh={refresh} />
        : <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-qc-import-not-actionable"><LockKeyhole className="h-3.5 w-3.5" /> No decision available for this import.</p>}
    </div>
  );
}

export default function QcImportReview({ canManageQc }: { canManageQc: boolean }) {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const params: ListQcImportReviewsParams = { status, ...(cursor ? { cursor } : {}), limit: 25 };
  const list = useListQcImportReviews(params, {
    query: { enabled: canManageQc, queryKey: getListQcImportReviewsQueryKey(params), refetchInterval: QC_IMPORT_REVIEW_POLL_MS },
  });
  if (!canManageQc) return null;
  const items = list.data?.items ?? [];
  return (
    <section className={`${panel} overflow-hidden`} aria-labelledby="qc-import-review-title" data-testid="section-qc-import-review">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
        <div>
          <h2 id="qc-import-review-title" className="text-sm font-bold tracking-tight">Import review</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Independent of the selected run. QC status is separate from Apply status.</p>
        </div>
        <label className="min-w-36">
          <span className="sr-only">Filter by QC status</span>
          <select className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={status}
            onChange={(event) => { setStatus(event.target.value as StatusFilter); setCursor(undefined); setCursorStack([]); }} data-testid="select-qc-import-status">
            <option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="all">All</option>
          </select>
        </label>
      </div>
      <div className="grid md:grid-cols-[minmax(14rem,.8fr)_minmax(0,1.6fr)]">
        <div className="border-b border-border/70 md:border-b-0 md:border-r">
          {list.isLoading ? (
            <div className="space-y-2 p-4" data-testid="skeleton-qc-import-list">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : list.isError ? (
            <div role="alert" className="m-4 text-sm text-rose-800 dark:text-rose-200">
              Could not load import reviews. <button type="button" className="font-semibold underline" onClick={() => void list.refetch()} data-testid="button-qc-import-list-retry">Retry</button>
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground" data-testid="text-qc-import-empty">No imports in this queue.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((item) => (
                <li key={item.operationId}>
                  <button type="button" aria-current={selected === item.operationId} onClick={() => setSelected(item.operationId)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-muted/50 ${selected === item.operationId ? "bg-muted/70" : ""}`} data-testid={`button-qc-import-item-${item.operationId}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{item.importType}</span>
                      <Pill tone={item.evidenceAvailable ? qcTone(item.qcStatus) : "neutral"}>{item.evidenceAvailable ? item.qcStatus : "unreviewed · legacy"}</Pill>
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{item.operationId}</p>
                    <p className="text-[11px] text-muted-foreground">{formatTime(item.createdAt)} · Apply {item.applyStatus}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between gap-2 p-3">
            <button type="button" className={quiet} disabled={!cursorStack.length} onClick={() => { const next = [...cursorStack]; setCursor(next.pop()); setCursorStack(next); }} data-testid="button-qc-import-prev">Previous</button>
            <button type="button" className={quiet} disabled={!list.data?.nextCursor} onClick={() => { setCursorStack([...cursorStack, cursor]); setCursor(list.data?.nextCursor ?? undefined); }} data-testid="button-qc-import-next">Next</button>
          </div>
        </div>
        <div className="min-w-0">
          {selected ? <ReviewDetail key={selected} operationId={selected} /> : <p className="p-6 text-sm text-muted-foreground" data-testid="text-qc-import-select">Select an import to review its retained evidence.</p>}
        </div>
      </div>
    </section>
  );
}
