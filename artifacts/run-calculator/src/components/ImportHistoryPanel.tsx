import { useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchImportHistory, type ImportHistoryItem } from "@/importHistory";

function date(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function ImportHistoryPanel({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [items, setItems] = useState<ImportHistoryItem[]>([]);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try { setItems(await fetchImportHistory({ type, status, customer })); }
    catch { setError("Couldn't load import history."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [refreshSignal, type, status, customer]);

  return (
    <Card data-testid="import-history-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><History className="h-4 w-4" /> Import review history</span>
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input className="rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="Customer scope" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <select className="rounded-md border border-border bg-background px-2 py-1 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All import types</option><option value="spec">Spec sheets</option><option value="premix">Premix sheets</option>
          </select>
          <select className="rounded-md border border-border bg-background px-2 py-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All outcomes</option><option value="complete">Complete</option><option value="partial">Partial</option><option value="failed">Failed</option>
          </select>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : loading ? <p className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? <p className="text-sm text-muted-foreground">No workbook imports recorded yet.</p> : (
          <div className="space-y-2">
            {items.map((item) => {
              const s = item.summary ?? {};
              const counts = s.counts ?? {};
              const isOpen = expanded === item.id;
              return (
                <div key={item.id} className="rounded-md border border-border p-3" data-testid={`import-history-${item.id}`}>
                  <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setExpanded(isOpen ? null : item.id)}>
                    <span className="min-w-0"><span className="font-medium">{item.sourceLabel}</span><span className="ml-2 text-xs text-muted-foreground">{date(item.createdAt)} · {item.importType === "spec" ? "Spec" : "Premix"}</span>{item.customerScope ? <span className="block text-xs text-muted-foreground">Customer: {item.customerScope}</span> : null}</span>
                    <Badge variant={item.status === "complete" ? "secondary" : item.status === "partial" ? "outline" : "destructive"}>{item.status}</Badge>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {Object.entries(counts).map(([key, value]) => <span key={key} className="rounded bg-muted px-2 py-0.5">{key}: {value}</span>)}
                  </div>
                  {isOpen && <div className="mt-3 space-y-2 border-t border-border pt-2 text-xs">
                    <p><b>Phases:</b> {Object.entries(s.phases ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Not recorded"}</p>
                    {s.warnings?.length ? <p><b>Warnings:</b> {s.warnings.join(" ")}</p> : null}
                    {s.unresolved?.length ? <p><b>Unresolved:</b> {s.unresolved.join(" ")}</p> : null}
                    {s.skipped?.length ? <p><b>Skipped:</b> {s.skipped.join(" ")}</p> : null}
                    {s.followUp?.length ? <p className="text-amber-700"><b>Follow-up:</b> {s.followUp.join(" ")}</p> : null}
                    <p className="text-muted-foreground">This record keeps the committed changes. Reopen the retained {item.importType === "spec" ? "spec cross-reference" : "mix monitoring"} panel to review the saved snapshot without uploading again.</p>
                  </div>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}