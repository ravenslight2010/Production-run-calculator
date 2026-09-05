import { useMemo, useState } from "react";
import { BarChart2, Download, Lock, Loader2, Share2, Sparkles } from "lucide-react";
import { buildFallbackSummary, type OperationalReport } from "@workspace/day-summary";
import { requestSummary, summaryErrorMessage, type SummaryInput } from "../aiSummary";
import {
  operationalReportText,
  reportFilename,
  shareOperationalReport,
} from "../reportShare";
import { useMe } from "../useRole";

type Props = { buildInput: (scope: "day" | "week", date: string) => SummaryInput };
export type OperationalReportDetailRange = { start: string; end: string; scope: "day" | "week" };

function fmtDate(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function OperationalReportPanel({
  buildInput,
  onOpenQuality,
  onOpenIncidents,
}: Props & {
  onOpenQuality?: (range: OperationalReportDetailRange) => void;
  onOpenIncidents?: (range: OperationalReportDetailRange) => void;
}) {
  const { hasCapability } = useMe();
  const allowed = hasCapability("review-incidents");
  const [scope, setScope] = useState<"day" | "week">("day");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeNarrative, setIncludeNarrative] = useState(false);
  const [narrativeBusy, setNarrativeBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const input = useMemo(() => buildInput(scope, date), [buildInput, scope, date]);
  async function generate() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/reports/operational", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, date, runs: input.runs }),
      });
      if (!response.ok) throw new Error("Report request failed");
      const authoritative = (await response.json()) as OperationalReport;
      setReport(authoritative);
      if (includeNarrative) {
        setNarrativeBusy(true);
        try {
          const narrativeInput: SummaryInput = {
            ...input,
            incidentCount: authoritative.incidents.value?.total,
            wasteFlaggedCount: authoritative.inventory.value?.flaggedItems,
          };
          const result = await requestSummary(narrativeInput);
          setReport({
            ...authoritative,
            narrative: {
              text: result.summary,
              source: result.aiGenerated ? "ai" : "deterministic",
            },
          });
          setStatus(
            result.aiGenerated
              ? "Report ready. Optional AI narration is separated from the authoritative statistics."
              : "Report ready. AI was unavailable, so deterministic fallback narration is shown separately.",
          );
        } catch (narrativeError) {
          setReport({
            ...authoritative,
            narrative: {
              text: buildFallbackSummary(authoritative.production),
              source: "deterministic",
            },
          });
          setStatus(`Report ready. Optional narration used a deterministic fallback: ${summaryErrorMessage(narrativeError)}`);
        } finally {
          setNarrativeBusy(false);
        }
      } else {
        setStatus("Report ready. Statistics are authoritative and deterministic.");
      }
    } catch {
      setError("Couldn’t generate the report. Please try again.");
    } finally {
      setNarrativeBusy(false);
      setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const blob = new Blob([operationalReportText(report)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportFilename(report);
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function share() {
    if (!report) return;
    setShareBusy(true);
    const result = await shareOperationalReport(report);
    setStatus(
      result === "shared"
        ? "Report shared."
        : result === "copied"
          ? "Report copied to the clipboard."
          : "Couldn’t share or copy the report. You can still export the text file.",
    );
    setShareBusy(false);
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-3 text-sm text-muted-foreground">
        <Lock className="w-5 h-5 shrink-0" /> Operational reports are available to managers only.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="operational-report" aria-busy={busy || narrativeBusy}>
      <div className="flex items-center gap-2">
        <BarChart2 className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-bold">Operational report</h2>
          <p className="text-xs text-muted-foreground">Deterministic source statistics for a day or week.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-muted-foreground">
          Scope
          <select value={scope} onChange={(e) => setScope(e.target.value as "day" | "week")} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="day">Day</option><option value="week">Week</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {scope === "week" ? "Week ending" : "Date"}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm" />
        </label>
        <button type="button" onClick={() => void generate()} disabled={busy || !date} className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <><Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> Building…</> : "Preview report"}
        </button>
        <label className="flex min-h-9 items-center gap-2 text-xs font-semibold text-muted-foreground">
          <input
            type="checkbox"
            checked={includeNarrative}
            onChange={(event) => setIncludeNarrative(event.target.checked)}
            disabled={busy || narrativeBusy}
            className="h-4 w-4 rounded border-border"
          />
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Include optional narration
        </label>
        {report && (
          <>
            <button type="button" onClick={download} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50">
              <Download className="w-4 h-4 inline mr-1" /> Export .txt
            </button>
            <button type="button" onClick={() => void share()} disabled={shareBusy} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50 disabled:opacity-50">
              {shareBusy ? <Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> : <Share2 className="w-4 h-4 inline mr-1" />}
              Share
            </button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {status && <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{status}</p>}
      {report && (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground">Scope: {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}. The statistics below are authoritative source values.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              ["Cases", `${report.production.casesProduced}/${report.production.casesPlanned}`],
              ["Attainment", `${report.production.attainmentPct}%`],
              ["Runs finished", `${report.production.runsFinished}/${report.production.runsPlanned}`],
              ["Downtime", `${report.production.totalDowntimeMinutes}m`],
              ["Stoppages", String(report.production.totalStoppages)],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-border/60 bg-muted/20 p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="text-lg font-black tabular-nums">{value}</p></div>)}
          </div>
          {report.production.unfinishedRuns.length > 0 && <p className="text-sm text-amber-400">Unfinished: {report.production.unfinishedRuns.join(", ")}</p>}
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            <div>
              <p>Quality: {report.quality.availability === "available" && report.quality.value ? `${report.quality.value.issues} issue(s)` : `Unavailable${report.quality.note ? ` — ${report.quality.note}` : ""}`}</p>
              {report.quality.availability === "available" && onOpenQuality && <button type="button" className="mt-1 font-semibold text-primary hover:underline" onClick={() => onOpenQuality({ start: report.periodStart, end: report.periodEnd, scope: report.scope })}>Open quality details</button>}
            </div>
            <div>
              <p>Incidents: {report.incidents.availability === "available" && report.incidents.value ? `${report.incidents.value.total} (${report.incidents.value.unresolved} unresolved)` : `Unavailable${report.incidents.note ? ` — ${report.incidents.note}` : ""}`}</p>
              {report.incidents.availability === "available" && onOpenIncidents && <button type="button" className="mt-1 font-semibold text-primary hover:underline" onClick={() => onOpenIncidents({ start: report.periodStart, end: report.periodEnd, scope: report.scope })}>Open incident details</button>}
            </div>
            <p>Inventory flags: {report.inventory.availability === "available" && report.inventory.value ? report.inventory.value.flaggedItems : `Unavailable${report.inventory.note ? ` — ${report.inventory.note}` : ""}`}</p>
          </div>
          {report.inventory.value?.historical && <p className="text-xs text-muted-foreground">Historical inventory events: {report.inventory.value.historical.availability === "available" && report.inventory.value.historical.value ? `${report.inventory.value.historical.value.totalEvents} total · ${report.inventory.value.historical.value.consumptionEvents} consumption · ${report.inventory.value.historical.value.wasteEvents} waste` : `Unavailable${report.inventory.value.historical.note ? ` — ${report.inventory.value.historical.note}` : ""}`}</p>}
          <p className="text-[11px] text-muted-foreground">{report.inventory.note}</p>
          {report.narrative && (
            <section className="rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="operational-report-narrative" aria-label="Optional report narration">
              <p className="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Optional {report.narrative.source === "ai" ? "AI" : "deterministic"} narration
              </p>
              <p className="text-sm text-muted-foreground">{report.narrative.text}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">This narration is informational and does not change the authoritative statistics above.</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}