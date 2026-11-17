import { useState } from "react";
import {
  getGetQcIntelligenceQueryKey,
  useGetQcIntelligence,
  exportQcIntelligenceCsv,
  type ExportQcIntelligenceCsvParams,
  type GetQcIntelligenceParams,
  type QcIntelligenceResultCounts,
  type QcIntelligenceTrendGroup,
} from "@workspace/api-client-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ReportView = GetQcIntelligenceParams["view"];
type Station = NonNullable<GetQcIntelligenceParams["station"]>;
type CheckType = NonNullable<GetQcIntelligenceParams["checkType"]>;

const panelClass = "rounded-xl border border-border/80 bg-card shadow-sm";
const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass = "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground [color-scheme:light] dark:[color-scheme:dark] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const stations: Station[] = ["dough", "sauce", "frontline", "warehouse", "packaging", "other"];

function utcDate(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function daysAgo(count: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - count);
  return utcDate(date);
}

function localDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
}

function shortUtcDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      month: "short",
      day: "2-digit",
    }).format(date);
}

function groupLabel(group: QcIntelligenceTrendGroup): string {
  return [
    group.metric === "weight" ? "Weight" : "Brix",
    group.ingredientName,
    group.station,
    group.checkType,
    `${group.actualUnit}${group.actualUnit === group.targetUnit ? "" : ` / target ${group.targetUnit}`}`,
    group.targetVersion.startsWith("unversioned-event:")
      ? `target version unavailable (${group.targetVersion})`
      : `target ${group.targetVersion}`,
  ].join(" · ");
}

function groupValue(group: QcIntelligenceTrendGroup): string {
  return JSON.stringify([
    group.metric,
    group.ingredientId,
    group.profileKey,
    group.station,
    group.checkType,
    group.actualUnit,
    group.targetUnit,
    group.targetVersion,
    group.ingredientId ? null : group.points[0]?.eventId,
  ]);
}

