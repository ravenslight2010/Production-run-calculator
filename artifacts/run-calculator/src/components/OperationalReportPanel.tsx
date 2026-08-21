import { useMemo, useState } from "react";
import { BarChart2, Download, Lock, Loader2 } from "lucide-react";
import type { OperationalReport } from "@workspace/day-summary";
import type { SummaryInput } from "../aiSummary";
import { useMe } from "../useRole";

type Props = { buildInput: (scope: "day" | "week", date: string) => SummaryInput };

function fmtDate(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function reportText(report: OperationalReport): string {
  const p = report.production;
  const lines = [
    `OPERATIONAL ${report.scope.toUpperCase()} REPORT`,
    `Period: ${report.periodStart} to ${report.periodEnd} (scope date: ${report.date})`,
    `Generated: ${report.generatedAt}`,
    "",
    "SOURCE STATISTICS",
    `Runs: ${p.runsFinished} finished of ${p.runsPlanned} planned`,
    `Cases: ${p.casesProduced} produced of ${p.casesPlanned} planned (${p.attainmentPct}% attainment)`,
    `Downtime: ${p.totalDowntimeMinutes} minutes across ${p.totalStoppages} stoppages`,
    `Unfinished runs: ${p.unfinishedRuns.length ? p.unfinishedRuns.join(", ") : "None recorded"}`,
    "",
    report.quality.availability === "available"
      ? `Quality: ${report.quality.value?.checks ?? 0} checks, ${report.quality.value?.issues ?? 0} issues, ${report.quality.value?.failed ?? 0} failed, ${report.quality.value?.warnings ?? 0} warnings`
      : `Quality: Unavailable${report.quality.note ? ` — ${report.quality.note}` : ""}`,
    report.incidents.availability === "available"
      ? `Incidents: ${report.incidents.value?.total ?? 0} total, ${report.incidents.value?.unresolved ?? 0} unresolved`
      : `Incidents: Unavailable${report.incidents.note ? ` — ${report.incidents.note}` : ""}`,
    report.inventory.availability === "available"
      ? `Inventory flags: ${report.inventory.value?.flaggedItems ?? 0} items at or below reorder level${report.inventory.note ? ` (${report.inventory.note})` : ""}`
      : `Inventory: Unavailable${report.inventory.note ? ` — ${report.inventory.note}` : ""}`,
  ];
  return lines.join("\n");
}

export default function OperationalReportPanel({ buildInput }: Props) {
  const { hasCapability } = useMe();
  const allowed = hasCapability("review-incidents");
  const [scope, setScope] = useState<"day" | "week">("day");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<OperationalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const input = useMemo(() => buildInput(scope, date), [buildInput, scope, date]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports/operational", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, date, runs: input.runs }),
      });
      if (!response.ok) throw new Error("Report request failed");
      setReport((await response.json()) as OperationalReport);
    } catch {
      setError("Couldn’t generate the report. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const blob = new Blob([reportText(report)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `operational-${report.scope}-${report.date}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-3 text-sm text-muted-foreground">
        <Lock className="w-5 h-5 shrink-0" /> Operational reports are available to managers only.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="operational-report">
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
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Preview report"}
        </button>
        {report && <button type="button" onClick={download} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted/50"><Download className="w-4 h-4 inline mr-1" /> Export .txt</button>}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {report && (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground">Scope: {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}. Values below are source statistics; no AI was used.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ["Cases", `${report.production.casesProduced}/${report.production.casesPlanned}`],
              ["Attainment", `${report.production.attainmentPct}%`],
              ["Runs finished", `${report.production.runsFinished}/${report.production.runsPlanned}`],
              ["Downtime", `${report.production.totalDowntimeMinutes}m`],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-border/60 bg-muted/20 p-3"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="text-lg font-black tabular-nums">{value}</p></div>)}
          </div>
          {report.production.unfinishedRuns.length > 0 && <p className="text-sm text-amber-400">Unfinished: {report.production.unfinishedRuns.join(", ")}</p>}
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            <p>Quality: {report.quality.value?.issues ?? "Unavailable"} issue(s)</p>
            <p>Incidents: {report.incidents.value?.total ?? "Unavailable"} ({report.incidents.value?.unresolved ?? "—"} unresolved)</p>
            <p>Inventory flags: {report.inventory.value?.flaggedItems ?? "Unavailable"}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{report.inventory.note}</p>
        </div>
      )}
    </div>
  );
}