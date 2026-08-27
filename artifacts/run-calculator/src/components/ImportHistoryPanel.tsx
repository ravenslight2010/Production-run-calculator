import { useEffect, useState } from "react";
import { CircleAlert, History, Play, RefreshCw, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchImportHistory,
  importReconciliationRows,
  requiredImportAction,
  pendingImportHistoryCount,
  retryPendingImportHistory,
  SUPPORTED_IMPORTERS,
  type ImportHistoryImportType,
  type ImportHistoryItem,
  type ImportHistoryReopenRequest,
} from "@/importHistory";

function date(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function ImportHistoryPanel({
  refreshSignal = 0,
  onReopen,
  onRetry,
  onStart,
  enabledImporters,
}: {
  refreshSignal?: number;
  onReopen?: (request: Omit<ImportHistoryReopenRequest, "requestId">) => void;
  /** Opens the original-source picker; the import is always reviewed again. */
  onRetry?: (item: ImportHistoryItem) => void;
  onStart?: (type: ImportHistoryImportType) => void;
  enabledImporters?: ReadonlySet<ImportHistoryImportType>;
}) {
  const [items, setItems] = useState<ImportHistoryItem[]>([]);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationItems, setOperationItems] = useState<ImportHistoryItem[]>([]);
  const [retryingAudit, setRetryingAudit] = useState(false);
  const [auditRecovery, setAuditRecovery] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [filtered, unfiltered] = await Promise.all([
        fetchImportHistory({ type, status, customer }),
        enabledImporters ? fetchImportHistory() : Promise.resolve(null),
      ]);
      setItems(filtered);
      setOperationItems(unfiltered ?? filtered);
    }
    catch { setError("Couldn't load import history."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [refreshSignal, type, status, customer]);
  useEffect(() => {
    const notice = () => {
      const count = pendingImportHistoryCount();
      setAuditRecovery(count
        ? `${count} audit record${count === 1 ? "" : "s"} waiting to be saved.`
        : null);
    };
    notice();
    window.addEventListener("import-history-pending", notice);
    return () => window.removeEventListener("import-history-pending", notice);
  }, [refreshSignal]);
  async function retryAuditRecovery() {
    setRetryingAudit(true);
    const result = await retryPendingImportHistory();
    setAuditRecovery(result.remaining
      ? `${result.remaining} audit record${result.remaining === 1 ? "" : "s"} still waiting to be saved.`
      : result.saved
        ? "Audit record saved."
        : "No pending audit records are available for this account and scope.");
    setRetryingAudit(false);
    if (result.saved) await refresh();
  }
  const latestByType = new Map<ImportHistoryImportType, ImportHistoryItem>();
  for (const item of operationItems) if (!latestByType.has(item.importType)) latestByType.set(item.importType, item);

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
        {enabledImporters && (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3" data-testid="import-operations-status">
            <div>
              <p className="text-sm font-semibold">Importer operations</p>
              <p className="text-xs text-muted-foreground">Each import remains review-first. Partial and failed work can be resumed from a saved review or retried with the original source.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUPPORTED_IMPORTERS.map((importer) => {
                const latest = latestByType.get(importer.type);
                const enabled = enabledImporters.has(importer.type);
                const label = !enabled
                  ? "Access required"
                  : latest?.status === "failed"
                    ? "Retry required"
                    : latest?.status === "partial"
                      ? "Review required"
                      : latest
                        ? "Complete"
                        : "Ready";
                // Status is expressed in the label itself; foreground text
                // keeps the small 11px label legible in both themes.
                const tone = "text-foreground";
                return (
                  <div key={importer.type} className="rounded border border-border bg-background/70 p-2.5" data-testid={`import-operation-${importer.type}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{importer.label}</p>
                        <p className="text-[11px] text-muted-foreground">{importer.description}</p>
                      </div>
                      <span className={`shrink-0 text-[11px] font-semibold ${tone}`}>{label}</span>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">Next:</span> {latest ? requiredImportAction(latest) : enabled ? "Select a source file and review it before applying changes." : "Ask a manager with the required access to run this importer."}
                    </p>
                    {enabled && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {latest && latest.status !== "complete" && onRetry ? (
                          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onRetry(latest)}>
                            <RotateCcw className="mr-1 h-3 w-3" /> {latest.snapshotId != null && (latest.importType === "spec" || latest.importType === "premix" || latest.importType === "cheese") ? "Resume review" : "Retry import"}
                          </Button>
                        ) : onStart ? (
                          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onStart(importer.type)}>
                            <Play className="mr-1 h-3 w-3" /> Start import
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {auditRecovery ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
            <span>{auditRecovery}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void retryAuditRecovery()} disabled={retryingAudit}>
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${retryingAudit ? "animate-spin" : ""}`} /> Retry audit save
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <input aria-label="Filter import history by customer scope" className="rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="Customer scope" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <select aria-label="Filter import history by import type" className="rounded-md border border-border bg-background px-2 py-1 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All import types</option><option value="spec">Spec sheets</option><option value="premix">Premix sheets</option><option value="cheese">Cheese</option><option value="sauce">Sauce</option><option value="dough">Dough</option><option value="schedule">Schedule</option><option value="shipping">Shipping</option><option value="recipe">Recipe</option>
          </select>
          <select aria-label="Filter import history by outcome" className="rounded-md border border-border bg-background px-2 py-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
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
                    <span className="min-w-0"><span className="font-medium">{item.sourceLabel}</span><span className="ml-2 text-xs text-muted-foreground">{date(item.createdAt)} · {item.importType}</span>{item.customerScope ? <span className="block text-xs text-muted-foreground">Customer: {item.customerScope}</span> : null}</span>
                    <Badge variant={item.status === "complete" ? "secondary" : item.status === "partial" ? "outline" : "destructive"}>{item.status}</Badge>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {Object.entries(counts).map(([key, value]) => <span key={key} className="rounded bg-muted px-2 py-0.5">{key}: {value}</span>)}
                  </div>
                  {isOpen && <div className="mt-3 space-y-2 border-t border-border pt-2 text-xs">
                    {importReconciliationRows(s).length > 0 ? (
                      <div className="rounded border border-border/70 p-2">
                        <p className="mb-1 font-medium">Source → landed reconciliation</p>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 gap-y-1 text-[11px]">
                          <span className="font-medium text-muted-foreground">Item</span><span className="font-medium text-muted-foreground">Source</span><span className="font-medium text-muted-foreground">Landed</span><span className="font-medium text-muted-foreground">Delta</span>
                          {importReconciliationRows(s).map((row) => (
                            <div key={row.label} className="contents">
                              <span className="truncate">{row.label}</span>
                              <span>{row.source ?? "—"}</span>
                              <span>{row.landed ?? "—"}</span>
                              <span className={row.delta && row.delta !== 0 ? "text-amber-700 dark:text-amber-400" : ""}>{row.delta == null ? "—" : row.delta > 0 ? `+${row.delta}` : row.delta}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {s.components && Object.keys(s.components).length > 0 ? <p><b>Components:</b> {Object.entries(s.components).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p> : null}
                    {s.links && Object.keys(s.links).length > 0 ? <p><b>Links:</b> {Object.entries(s.links).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p> : null}
                    <p><b>Phases:</b> {Object.entries(s.phases ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Not recorded"}</p>
                    <p className="rounded bg-muted p-2"><b>Required manager action:</b> {requiredImportAction(item)}</p>
                    {s.mismatches?.length ? <p className="rounded bg-amber-500/10 p-2 text-amber-800"><CircleAlert className="mr-1 inline h-3.5 w-3.5" /><b>Mismatch:</b> {s.mismatches.join(" ")}</p> : null}
                    {s.warnings?.length ? <p><b>Warnings:</b> {s.warnings.join(" ")}</p> : null}
                    {s.unresolved?.length ? <p><b>Unresolved:</b> {s.unresolved.join(" ")}</p> : null}
                    {s.skipped?.length ? <p><b>Skipped:</b> {s.skipped.join(" ")}</p> : null}
                    {s.followUp?.length ? <p className="text-amber-700"><b>Follow-up:</b> {s.followUp.join(" ")}</p> : null}
                    {s.changes?.length ? (
                      <div>
                        <p><b>Reviewed changes:</b></p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {s.changes.map((change, index) => (
                            <li key={`${change.kind}-${change.entity}-${index}`}>
                              <span className="font-medium">{change.kind.replace("-", " ")}:</span> {change.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {item.snapshotId != null && onReopen && (item.importType === "spec" || item.importType === "premix" || item.importType === "cheese") ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onReopen({ importType: item.importType as "spec" | "premix" | "cheese", snapshotId: item.snapshotId! })}
                      >
                        Reopen saved review / scoped repair
                      </Button>
                    ) : item.status !== "complete" && onRetry ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => onRetry(item)}>
                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry with original source
                      </Button>
                    ) : (
                      <p className="text-muted-foreground">This record keeps the committed changes, but no saved source snapshot is available for scoped repair.</p>
                    )}
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