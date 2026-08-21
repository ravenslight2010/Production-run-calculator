import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyProfileDataHealthRepairs,
  fetchDataHealthWorkspace,
  type DataHealthFinding,
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
  const [result, setResult] = useState<{ repairedProfiles: number; repairedRuns: number } | null>(null);
  const query = useQuery({
    queryKey: ["data-health-workspace"],
    queryFn: fetchDataHealthWorkspace,
    enabled: false,
    staleTime: 0,
  });
  const applyMutation = useMutation({
    mutationFn: applyProfileDataHealthRepairs,
    onSuccess: (next) => {
      setResult(next.summary);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["data-health-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["brand-profiles"] });
    },
  });
  const workspace = query.data;
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
  const safeCount = workspace?.summary.safe ?? 0;
  const history = workspace?.cleanupHistory;

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
          One read-only review of profile links, saved-sheet mismatches, and cleanup history. Only exact, deterministic repairs can be applied here.
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
            </div>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Filter data health category" className={selectClass} value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">All categories</option>
                <option value="profile-links">Profile links</option>
                <option value="recipe-records">Recipe records</option>
                <option value="import-review">Import review</option>
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
                {findings.map((finding) => (
                  <div key={finding.id} className="rounded border border-border bg-background/60 px-2.5 py-2 text-xs">
                    <div className="flex items-start gap-2">
                      {finding.repairability === "safe" ? <ClipboardCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-medium">{finding.brand || "Unbranded"} — {finding.flavor || "All flavors"}</p>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityClass(finding.severity)}`}>{finding.severity}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{finding.repairability === "safe" ? "safe repair" : "review only"}</span>
                        </div>
                        <p className="text-muted-foreground mt-0.5">{finding.recipe}</p>
                        <p className="text-muted-foreground mt-0.5">{finding.message}</p>
                        <p className="mt-1"><span className="font-medium">Proposed:</span> {finding.proposedRepair}</p>
                      </div>
                      {finding.repairability === "review" && onNavigate && (
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] shrink-0" onClick={() => onNavigate(finding.sourceRoute)}>
                          Open {finding.sourceRoute === "setupProfiles" ? "setup" : finding.sourceRoute === "import" ? "import review" : "merge"} <ExternalLink className="ml-1 h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {safeCount > 0 && (
              confirming ? (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
                  <p className="text-xs">Apply {safeCount} exact repair{safeCount === 1 ? "" : "s"}? This is bounded to unchanged profiles; started and ended runs will not be changed.</p>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
                      {applyMutation.isPending && <Loader2 className="mr-1 w-3 h-3 animate-spin" />} Apply safe repairs
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={applyMutation.isPending} onClick={() => setConfirming(false)}>Cancel</Button>
                  </div>
                </div>
              ) : <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirming(true)}>Review and apply safe repairs</Button>
            )}
            {applyMutation.isError && <p className="text-xs text-destructive">The repair did not complete. Nothing was reported as applied.</p>}
            {result && <p className="text-xs text-emerald-600 dark:text-emerald-400">Applied {result.repairedProfiles} profile repair{result.repairedProfiles === 1 ? "" : "s"} and refreshed {result.repairedRuns} future run snapshot{result.repairedRuns === 1 ? "" : "s"}.</p>}
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