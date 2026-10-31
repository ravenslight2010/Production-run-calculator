import { useState } from "react";
import {
  getGetQcAllergenActivityQueryKey,
  useGetQcAllergenActivity,
  type GetQcAllergenActivityParams,
  type QcAllergenActivityResponse,
} from "@workspace/api-client-react";

const panelClass = "rounded-xl border border-border/80 bg-card shadow-sm";

function sourceLabel(source: QcAllergenActivityResponse["runs"][number]["source"]): string {
  if (source === "completed-snapshot") return "Completed-run snapshot";
  if (source === "active-day-state") return "Current-day snapshot";
  return "Source unavailable";
}

function reviewLabel(state: QcAllergenActivityResponse["runs"][number]["derivedReviewState"]): string {
  if (state === "no-review") return "No review recorded";
  if (state === "reviewed-empty") return "Reviewed — no tracked allergens recorded";
  if (state === "reviewed") return "Derived footprint review recorded";
  if (state === "unavailable") return "QC event source unavailable";
  return "Unknown / unreviewed footprint";
}

function SourceLine({
  title,
  source,
}: {
  title: string;
  source: QcAllergenActivityResponse["sources"]["endedRuns"];
}) {
  if (source.status === "not-applicable") return null;
  const details = source.status === "available"
    ? `${source.count ?? 0} record${source.count === 1 ? "" : "s"}`
    : `Unavailable${source.reason ? ` · ${source.reason.replaceAll("-", " ")}` : ""}`;
  return (
    <li className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs">
      <span className="font-semibold">{title}</span>
      <span className={source.status === "available" ? "text-muted-foreground" : "font-medium text-amber-800 dark:text-amber-200"}>
        {details}
      </span>
    </li>
  );
}

function RecordedAt({ value }: { value: string }) {
  return (
    <time className="text-xs text-muted-foreground" dateTime={value}>
      {new Date(value).toLocaleString()}
    </time>
  );
}

type AuditDetail = {
  action: "correction" | "redaction";
  actorId: string | null;
  reason: string | null;
  recordedAt: string;
};

