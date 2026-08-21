import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyProfileDataHealthRepairs,
  fetchProfileDataHealth,
  type ProfileDataHealthApplyResult,
} from "@/profileDataHealth";

export default function ProfileDataHealthCard() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ProfileDataHealthApplyResult | null>(null);
  const reportQuery = useQuery({
    queryKey: ["profile-data-health"],
    queryFn: fetchProfileDataHealth,
    enabled: false,
    staleTime: 0,
  });
  const applyMutation = useMutation({
    mutationFn: applyProfileDataHealthRepairs,
    onSuccess: (next) => {
      setResult(next);
      setConfirming(false);
      queryClient.setQueryData(["profile-data-health"], next.after);
      void queryClient.invalidateQueries({ queryKey: ["brand-profiles"] });
    },
  });
  const report = reportQuery.data;
  const findings = report?.findings ?? [];
  const repairs = report?.safeRepairs ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Production Data Health
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1.5"
            disabled={reportQuery.isFetching}
            onClick={() => { setResult(null); setConfirming(false); void reportQuery.refetch(); }}
          >
            {reportQuery.isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Run check
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Checks saved profiles against the recipe library and saved spec sheets. The check is read-only; only exact missing links and empty recipe rows can be repaired automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {reportQuery.isError && <p className="text-xs text-destructive">The health check could not be completed. Nothing was changed.</p>}
        {!report && !reportQuery.isFetching && !reportQuery.isError && (
          <p className="text-xs text-muted-foreground">Run a check to review profile and recipe links.</p>
        )}
        {report && (
          <>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
              <span className="rounded bg-muted px-2 py-0.5">{report.summary.profilesChecked ?? 0} profiles checked</span>
              <span className={`rounded px-2 py-0.5 ${repairs.length ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"}`}>
                {repairs.length} safe repair{repairs.length === 1 ? "" : "s"}
              </span>
            </div>
            {findings.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> No profile-link problems found.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {findings.map((finding) => (
                  <div key={finding.id} className="rounded border border-border bg-background/60 px-2.5 py-2 text-xs">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${finding.repairable ? "text-amber-500" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="font-medium">{finding.brand} — {finding.flavor} <span className="text-muted-foreground">({finding.recipeKind})</span></p>
                        <p className="text-muted-foreground mt-0.5">{finding.message}</p>
                        <p className="text-muted-foreground mt-0.5 truncate">Current: {finding.currentName || "none"}{finding.expectedName ? ` · Saved sheet: ${finding.expectedName}` : ""}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {repairs.length > 0 && (
              confirming ? (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
                  <p className="text-xs">Apply {repairs.length} exact repair{repairs.length === 1 ? "" : "s"}? Started and ended runs will not be changed.</p>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
                      {applyMutation.isPending && <Loader2 className="mr-1 w-3 h-3 animate-spin" />} Apply safe repairs
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={applyMutation.isPending} onClick={() => setConfirming(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirming(true)}>Review and apply safe repairs</Button>
              )
            )}
            {applyMutation.isError && <p className="text-xs text-destructive">The repair did not complete. No result was reported.</p>}
            {result && <p className="text-xs text-emerald-600 dark:text-emerald-400">Repaired {result.summary.repairedProfiles} profile{result.summary.repairedProfiles === 1 ? "" : "s"} and refreshed {result.summary.repairedRuns} future run snapshot{result.summary.repairedRuns === 1 ? "" : "s"}.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}