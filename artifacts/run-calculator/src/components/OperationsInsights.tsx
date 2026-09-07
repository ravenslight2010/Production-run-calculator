import { useState } from "react";
import { AlertTriangle, Check, FileText, Gauge, ListOrdered, Loader2, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type SummaryInput, type SummaryResult, type SummaryScope, requestSummary, summaryErrorMessage } from "../aiSummary";
import { requestAnomalies, type AnomalyResult, type AnomalyRunInput, type AnomalySeverity, requestScheduleOptimize, type ScheduleOptimizeResult, type ScheduleRunInput } from "../inventoryShared";

const severityClass: Record<AnomalySeverity, string> = {
  high: "bg-red-500/15 text-red-400", medium: "bg-amber-500/15 text-amber-400", low: "bg-sky-500/15 text-sky-400",
};

export default function OperationsInsights({
  buildSummary, buildAnomaly, buildSchedule, onApplySchedule,
}: {
  buildSummary: (scope: SummaryScope) => SummaryInput;
  buildAnomaly: () => { today: AnomalyRunInput[]; history: AnomalyRunInput[] };
  buildSchedule: () => ScheduleRunInput[];
  onApplySchedule: (order: string[]) => { ok: boolean; message: string; undo?: () => void };
}) {
  const [scope, setScope] = useState<SummaryScope>("day");
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyResult | null>(null);
  const [schedule, setSchedule] = useState<ScheduleOptimizeResult | null>(null);
  const [scheduleRuns, setScheduleRuns] = useState<ScheduleRunInput[]>([]);
  const [loading, setLoading] = useState<"summary" | "anomaly" | "schedule" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  async function loadSummary(next: SummaryScope) {
    setScope(next); setLoading("summary"); setError(null);
    try { setSummary(await requestSummary(buildSummary(next))); } catch (e) { setError(summaryErrorMessage(e)); } finally { setLoading(null); }
  }
  async function checkAnomalies() {
    setLoading("anomaly"); setError(null);
    try { const input = buildAnomaly(); setAnomalies(await requestAnomalies(input.today, input.history)); } catch (e) { setError(summaryErrorMessage(e)); } finally { setLoading(null); }
  }
  async function optimizeSchedule() {
    setLoading("schedule"); setError(null); setApplyMessage(null); setUndo(null);
    try { const input = buildSchedule(); setScheduleRuns(input); setSchedule(await requestScheduleOptimize(input)); } catch (e) { setError(summaryErrorMessage(e)); } finally { setLoading(null); }
  }
  return <div className="space-y-4 pb-24">
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />Production Recap</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="flex gap-2">{(["day", "week"] as const).map((next) => <Button key={next} className="flex-1" variant={scope === next ? "default" : "outline"} disabled={loading !== null} onClick={() => void loadSummary(next)}>{loading === "summary" && scope === next ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{next === "day" ? "Today" : "This week"}</Button>)}</div>
      {summary && <div data-testid="summary-result"><p className="text-sm" data-testid="summary-text">{summary.summary}</p>{summary.stats?.hasData && <p className="mt-2 text-xs text-muted-foreground">{summary.stats.runsFinished}/{summary.stats.runsPlanned} runs finished · {summary.stats.attainmentPct}% attainment · {summary.stats.casesProduced} cases made · {summary.stats.totalDowntimeMinutes}m downtime</p>}</div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5 text-primary" />Anomaly Check</CardTitle><p className="text-xs text-muted-foreground">Deterministically compares downtime, yield, and stoppages with recent history.</p></CardHeader><CardContent className="space-y-3">
      <Button className="w-full" disabled={loading !== null} onClick={() => void checkAnomalies()} data-testid="button-anomaly-check">{loading === "anomaly" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gauge className="mr-2 h-4 w-4" />}{anomalies ? "Re-check" : "Check for anomalies"}</Button>
      {anomalies?.note ? <p className="text-sm text-muted-foreground">{anomalies.note}</p> : anomalies && anomalies.anomalies.length === 0 ? <p className="flex gap-2 text-sm text-emerald-400"><Check className="h-4 w-4" />Nothing unusual across {anomalies.checkedRuns} runs today.</p> : anomalies?.anomalies.map((item, index) => <div key={index} className="rounded-lg border border-border p-3" data-testid={`anomaly-item-${index}`}><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${severityClass[item.severity]}`}>{item.severity}</span><span className="ml-2 text-sm font-medium">{item.runLabel}</span><p className="mt-1 text-sm text-muted-foreground">{item.description}</p></div>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ListOrdered className="h-5 w-5 text-primary" />Schedule Order</CardTitle><p className="text-xs text-muted-foreground">Uses production rules, allergen sequence, and changeover grouping. Apply remains explicit.</p></CardHeader><CardContent className="space-y-3">
      <Button className="w-full" disabled={loading !== null} onClick={() => void optimizeSchedule()} data-testid="button-schedule-optimize">{loading === "schedule" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ListOrdered className="mr-2 h-4 w-4" />}{schedule ? "Recalculate order" : "Calculate order"}</Button>
      {schedule?.improved && <><ol className="space-y-1 rounded-lg border border-border p-3">{schedule.order.map((id, index) => <li key={id} data-testid={`schedule-order-${index}`}>{index + 1}. {scheduleRuns.find((run) => run.id === id)?.label ?? id}</li>)}</ol><p className="text-xs text-muted-foreground">Changeovers {schedule.before.changeovers} → {schedule.after.changeovers} · rule issues {schedule.before.ruleViolations} → {schedule.after.ruleViolations}</p><Button className="w-full" variant="secondary" onClick={() => { const result = onApplySchedule(schedule.order); setApplyMessage(result.message); setUndo(() => result.undo ?? null); }} data-testid="button-schedule-apply">Apply this order</Button></>}
      {schedule?.note && !schedule.improved && <p className="text-sm text-muted-foreground">{schedule.note}</p>}
      {applyMessage && <p className="flex items-center justify-between text-sm">{applyMessage}{undo && <button type="button" className="text-primary" onClick={() => { undo(); setUndo(null); setApplyMessage("Order restored"); }}><Undo2 className="mr-1 inline h-3.5 w-3.5" />Undo</button>}</p>}
    </CardContent></Card>
    {error && <p className="flex gap-2 rounded border border-red-500/30 p-3 text-xs text-red-400"><AlertTriangle className="h-4 w-4" />{error}</p>}
  </div>;
}