function AuditDetails({ entries }: { entries: AuditDetail[] }) {
  if (entries.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2 border-l-2 border-amber-400/70 pl-3" aria-label="Correction and redaction audit details">
      {entries.map((entry, index) => (
        <li key={`${entry.action}-${entry.recordedAt}-${index}`} className="text-xs">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-amber-900 dark:text-amber-100">
            <span>{entry.action === "correction" ? "Correction reason" : "Redaction reason"}</span>
            <RecordedAt value={entry.recordedAt} />
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words">{entry.reason || "No reason recorded"}</p>
          <p className="mt-1 break-all text-[11px] text-muted-foreground">
            Recorded by: {entry.actorId || "Actor unavailable"}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function QcAllergenActivityReport({
  canRead,
  canManageQc,
}: {
  canRead: boolean;
  canManageQc: boolean;
}) {
  const [selectedDate, setSelectedDate] = useState("");
  const params: GetQcAllergenActivityParams = selectedDate ? { date: selectedDate } : {};
  const query = useGetQcAllergenActivity(params, {
    query: {
      enabled: canRead,
      queryKey: [...getGetQcAllergenActivityQueryKey(params), canManageQc ? "manager-audit" : "staff"],
    },
  });
  const report = query.data;

  return (
    <section className={`${panelClass} min-w-0 space-y-4 p-[min(1rem,4vw)] [overflow-wrap:anywhere] sm:p-5`} aria-labelledby="qc-allergen-activity-title" data-testid="qc-allergen-activity-report">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="qc-allergen-activity-title" className="text-base font-bold">Daily allergen activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only summary of recorded run values and QC events. Missing information stays unavailable or unknown.
          </p>
        </div>
        <label className="block w-full min-w-0 max-w-full sm:w-48">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Production date</span>
          <input
            className="min-h-10 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-[min(.5rem,2vw)] text-sm"
            type="date"
            value={selectedDate || report?.date || ""}
            onChange={(event) => setSelectedDate(event.target.value)}
            aria-label="Production date"
            data-testid="input-allergen-activity-date"
          />
        </label>
      </header>

      {query.isLoading ? (
        <p role="status" className="rounded-lg border border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
          Loading recorded activity…
        </p>
      ) : query.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <span>Daily allergen activity could not be loaded. No empty or clear result is assumed.</span>
          <button type="button" onClick={() => void query.refetch()} className="min-h-10 rounded-md border border-current px-3 font-semibold" data-testid="button-retry-allergen-activity">
            Retry
          </button>
        </div>
      ) : report ? (
        <>
          <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Report source availability">
            <SourceLine title="Ended runs" source={report.sources.endedRuns} />
            <SourceLine title="Active runs" source={report.sources.activeRuns} />
            <SourceLine title="QC events" source={report.sources.qcEvents} />
          </ul>

          {query.isFetching && <p role="status" className="text-xs text-muted-foreground">Updating report…</p>}
          {report.runs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground" data-testid="text-allergen-activity-empty">
              Run details are not available for this date. Check the source status above; the report does not infer that no runs or checks occurred.
            </p>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
              {report.runs.map((run) => (
                <article key={run.runId} className="min-w-0 rounded-xl border border-border/80 bg-background/60 p-[min(1rem,4vw)]" data-testid={`card-allergen-activity-${run.runId}`}>
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-bold [overflow-wrap:anywhere]">{run.label}</h3>
                      <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{run.runId}</p>
                    </div>
                    <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                      {sourceLabel(run.source)}
                    </span>
                  </header>

                  <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 rounded-lg bg-muted/35 p-3">
                      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Manual run-allergen value</dt>
                      <dd className="mt-1 break-words text-sm font-semibold" data-testid={`text-manual-allergen-${run.runId}`}>
                        {run.manualAllergen.status === "recorded"
                          ? `${run.manualAllergen.value} · recorded`
                          : "Unavailable in the run snapshot"}
                      </dd>
                    </div>
                    <div className="min-w-0 rounded-lg bg-muted/35 p-3">
                      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Stored derived review</dt>
                      <dd className="mt-1 text-sm font-semibold" data-testid={`text-derived-review-${run.runId}`}>
                        {reviewLabel(run.derivedReviewState)}
                      </dd>
                    </div>
                  </dl>

                  {run.allergenReviews.length > 0 && (
                    <ul className="mt-3 space-y-2" aria-label={`Recorded derived reviews for ${run.label}`}>
                      {run.allergenReviews.map((review) => (
                        <li key={review.eventId} className="rounded-lg border border-border/70 px-3 py-2.5" data-testid={`card-allergen-review-${review.eventId}`}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <span className="text-xs font-semibold">{reviewLabel(review.state)}</span>
                            <RecordedAt value={review.recordedAt} />
                          </div>
                          {review.allergens && review.allergens.length > 0 && (
                            <p className="mt-2 text-xs">Tracked allergens recorded: {review.allergens.join(", ")}</p>
                          )}
                          {review.unknownIngredients && review.unknownIngredients.length > 0 && (
                            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                              Unknown or unreviewed ingredients: {review.unknownIngredients.join(", ")}
                            </p>
                          )}
                          {review.missingComponents && review.missingComponents.length > 0 && (
                            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                              Components not present in the review: {review.missingComponents.join(", ")}
                            </p>
                          )}
                          {review.note && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">Note: {review.note}</p>}
                          {(review.corrected || review.redactedFields.length > 0) && (
                            <p className="mt-2 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                              {review.corrected ? "Audited correction applied" : ""}
                              {review.corrected && review.redactedFields.length > 0 ? " · " : ""}
                              {review.redactedFields.length > 0 ? "Redaction applied" : ""}
                            </p>
                          )}
                          {canManageQc && review.auditDetails && <AuditDetails entries={review.auditDetails} />}
                        </li>
                      ))}
                    </ul>
                  )}
                  {report.sources.qcEvents.status === "available" && run.derivedReviewState === "no-review" && (
                    <p className="mt-3 text-xs text-muted-foreground">No derived-footprint review event was recorded for this run.</p>
                  )}

                  <div className="mt-4 border-t border-border/70 pt-3">
                    <h4 className="text-xs font-bold">Recorded cleaning and verification events</h4>
                    {report.sources.qcEvents.status === "unavailable" ? (
                      <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">QC event data unavailable; no event state is inferred.</p>
                    ) : run.cleaningEvents.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">No cleaning event was recorded for this run.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {run.cleaningEvents.map((event) => (
                          <li key={event.eventId} className="rounded-lg border border-border/70 px-3 py-2.5" data-testid={`card-cleaning-event-${event.eventId}`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <span className="text-xs font-semibold">
                                Cleaning record{event.method ? ` · ${event.method}` : ""}
                              </span>
                              <RecordedAt value={event.recordedAt} />
                            </div>
                            {(event.startedAt || event.endedAt) && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {event.startedAt ? new Date(event.startedAt).toLocaleString() : "Start unavailable"}
                                {" – "}
                                {event.endedAt ? new Date(event.endedAt).toLocaleString() : "End unavailable"}
                              </p>
                            )}
                            {event.note && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">Note: {event.note}</p>}
                            <p className="mt-2 text-xs">
                              {event.verification.status === "recorded"
                                ? `Independent verification event recorded${event.verification.recordedAt ? ` · ${new Date(event.verification.recordedAt).toLocaleString()}` : ""}`
                                : "No verification event recorded"}
                            </p>
                            {event.verification.note && <p className="mt-1 break-words text-xs text-muted-foreground">Verification note: {event.verification.note}</p>}
                            {canManageQc && event.verification.auditDetails && <AuditDetails entries={event.verification.auditDetails} />}
                            {(event.corrected || event.redactedFields.length > 0) && (
                              <p className="mt-2 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                                {event.corrected ? "Audited correction applied" : ""}
                                {event.corrected && event.redactedFields.length > 0 ? " · " : ""}
                                {event.redactedFields.length > 0 ? "Redaction applied" : ""}
                              </p>
                            )}
                            {canManageQc && event.auditDetails && <AuditDetails entries={event.auditDetails} />}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Recorded activity only. This report does not establish cleaning between runs, clearance, violations, near misses, label claims, or compliance, and it does not change production decisions.
          </p>
        </>
      ) : null}
    </section>
  );
}
