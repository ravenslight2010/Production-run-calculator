import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ExternalLink, History, Loader2, RefreshCw, ShieldCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyDataHealthRepairs,
  fetchDataHealthWorkspace,
  undoProfileDataHealthRepair,
  type DataHealthFinding,
  type DataHealthWorkspace as DataHealthWorkspaceData,
} from "@/profileDataHealth";

type Props = { onNavigate?: (section: string) => void };

const selectClass = "rounded border border-border bg-background px-2 py-1.5 text-xs";

function severityClass(severity: DataHealthFinding["severity"]): string {
  return severity === "error"
    ? "bg-destructive/15 text-destructive"
    : severity === "warning"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-muted text-muted-foreground";
}

export default function DataHealthWorkspace({ onNavigate }: Props) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [brand, setBrand] = useState("all");
  const [repairability, setRepairability] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const [selectedRepairIds, setSelectedRepairIds] = useState<string[]>([]);
  const [result, setResult] = useState<{ applied: number; skipped: number; failed: number; repairedRuns: number } | null>(null);
  const [latestBatch, setLatestBatch] = useState<DataHealthWorkspaceData["repairBatches"][number] | null>(null);
  const [undoingBatch, setUndoingBatch] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["data-health-workspace"],
    queryFn: fetchDataHealthWorkspace,
    enabled: false,
    staleTime: 0,
  });
  const applyMutation = useMutation({
    mutationFn: applyDataHealthRepairs,
    onSuccess: async (next) => {
      setConfirming(false);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["brand-profiles"] }),
      ]);
      if (next.batchId) {
        const outcome = next.outcome ?? {
          applied: next.summary.repairedProfiles,
          skipped: 0,
          failed: 0,
          repairedRuns: next.summary.repairedRuns,
        };
        setLatestBatch({
          id: next.batchId,
          actor: "Current manager",
          appliedAt: new Date().toISOString(),
          undoneAt: null,
          status: "applied",
          summary: outcome,
        });
        queryClient.setQueryData<DataHealthWorkspaceData>(["data-health-workspace"], (current) => {
          if (!current || current.repairBatches.some((batch) => batch.id === next.batchId)) return current;
          return {
            ...current,
            repairBatches: [{
              id: next.batchId!,
              actor: "Current manager",
              appliedAt: new Date().toISOString(),
              undoneAt: null,
              status: "applied",
              summary: outcome,
            }, ...current.repairBatches],
          };
        });
      }
      setResult(next.outcome ?? { applied: next.summary.repairedProfiles, skipped: 0, failed: 0, repairedRuns: next.summary.repairedRuns });
    },
  });
  const workspace = query.data;
  const safeFindings = useMemo(
    () => (workspace?.findings ?? []).filter((finding) => finding.repairability === "safe"),
    [workspace?.findings],
  );
  useEffect(() => {
    if (workspace) setSelectedRepairIds([]);
  }, [workspace]);
  const brands = useMemo(
    () => [...new Set((workspace?.findings ?? []).map((finding) => finding.brand).filter(Boolean))].sort(),
    [workspace?.findings],
  );
  const findings = (workspace?.findings ?? []).filter((finding) =>
    (category === "all" || finding.category === category)
    && (severity === "all" || finding.severity === severity)
    && (brand === "all" || finding.brand === brand)
    && (repairability === "all" || finding.repairability === repairability),
  );
  const safeCount = safeFindings.length;
  const selectedFindings = safeFindings.filter((finding) => selectedRepairIds.includes(finding.id));
  const history = workspace?.cleanupHistory;
  const repairBatches = latestBatch
    ? [latestBatch, ...(workspace?.repairBatches ?? []).filter((batch) => batch.id !== latestBatch.id)]
    : workspace?.repairBatches ?? [];
  const routeLabel = (route: DataHealthFinding["sourceRoute"]) =>
    route === "setupProfiles" ? "setup profiles"
      : route === "import" ? "import review"
        : route === "merge" ? "merge tools"
          : route === "dough" ? "dough recipes"
            : route === "sauce" ? "sauce recipes"
              : route === "cheeseRecipes" ? "cheese recipes"
                : route === "mixes" ? "mix recipes"
                  : route === "ingredientTypes" ? "ingredient setup" : "audit log";

  return (
    <Card data-testid="data-health-workspace">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Data health workspace
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1.5"
            disabled={query.isFetching}
            onClick={() => { setResult(null); setConfirming(false); void query.refetch(); }}
          >
            {query.isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Run check
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
           One scoped review of factory data health. Exact repairs show their change preview; uncertain findings stay in the specialized workflow that owns the decision.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isError && <p className="text-xs text-destructive">The health check could not be completed. Nothing was changed.</p>}
        {!workspace && !query.isFetching && !query.isError && (
          <p className="text-xs text-muted-foreground">Run a check to review production master-data findings.</p>
        )}
        {workspace && (
          <>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
               <span className="rounded bg-muted px-2 py-0.5">{workspace.summary.total ?? 0} active findings</span>
              <span className={`rounded px-2 py-0.5 ${safeCount ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-emerald-500/15 text-emerald-500"}`}>
                {safeCount} safe repair{safeCount === 1 ? "" : "s"}
              </span>
              <span className="rounded bg-muted px-2 py-0.5">{workspace.summary.review ?? 0} review-only</span>
               <span className="rounded bg-destructive/10 text-destructive px-2 py-0.5">{workspace.summary.errors ?? 0} errors</span>
               <span className="rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5">{workspace.summary.warnings ?? 0} warnings</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Filter data health category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">All categories</option>
                 <option value="profile-links">Profile links</option>
                 <option value="profiles">Profiles</option>
                 <option value="dough">Dough pool</option>
                 <option value="sauce">Sauce pool</option>
                 <option value="cheese">Cheese pool</option>
                 <option value="mixes">Mix pool</option>
                 <option value="ingredients">Ingredients</option>
                 <option value="aliases">Aliases</option>
                 <option value="scheduled-runs">Scheduled runs</option>
                <option value="import-review">Import review</option>
                 <option value="cleanup-history">Cleanup history</option>
              </select>
              <select aria-label="Filter data health severity" className={selectClass} value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="all">All severity</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="info">Info</option>
              </select>
              <select aria-label="Filter data health brand" className={selectClass} value={brand} onChange={(event) => setBrand(event.target.value)}>
                <option value="all">All brands</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select aria-label="Filter data health repairability" className={selectClass} value={repairability} onChange={(event) => setRepairability(event.target.value)}>
                <option value="all">Safe and review</option><option value="safe">Safe repairs</option><option value="review">Review only</option>
              </select>
            </div>
            {findings.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-4 h-4" /> No findings match these filters.</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                 {findings.map((finding) => {
                   const selected = selectedRepairIds.includes(finding.id);
                   return (
                  <div key={finding.id} className="rounded border border-border bg-background/60 px-2.5 py-2 text-xs">
                    <div className="flex items-start gap-2">
                       {finding.repairability === "safe" ? (
                         <input
                           type="checkbox"
                           aria-label={`Select repair for ${finding.affectedRecord}`}
                           checked={selected}
                           onChange={() => setSelectedRepairIds((current) => selected ? current.filter((id) => id !== finding.id) : [...current, finding.id])}
                           className="mt-0.5 accent-primary"
                         />
                       ) : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-medium">{finding.brand || "Unbranded"} — {finding.flavor || "All flavors"}</p>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityClass(finding.severity)}`}>{finding.severity}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{finding.repairability === "safe" ? "safe repair" : "review only"}</span>
                        </div>
                         <p className="text-muted-foreground mt-0.5">{finding.affectedRecord} · {finding.recipe}</p>
                        <p className="text-muted-foreground mt-0.5">{finding.message}</p>
                        <p className="mt-1"><span className="font-medium">Proposed:</span> {finding.proposedRepair}</p>
                         {finding.protectedValue && <p className="mt-1 text-amber-700 dark:text-amber-400">Protected manager-entered value — review only.</p>}
                         {finding.preview && (
                           <div className="mt-1 rounded bg-muted/60 px-2 py-1">
                             <span className="font-medium">Preview:</span> {finding.preview.before} <span aria-hidden="true">→</span> {finding.preview.after}
                             {finding.preview.changes?.map((change) => (
                               <p key={change.field} className="mt-1 text-muted-foreground">
                                 <span className="font-medium text-foreground">{change.field}:</span> {change.before} <span aria-hidden="true">→</span> {change.after}
                               </p>
                             ))}
                           </div>
                         )}
                      </div>
                      {finding.repairability === "review" && onNavigate && (
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] shrink-0" onClick={() => onNavigate(finding.sourceRoute)}>
                           Open {routeLabel(finding.sourceRoute)} <ExternalLink className="ml-1 h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                 );})}
              </div>
            )}
            {safeCount > 0 && (
              confirming ? (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
                   <p className="text-xs font-medium">Review exact changes before applying</p>
                   <div className="max-h-40 overflow-y-auto space-y-1 text-[11px]">
                     {selectedFindings.length === 0 ? <p className="text-muted-foreground">No repairs selected.</p> : selectedFindings.map((finding) => (
                       <div key={finding.id} className="rounded bg-background/60 px-2 py-1">
                         <span className="font-medium">{finding.affectedRecord}</span>: {finding.preview?.before ?? "Current value"} <span aria-hidden="true">→</span> {finding.preview?.after ?? finding.proposedRepair}
                         {finding.preview?.changes?.map((change) => (
                           <p key={change.field} className="mt-1 text-muted-foreground">
                             <span className="font-medium text-foreground">{change.field}:</span> {change.before} <span aria-hidden="true">→</span> {change.after}
                           </p>
                         ))}
                       </div>
                     ))}
                   </div>
                   <p className="text-xs text-muted-foreground">The server re-checks each finding. Changed, protected, started, or ended records are skipped rather than overwritten.</p>
                  <div className="flex gap-2">
                     <Button size="sm" className="h-7 text-xs" disabled={applyMutation.isPending || selectedFindings.length === 0} onClick={() => applyMutation.mutate(selectedFindings.map((finding) => finding.id))}>
                      {applyMutation.isPending && <Loader2 className="mr-1 w-3 h-3 animate-spin" />} Apply safe repairs
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={applyMutation.isPending} onClick={() => setConfirming(false)}>Cancel</Button>
                  </div>
                </div>
               ) : <div className="flex flex-wrap items-center gap-2">
                 <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedRepairIds(safeFindings.map((finding) => finding.id))}>Select all safe</Button>
                 <Button size="sm" variant="outline" className="h-7 text-xs" disabled={selectedFindings.length === 0} onClick={() => setConfirming(true)}>Preview {selectedFindings.length} repair{selectedFindings.length === 1 ? "" : "s"}</Button>
               </div>
            )}
            {applyMutation.isError && <p className="text-xs text-destructive">The repair did not complete. Nothing was reported as applied.</p>}
            {result && <p className="text-xs text-emerald-600 dark:text-emerald-400">Applied {result.applied} repair{result.applied === 1 ? "" : "s"} and refreshed {result.repairedRuns} future run snapshot{result.repairedRuns === 1 ? "" : "s"}; skipped {result.skipped}, failed {result.failed}.</p>}
            {repairBatches.length > 0 && <div data-testid="data-health-repair-history" className="space-y-2 rounded border border-border/70 bg-muted/20 p-2">
              <p className="flex items-center gap-1.5 text-xs font-medium"><History className="h-3.5 w-3.5" /> Recent repair batches</p>
              {repairBatches.map((batch) => <div key={batch.id} data-testid={`data-health-repair-batch-${batch.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background/60 p-2 text-[11px]">
                <div><p className="font-medium">{new Date(batch.appliedAt).toLocaleString()} · {batch.actor}</p><p className="text-muted-foreground">{batch.status} · applied {batch.summary.applied}, skipped {batch.summary.skipped}</p></div>
                 {batch.status === "applied" && batch.summary.undoable !== false && <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={undoingBatch !== null} onClick={() => {
                  if (!window.confirm("Undo this repair batch? Records changed since the repair will be skipped.")) return;
                  setUndoingBatch(batch.id);
                  void undoProfileDataHealthRepair(batch.id)
                    .then(async (outcome) => {
                      await query.refetch();
                      queryClient.setQueryData<DataHealthWorkspaceData>(["data-health-workspace"], (current) => current ? {
                        ...current,
                        repairBatches: current.repairBatches.map((item) => item.id === batch.id ? {
                          ...item,
                          status: "undone",
                          undoneAt: new Date().toISOString(),
                          summary: outcome.summary,
                        } : item),
                      } : current);
                      setLatestBatch((current) => current?.id === batch.id ? {
                        ...current,
                        status: "undone",
                        undoneAt: new Date().toISOString(),
                        summary: outcome.summary,
                      } : current);
                    })
                    .finally(() => setUndoingBatch(null));
                }}>{undoingBatch === batch.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />} Undo batch</Button>}
              </div>)}
            </div>}
            {history && (
              <div className="rounded border border-border/70 bg-muted/20 p-2 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground">Cleanup history</p>
                <p>Previous cleanup checked {history.summary.scannedProfiles} profiles, corrected {history.summary.correctedProfiles}, protected {history.summary.skippedStarted} started, and removed {Object.values(history.summary.removedStubs).reduce((sum, count) => sum + count, 0)} orphaned stubs.</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}