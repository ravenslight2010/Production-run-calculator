import { useState } from "react";
import { Clipboard, ClipboardCheck, Download, ExternalLink, Loader2, Lock, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "../useRole";
import { fetchShiftHandoff, type HandoffItem, type HandoffSeverity, type ShiftHandoffDigest } from "../shiftHandoff";

const severityClass: Record<HandoffSeverity, string> = {
  urgent: "bg-red-500/15 text-red-400",
  high: "bg-red-500/10 text-red-400",
  medium: "bg-amber-500/15 text-amber-500",
  low: "bg-sky-500/15 text-sky-400",
  info: "bg-muted text-muted-foreground",
};
const sourceLabels: Record<HandoffItem["source"], string> = {
  incidents: "Incidents",
  quality: "Quality history",
  inventory: "Inventory",
  sync: "Sync diagnostics",
  "data-health": "Data health",
};

function handoffText(digest: ShiftHandoffDigest): string {
  const lines = ["SHIFT HANDOFF DIGEST", `Facility scope: ${digest.scope}`, `Production date: ${digest.date}`, `Generated: ${digest.generatedAt}`, ""];
  for (const source of Object.keys(sourceLabels) as HandoffItem["source"][]) {
    const state = digest.sources[source];
    lines.push(`${sourceLabels[source].toUpperCase()} — ${state.availability === "available" ? `${state.itemCount} item(s)` : "UNAVAILABLE"}`);
    if (state.note) lines.push(`  ${state.note}`);
    for (const item of digest.items.filter((entry) => entry.source === source)) {
      lines.push(`  [${item.severity.toUpperCase()} / ${item.status}] ${item.title}`, `    ${item.detail}`);
      if (item.affectedRun || item.affectedProduct) lines.push(`    Affected: ${[item.affectedRun && `run ${item.affectedRun}`, item.affectedProduct].filter(Boolean).join(" · ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function fmtWhen(value: string | null): string {
  if (!value) return "Time unavailable";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "Time unavailable" : new Date(parsed).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ShiftHandoffDigest({ onOpenSource }: { onOpenSource?: (source: HandoffItem["source"]) => void }) {
  const { hasCapability } = useMe();
  const allowed = hasCapability("review-incidents");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [copied, setCopied] = useState(false);
  const query = useQuery({ queryKey: ["shift-handoff", date], queryFn: () => fetchShiftHandoff(date), enabled: false, staleTime: 0 });
  if (!allowed) return <Card><CardContent className="py-8 flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> Shift handoff digests are available to managers only.</CardContent></Card>;
  const digest = query.data;
  const download = () => {
    if (!digest) return;
    const url = URL.createObjectURL(new Blob([handoffText(digest)], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `shift-handoff-${digest.scope}-${digest.date}.txt`; anchor.click(); URL.revokeObjectURL(url);
  };
  const copy = async () => {
    if (!digest) return;
    await navigator.clipboard.writeText(handoffText(digest)); setCopied(true); window.setTimeout(() => setCopied(false), 1500);
  };
  return <Card data-testid="shift-handoff-digest">
    <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" /> Daily shift handoff</CardTitle><p className="text-xs text-muted-foreground mt-1">One scoped summary; source workflows remain the system of record.</p></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-muted-foreground">Production date<input aria-label="Handoff production date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="block mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm" /></label>
        <Button size="sm" onClick={() => void query.refetch()} disabled={query.isFetching || !date}>{query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Open digest</Button>
        {digest && <><Button size="sm" variant="outline" onClick={() => void copy()}><Clipboard className="h-4 w-4 mr-1" /> {copied ? "Copied" : "Copy"}</Button><Button size="sm" variant="outline" onClick={download}><Download className="h-4 w-4 mr-1" /> Export .txt</Button></>}
      </div>
      {query.isError && <p className="text-sm text-red-400">Couldn’t load the handoff digest. No source records were changed.</p>}
      {digest && <div className="space-y-3 border-t border-border/60 pt-3">
        <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">{(["urgent", "high", "medium", "low", "info"] as HandoffSeverity[]).map((severity) => <span key={severity} className={`rounded px-2 py-0.5 ${severityClass[severity]}`}>{severity}: {digest.items.filter((item) => item.severity === severity).length}</span>)}</div>
        {digest.items.length === 0 ? <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-500">No unresolved handoff items for this date.</p> : <div className="space-y-2">{digest.items.map((item) => <div key={item.id} className="rounded border border-border bg-background/50 p-3">
          <div className="flex flex-wrap items-start gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${severityClass[item.severity]}`}>{item.severity}</span><span className="text-sm font-semibold">{item.title}</span><span className="text-[10px] rounded bg-muted px-1.5 py-0.5 uppercase">{item.status}</span><span className="ml-auto text-[11px] text-muted-foreground">{item.historical ? "Historical event" : item.status === "current" ? "Current snapshot" : "Needs attention"}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{sourceLabels[item.source]} · {fmtWhen(item.occurredAt)}</p><p className="mt-1 text-sm">{item.detail}</p>
          {(item.affectedRun || item.affectedProduct) && <p className="mt-1 text-xs text-muted-foreground">Affected: {[item.affectedRun && `Run ${item.affectedRun}`, item.affectedProduct].filter(Boolean).join(" · ")}</p>}
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => onOpenSource?.(item.source)}><ExternalLink className="h-3 w-3" /> Open {sourceLabels[item.source]}</button>
        </div>)}</div>}
        <div className="grid gap-1 sm:grid-cols-2 text-[11px] text-muted-foreground">{(Object.keys(sourceLabels) as HandoffItem["source"][]).map((source) => <p key={source}>{sourceLabels[source]}: {digest.sources[source].availability === "available" ? `${digest.sources[source].itemCount} included` : "Unavailable — history not reported as zero"}</p>)}</div>
      </div>}
    </CardContent>
  </Card>;
}