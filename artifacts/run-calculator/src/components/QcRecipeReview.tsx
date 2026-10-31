import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ListQcRecipeReviewsParams,
  QcRecipeReviewDecisionInput,
  QcRecipeReviewQueueItem,
} from "@workspace/api-client-react";
import {
  getGetQcRecipeReviewQueryKey,
  getListQcRecipeReviewsQueryKey,
  getListQcRecipeReviewStatusesQueryKey,
  useDecideQcRecipeReview,
  useGetQcRecipeReview,
  useListQcRecipeReviews,
  useListQcRecipeReviewStatuses,
} from "@workspace/api-client-react";

type QueueFilter = NonNullable<ListQcRecipeReviewsParams["status"]>;
type FrozenDecision = { captureId: number; data: QcRecipeReviewDecisionInput };

const panel = "rounded-xl border border-border/80 bg-card p-4 shadow-sm";
const button = "inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted/60 disabled:opacity-50";
const field = "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground";

function decisionId(): string {
  return `qcr_${crypto.randomUUID().replaceAll("-", "")}`;
}

function errorStatus(error: unknown): number | undefined {
  const value = error as { status?: unknown; response?: { status?: unknown } } | null;
  const status = value?.status ?? value?.response?.status;
  return typeof status === "number" ? status : undefined;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusTone(status: string): string {
  if (status === "verified") return "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200";
  if (status === "rejected" || status === "deleted") return "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200";
  if (status === "pending") return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  return "border-border bg-muted text-muted-foreground";
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${statusTone(status)}`}>
      {status.replaceAll("-", " ")}
    </span>
  );
}

function SummaryValues({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return <p className="break-words text-xs">{value === undefined ? "—" : String(value)}</p>;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <p className="text-xs text-muted-foreground">No value recorded</p>;
  return (
    <dl className="space-y-1">
      {entries.map(([key, raw]) => {
        const wrapped = raw && typeof raw === "object" && !Array.isArray(raw) &&
          "value" in raw && "truncated" in raw
          ? raw as { value: unknown; truncated: boolean }
          : { value: raw, truncated: false };
        return (
          <div key={key} className="grid min-w-0 grid-cols-[minmax(5rem,auto)_1fr] gap-2 text-xs">
            <dt className="font-medium text-muted-foreground">{key}</dt>
            <dd className="min-w-0 break-words">
              {typeof wrapped.value === "string"
                ? wrapped.value
                : JSON.stringify(wrapped.value ?? null)}
              {wrapped.truncated && <span className="ml-1 text-muted-foreground">(preview truncated)</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default function QcRecipeReview({ canManageQc }: { canManageQc: boolean }) {
  const queryClient = useQueryClient();
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("pending");
  const [queueCursor, setQueueCursor] = useState<string | null>(null);
  const [statusCursor, setStatusCursor] = useState<string | null>(null);
  const [selectedCaptureId, setSelectedCaptureId] = useState<number | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<"verified" | "rejected">("verified");
  const [reason, setReason] = useState("");
  const [frozenDecision, setFrozenDecision] = useState<FrozenDecision | null>(null);
  const [decisionError, setDecisionError] = useState("");
  const [decisionNotice, setDecisionNotice] = useState("");

  const statusQuery = useListQcRecipeReviewStatuses(
    { ...(statusCursor ? { cursor: statusCursor } : {}), limit: 50 },
    { query: { refetchInterval: 30_000, retry: 1 } },
  );
  const queueQuery = useListQcRecipeReviews(
    { status: queueFilter, limit: 20, ...(queueCursor ? { cursor: queueCursor } : {}) },
    { query: { enabled: canManageQc, refetchInterval: 30_000, retry: 1 } },
  );
  const detailQuery = useGetQcRecipeReview(selectedCaptureId ?? 0, {
    query: { enabled: canManageQc && selectedCaptureId !== null, retry: 1 },
  });
  const decisionMutation = useDecideQcRecipeReview();

  const detail = detailQuery.data;
  const pendingDecision = frozenDecision?.captureId === selectedCaptureId
    ? frozenDecision
    : null;

  const refreshReview = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListQcRecipeReviewsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListQcRecipeReviewStatusesQueryKey() }),
      ...(selectedCaptureId === null
        ? []
        : [queryClient.invalidateQueries({ queryKey: getGetQcRecipeReviewQueryKey(selectedCaptureId) })]),
    ]);
  };

  const submitDecision = () => {
    if (!detail || detail.status === "superseded" || detail.status === "deleted") return;
    const frozen = pendingDecision ?? {
      captureId: detail.captureId,
      data: {
        decisionId: decisionId(),
        status: decisionStatus,
        expectedResultHash: detail.resultHash,
        expectedRevision: detail.decisionRevision,
        reason: reason.trim(),
      },
    };
    if (!frozen.data.reason) {
      setDecisionError("Enter a reason before saving this decision.");
      return;
    }
    setFrozenDecision(frozen);
    setDecisionError("");
    setDecisionNotice("");
    decisionMutation.mutate(
      { captureId: frozen.captureId, data: frozen.data },
      {
        onSuccess: async (result) => {
          setFrozenDecision(null);
          setReason("");
          setDecisionNotice(result.replayed
            ? "The original decision receipt was confirmed."
            : `Recipe revision ${result.status} and saved. The recipe remains applied.`);
          await refreshReview();
        },
        onError: (error) => {
          const status = errorStatus(error);
          setDecisionError(status === 409
            ? "This revision or its review history changed. Refresh the current evidence before deciding again."
            : status === undefined || status === 0 || status >= 500 || status === 408
              ? "The decision may not have reached the server. Retry sends the exact same decision."
              : error instanceof Error ? error.message : "The server rejected this decision.");
        },
      },
    );
  };

  const chooseItem = (item: QcRecipeReviewQueueItem) => {
    setSelectedCaptureId(item.captureId);
    setFrozenDecision(null);
    setDecisionError("");
    setDecisionNotice("");
    setReason("");
  };

  return (
    <section className="space-y-4" data-testid="qc-recipe-review">
      <div className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Shared recipe review status</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Changes are applied before review and remain available for production. A QC decision does not undo a recipe.
            </p>
          </div>
          <button type="button" className={button} onClick={() => void statusQuery.refetch()}>
            Refresh status
          </button>
        </div>
        {statusQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground" role="status">Loading current recipe statuses…</p>
        ) : statusQuery.isError ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            Recipe status could not be loaded. Refresh to try again.
          </p>
        ) : statusQuery.data?.items.length ? (
          <>
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {statusQuery.data.items.map((item) => (
                <li key={`${item.recipeType}:${item.recipeId}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 p-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.recipeName}</span>
                    <span className="text-xs capitalize text-muted-foreground">{item.recipeType} recipe</span>
                  </span>
                  <StatusPill status={item.status} />
                </li>
              ))}
            </ul>
            {statusQuery.data.nextCursor && (
              <button
                type="button"
                className={`${button} mt-3`}
                onClick={() => setStatusCursor(statusQuery.data?.nextCursor ?? null)}
              >
                Load more statuses
              </button>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No shared recipes are available in this facility.</p>
        )}
        {statusQuery.data?.nextCursor === null && statusCursor && (
          <button type="button" className={`${button} mt-3`} onClick={() => setStatusCursor(null)}>
            Back to first page
          </button>
        )}
      </div>

      {canManageQc && (
        <div className={panel}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Recipe review queue</h2>
              <p className="mt-1 text-sm text-muted-foreground">Review the exact saved recipe revision. Later edits create new pending work.</p>
            </div>
            <label className="min-w-40 text-xs font-medium">
              Show
              <select
                className={`${field} mt-1`}
                value={queueFilter}
                onChange={(event) => {
                  setQueueFilter(event.target.value as QueueFilter);
                  setQueueCursor(null);
                  setSelectedCaptureId(null);
                }}
                aria-label="Recipe review queue status"
              >
                {["pending", "verified", "rejected", "superseded", "deleted", "all"].map((value) => (
                  <option key={value} value={value}>{value === "all" ? "All revisions" : value}</option>
                ))}
              </select>
            </label>
          </div>
          {queueQuery.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground" role="status">Loading recipe review queue…</p>
          ) : queueQuery.isError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">Review queue could not be loaded. Refresh to try again.</p>
          ) : queueQuery.data ? (
            <>
              {queueQuery.data.items.length ? (
                <ul className="mt-4 space-y-2">
                  {queueQuery.data.items.map((item) => (
                    <li key={item.captureId}>
                      <button
                        type="button"
                        className={`flex min-h-12 w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left hover:bg-muted/50 ${selectedCaptureId === item.captureId ? "border-primary" : "border-border/70"}`}
                        aria-pressed={selectedCaptureId === item.captureId}
                        onClick={() => chooseItem(item)}
                        data-testid={`qc-recipe-review-item-${item.captureId}`}
                      >
                        <span className="min-w-0">
                          <span className="block break-words text-sm font-medium">
                            {item.recipeName}{item.currentName && item.currentName !== item.recipeName ? ` → ${item.currentName}` : ""}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {item.recipeType} · ID {item.recipeId} · {timeLabel(item.createdAt)} · {item.actorId}
                          </span>
                        </span>
                        <StatusPill status={item.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">No {queueFilter === "all" ? "" : `${queueFilter} `}recipe revisions on this page.</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {queueQuery.data.nextCursor && (
                  <button type="button" className={button} onClick={() => setQueueCursor(queueQuery.data?.nextCursor ?? null)}>
                    More revisions
                  </button>
                )}
                {queueCursor && (
                  <button type="button" className={button} onClick={() => setQueueCursor(null)}>
                    First page
                  </button>
                )}
                {queueQuery.data.scanLimitReached && (
                  <p className="text-xs text-muted-foreground" role="status">This page reached its scan limit; continue to older revisions.</p>
                )}
              </div>
            </>
          ) : null}

          {selectedCaptureId !== null && (
            <div className="mt-4 border-t border-border pt-4" data-testid="qc-recipe-review-detail">
              {detailQuery.isLoading ? (
                <p role="status" className="text-sm text-muted-foreground">Loading saved revision…</p>
              ) : detailQuery.isError ? (
                <div className="space-y-2" role="alert">
                  <p className="text-sm text-destructive">This revision could not be loaded.</p>
                  <button type="button" className={button} onClick={() => void detailQuery.refetch()}>Retry</button>
                </div>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="break-words text-sm font-semibold">
                        {detail.recipeType} · {detail.recipeName}
                        {detail.currentName && detail.currentName !== detail.recipeName ? ` → ${detail.currentName}` : ""}
                      </h3>
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        Recipe ID {detail.recipeId} · revision hash {detail.resultHash}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Saved {timeLabel(detail.createdAt)} by {detail.actorId} · identity {detail.sourceState}
                      </p>
                    </div>
                    <StatusPill status={detail.status} />
                  </div>
                  {detail.status === "superseded" && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status">
                      This is an older revision. Review the latest pending revision instead.
                    </p>
                  )}
                  {detail.status === "deleted" && (
                    <p className="rounded-lg border border-border p-3 text-sm" role="status">
                      The recipe identity was deleted. This saved evidence is retained for history and cannot be decided as a current recipe.
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/70 p-3">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changed fields</h4>
                      <p className="break-words text-xs">{Array.isArray(detail.summary.changedFields) ? detail.summary.changedFields.join(", ") : "Details unavailable"}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 p-3">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary limits</h4>
                      <p className="text-xs text-muted-foreground">
                        {typeof detail.summary.summaryLimitations === "string"
                          ? detail.summary.summaryLimitations
                          : "This is a bounded preview; omitted values are unknown."}
                      </p>
                    </div>
                    <div className="min-w-0 rounded-lg border border-border/70 p-3">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before</h4>
                      <SummaryValues value={detail.summary.before} />
                    </div>
                    <div className="min-w-0 rounded-lg border border-border/70 p-3">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applied revision</h4>
                      <SummaryValues value={detail.summary.after} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decision history</h4>
                    {detail.decisions.length ? (
                      <ol className="space-y-2">
                        {detail.decisions.map((decision) => (
                          <li key={decision.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                            <span><strong className="capitalize">{decision.status}</strong> · {decision.actorId} · {timeLabel(decision.createdAt)}<span className="block break-words text-muted-foreground">{decision.reason}</span></span>
                            <span className="font-mono text-muted-foreground">#{decision.id}</span>
                          </li>
                        ))}
                      </ol>
                    ) : <p className="text-xs text-muted-foreground">No QC decision has been recorded.</p>}
                  </div>
                  {detail.status !== "superseded" && detail.status !== "deleted" && (
                    <div className="space-y-3 rounded-lg border border-border/70 p-3">
                      <p className="text-xs text-muted-foreground">A decision records this revision only. Rejecting it does not change the saved recipe.</p>
                      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                        <label className="text-xs font-medium">
                          Decision
                          <select className={`${field} mt-1`} value={decisionStatus} onChange={(event) => setDecisionStatus(event.target.value as "verified" | "rejected")} disabled={!!pendingDecision}>
                            <option value="verified">Verify this revision</option>
                            <option value="rejected">Reject this revision</option>
                          </select>
                        </label>
                        <label className="text-xs font-medium">
                          Reason
                          <textarea className={`${field} mt-1 min-h-20 py-2`} maxLength={1000} value={pendingDecision?.data.reason ?? reason} onChange={(event) => setReason(event.target.value)} disabled={!!pendingDecision} placeholder="Record why this exact revision was reviewed" />
                        </label>
                      </div>
                      {decisionError && (
                        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="qc-recipe-review-error">
                          {decisionError}
                          {errorStatus(decisionMutation.error) === 409 && (
                            <button type="button" className={`${button} ml-2`} onClick={() => {
                              setFrozenDecision(null);
                              setDecisionError("");
                              void detailQuery.refetch();
                              void refreshReview();
                            }}>Refresh evidence</button>
                          )}
                        </p>
                      )}
                      {decisionNotice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{decisionNotice}</p>}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={button} disabled={decisionMutation.isPending || !reason.trim() && !pendingDecision} onClick={submitDecision} data-testid="button-save-recipe-qc-decision">
                          {decisionMutation.isPending ? "Saving…" : pendingDecision ? "Retry exact decision" : "Save decision"}
                        </button>
                        <button type="button" className={button} onClick={() => void detailQuery.refetch()}>Refresh revision</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