function countsTable(title: string, groups: QcIntelligenceResultCounts[]) {
  return (
    <section className="min-w-0 rounded-xl border border-border/70 bg-background/50 p-3" aria-label={title}>
      <h3 className="mb-2 text-sm font-bold">{title}</h3>
      {groups.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No recorded checks in this grouping.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="px-2 py-2 font-semibold">Recorded group</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Pass</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Fail</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Not evaluated</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Denominator</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key} className="border-b border-border/50 last:border-0">
                  <th scope="row" className="max-w-56 break-words px-2 py-2 font-medium">{group.label}</th>
                  <td className="px-2 py-2 text-right tabular-nums">{group.pass}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{group.fail}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{group.notEvaluated}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{group.denominator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function QcIntelligenceReport({ canManageQc }: { canManageQc: boolean }) {
  const [view, setView] = useState<ReportView>("trends");
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => utcDate());
  const [station, setStation] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [runId, setRunId] = useState("");
  const [checkType, setCheckType] = useState("");
  const [selectedTrendKey, setSelectedTrendKey] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const params: GetQcIntelligenceParams = {
    view,
    from,
    to,
    limit: 1_000,
    ...(station ? { station: station as Station } : {}),
    ...(ingredientId.trim() ? { ingredientId: ingredientId.trim() } : {}),
    ...(runId.trim() ? { runId: runId.trim() } : {}),
    ...(checkType ? { checkType: checkType as CheckType } : {}),
  };
  const query = useGetQcIntelligence(params, {
    query: {
      enabled: canManageQc && Boolean(from) && Boolean(to),
      queryKey: [...getGetQcIntelligenceQueryKey(params), "qc-manager"],
    },
  });
  const report = canManageQc ? query.data : undefined;
  const trendReport = report?.view === "trends" ? report : null;
  const resultsReport = report?.view === "results" ? report : null;
  const traceReport = report?.view === "traceability" ? report : null;
  const visibleTrendGroups = trendReport?.groups ?? [];
  const reportHasError = query.isError || query.isRefetchError;
  const retryingAfterFailure = query.failureCount > 0 && query.fetchStatus === "fetching";
  const queryRequestState = retryingAfterFailure
    ? "retrying"
    : reportHasError
      ? "error"
      : query.isLoading
        ? "loading"
        : query.isFetching
          ? "refreshing"
          : "ready";
  const selectedGroup = visibleTrendGroups.find((group) => groupValue(group) === selectedTrendKey)
    ?? visibleTrendGroups[0];
  const visibleMeasurementCount = visibleTrendGroups.reduce((count, group) => count + group.points.length, 0);

  async function downloadCsv() {
    setExporting(true);
    setExportError("");
    try {
      const exportParams: ExportQcIntelligenceCsvParams = params;
      const csvText = await exportQcIntelligenceCsv(exportParams, { responseType: "text" });
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `qc-${view}-${from}-to-${to}.csv`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setExportError("The filtered CSV could not be downloaded. The report data was not changed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section
      className={`${panelClass} min-w-0 space-y-4 p-4 sm:p-5`}
      aria-labelledby="qc-intelligence-title"
      data-testid="qc-intelligence-report"
      data-qc-request-state={queryRequestState}
      data-qc-failure-count={query.failureCount}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 id="qc-intelligence-title" className="text-base font-bold">QC intelligence reports</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Advisory summaries of recorded checks and lot-to-run evidence. Missing checks are not counted as passes.
          </p>
        </div>
        <button
          type="button"
          className={buttonClass}
          onClick={() => void downloadCsv()}
          disabled={!canManageQc || exporting || !report}
          data-testid="button-export-qc-intelligence"
        >
          {exporting ? "Preparing CSV…" : "Export filtered CSV"}
        </button>
      </header>

      <div
        className="grid min-w-0 gap-3 rounded-xl border border-border/70 bg-background/50 p-3 sm:grid-cols-2 lg:grid-cols-4"
        role="group"
        aria-label="QC intelligence report filters"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void query.refetch();
          }
        }}
      >
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">From (UTC date)</span>
          <input className={fieldClass} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From UTC date" />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Through (UTC date)</span>
          <input className={fieldClass} type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Through UTC date" />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Station</span>
          <select className={fieldClass} value={station} onChange={(event) => setStation(event.target.value)} aria-label="Station filter">
            <option value="">All stations</option>
            {stations.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Check timing</span>
          <select className={fieldClass} value={checkType} onChange={(event) => setCheckType(event.target.value)} aria-label="Check timing filter">
            <option value="">All timings</option>
            <option value="pre-run">Pre-run</option>
            <option value="30-minute">30-minute</option>
            <option value="interval">Interval</option>
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Ingredient ID</span>
          <input className={fieldClass} value={ingredientId} onChange={(event) => setIngredientId(event.target.value)} maxLength={200} placeholder="All ingredients" aria-label="Ingredient ID filter" />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Run ID</span>
          <input className={fieldClass} value={runId} onChange={(event) => setRunId(event.target.value)} maxLength={200} placeholder="All runs" aria-label="Run ID filter" />
        </label>
        <div className="flex min-w-0 items-end">
          <button type="button" onClick={() => void query.refetch()} className={`${buttonClass} w-full`} disabled={!canManageQc || query.isFetching} data-testid="button-apply-qc-intelligence-filters">
            {query.isFetching ? "Updating…" : "Apply filters"}
          </button>
        </div>
      </div>

      <nav className="flex min-w-0 flex-wrap gap-2" aria-label="QC intelligence report type">
        {([
          ["trends", "Weight and Brix trends"],
          ["results", "Recorded outcomes"],
          ["traceability", "Lot traceability"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={buttonClass}
            aria-pressed={view === key}
            onClick={() => setView(key)}
            data-testid={`button-qc-intelligence-${key}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {exportError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{exportError}</p>}
      {retryingAfterFailure ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <span>The QC report refresh failed; retrying. No current result is shown. No empty or passing result is assumed.</span>
          <button type="button" className={buttonClass} onClick={() => void query.refetch()} data-testid="button-retry-qc-intelligence">Retry now</button>
        </div>
      ) : query.isLoading ? (
        <p role="status" className="rounded-lg border border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground">Loading bounded QC report…</p>
      ) : reportHasError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <span>The QC report could not be loaded. No empty or passing result is assumed.</span>
          <button type="button" className={buttonClass} onClick={() => void query.refetch()} data-testid="button-retry-qc-intelligence">Retry</button>
        </div>
      ) : report ? (
        <>
          <section className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3" aria-label="Report coverage and applied filters" data-testid="qc-intelligence-coverage">
            <p className="text-sm font-semibold">
              Date basis: event recorded at (UTC). Applied range {report.filters.from.slice(0, 10)} through {report.filters.to.slice(0, 10)}.
            </p>
            <p className="text-xs text-muted-foreground">
              Filters: {report.filters.station ?? "all stations"} · {report.filters.ingredientId ?? "all ingredients"} · {report.filters.runId ?? "all runs"} · {report.filters.checkType ?? "all check timings"}.
            </p>
            <p className="text-xs text-muted-foreground">
              Coverage: {report.coverage.status}; {report.coverage.includedEvents} effective records included from {report.coverage.sampledEvents} sampled (limit {report.coverage.maxEvents}).
              {report.coverage.reason ? ` Partial reason: ${report.coverage.reason.replaceAll("-", " ")}.` : ""}
            </p>
            {report.coverage.reason === "overlay-limit" && (
              <p role="alert" className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Correction/redaction evidence exceeded the safe lookup limit. No values or outcomes are included until the effective overlay set can be read completely.
              </p>
            )}
            <p className="text-xs text-muted-foreground">Denominators count recorded checks only. Unrecorded checks are not included as passes.</p>
            <p className="text-xs text-muted-foreground">Historical readings without a retained target version stay in separate per-event contexts; no shared version is inferred.</p>
          </section>

          {trendReport && (
            <div className="space-y-3" data-testid="qc-intelligence-trends">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold">Measurement trends</h3>
                <p className="text-xs text-muted-foreground">
                  {visibleMeasurementCount} recorded measurements across {visibleTrendGroups.length} unit and target contexts · {trendReport.redactedMeasurementsExcluded} redacted values excluded
                </p>
              </div>
              {visibleTrendGroups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground" data-testid="text-qc-intelligence-empty">
                  No visible measurements match these filters. This does not mean no QC checks occurred.
                </p>
              ) : (
                <>
                  <label className="block min-w-0 max-w-full sm:max-w-2xl">
                    <span className="mb-1 block text-xs font-semibold text-muted-foreground">Trend context (unit and target version kept separate)</span>
                    <select className={fieldClass} value={selectedGroup ? groupValue(selectedGroup) : ""} onChange={(event) => setSelectedTrendKey(event.target.value)} aria-label="Trend context">
                      {visibleTrendGroups.map((group) => <option key={groupValue(group)} value={groupValue(group)}>{groupLabel(group)}</option>)}
                    </select>
                  </label>
                  {selectedGroup && (
                    <section className="min-w-0 rounded-xl border border-border/70 bg-background/50 p-3" aria-label={`${selectedGroup.metric} measurement trend`} data-testid="qc-intelligence-trend-chart">
                      <h4 className="break-words text-sm font-semibold">{groupLabel(selectedGroup)}</h4>
                      <div role="img" aria-label={`${selectedGroup.metric} actual and target trend, in ${selectedGroup.actualUnit}`} className="mt-3 h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={selectedGroup.points} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="recordedAt" tickFormatter={shortUtcDate} minTickGap={24} />
                            <YAxis width={56} unit={` ${selectedGroup.actualUnit}`} />
                            <Tooltip labelFormatter={(value) => localDateTime(String(value))} />
                            <Legend />
                            <Line type="monotone" dataKey="actual" name={`Measured (${selectedGroup.actualUnit})`} stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                            {selectedGroup.actualUnit === selectedGroup.targetUnit && (
                              <Line type="monotone" dataKey="target" name={`Target (${selectedGroup.targetUnit})`} stroke="#d97706" strokeDasharray="5 4" dot={false} />
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-left text-xs" aria-label="Trend values and outcomes">
                          <thead><tr className="border-b border-border text-muted-foreground">
                            <th scope="col" className="px-2 py-2">Recorded at (UTC)</th><th scope="col" className="px-2 py-2 text-right">Actual ({selectedGroup.actualUnit})</th>
                            <th scope="col" className="px-2 py-2 text-right">Target ({selectedGroup.targetUnit})</th><th scope="col" className="px-2 py-2 text-right">Tolerance</th><th scope="col" className="px-2 py-2">Outcome</th>
                          </tr></thead>
                          <tbody>
                            {selectedGroup.points.map((point) => (
                              <tr key={point.eventId} className="border-b border-border/50 last:border-0">
                                <td className="px-2 py-2"><time dateTime={point.recordedAt}>{localDateTime(point.recordedAt)}</time></td>
                                <td className="px-2 py-2 text-right tabular-nums">{point.actual}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{point.target ?? "Not configured"}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{point.tolerance ?? "—"}</td>
                                <td className="px-2 py-2">{point.outcome.replaceAll("-", " ")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {resultsReport && (
            <div className="space-y-3" data-testid="qc-intelligence-results">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold">Recorded check outcomes</h3>
                <p className="text-xs text-muted-foreground">Denominator: {resultsReport.recordedChecks} recorded checks in this report.</p>
              </div>
              {resultsReport.recordedChecks === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground" data-testid="text-qc-intelligence-empty">
                  No recorded checks match these filters. Missing checks remain unknown.
                </p>
              ) : (
                <div className="grid min-w-0 gap-3 xl:grid-cols-3">
                  {countsTable("By check type", resultsReport.byCheckType)}
                  {countsTable("By station", resultsReport.byStation)}
                  {countsTable("By ingredient", resultsReport.byIngredient)}
                </div>
              )}
            </div>
          )}

          {traceReport && (
            <div className="space-y-3" data-testid="qc-intelligence-traceability">
              <h3 className="text-sm font-bold">Recorded lot-to-run evidence</h3>
              <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                Customer and shipment links are unavailable because no explicit lot-to-customer relation is stored. Inventory transfers are not treated as shipments.
              </p>
              {traceReport.lots.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground" data-testid="text-qc-intelligence-empty">
                  No recorded lot evidence matches these filters. This is not proof that no lots were used.
                </p>
              ) : (
                <ul className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {traceReport.lots.map((lot) => (
                    <li key={lot.eventId} className="min-w-0 rounded-xl border border-border/70 bg-background/50 p-3" data-testid={`qc-intelligence-lot-${lot.eventId}`}>
                      <h4 className="break-words text-sm font-bold">
                        {lot.lotNumberStatus === "redacted" ? "Lot value redacted" : lot.lotNumber ?? "Lot value unavailable"}
                      </h4>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {lot.ingredientName ?? "Ingredient unavailable"} · {lot.station}
                      </p>
                      <p className="mt-2 break-all font-mono text-xs">{lot.run?.runId ?? "Run identity unavailable"}</p>
                      {lot.run?.status === "available" ? (
                        <p className="mt-1 break-words text-xs">
                          {lot.run.label ?? "Canonical run label unavailable"} · {lot.run.productionDate} · {lot.run.source === "completed-run-snapshot" ? "completed snapshot" : "current-day state"}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">Canonical run record unavailable; no name-based match was made.</p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        <time dateTime={lot.recordedAt}>{localDateTime(lot.recordedAt)}</time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {query.isFetching && <p role="status" className="text-xs text-muted-foreground">Updating report…</p>}
        </>
      ) : (
        <p role="status" className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          QC manager access is required to view these reports.
        </p>
      )}
    </section>
  );
}
