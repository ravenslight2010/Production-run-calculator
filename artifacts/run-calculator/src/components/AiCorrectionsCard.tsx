import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Brain, Trash2, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchAiCorrections,
  deleteAiCorrection,
  fetchAiMemoryHealth,
  applyAiMemorySafeFixes,
  type AiCorrectionWithId,
  type AiMemoryHealthApplyResult,
} from "@/aiCorrections";
import type { AiMemoryHealthReport } from "@workspace/ai-memory";

// Domain display labels — falls back to the raw domain string for unknown ones.
const DOMAIN_LABELS: Record<string, string> = {
  ingredient: "Ingredient",
  brand: "Brand",
  flavor: "Flavor",
  recipe: "Recipe",
  die: "Die",
  item: "Item",
};

function domainBadgeClass(domain: string): string {
  switch (domain) {
    case "ingredient": return "bg-emerald-500/15 text-emerald-400";
    case "brand":      return "bg-amber-500/15 text-amber-400";
    case "flavor":     return "bg-sky-500/15 text-sky-400";
    case "recipe":     return "bg-purple-500/15 text-purple-400";
    case "die":        return "bg-orange-500/15 text-orange-400";
    default:           return "bg-muted text-muted-foreground";
  }
}

// Group corrections by domain, sorted alphabetically by domain then fromText.
function groupByDomain(corrections: AiCorrectionWithId[]): [string, AiCorrectionWithId[]][] {
  const map = new Map<string, AiCorrectionWithId[]>();
  for (const c of corrections) {
    const group = map.get(c.domain) ?? [];
    group.push(c);
    map.set(c.domain, group);
  }
  const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, items] of sorted) {
    items.sort((a, b) => a.fromText.localeCompare(b.fromText));
  }
  return sorted;
}

// Manager-only card: view and delete entries from the AI's rename memory.
// Each entry represents a confirmed "read X as Y" mapping that is fed into
// every name-resolving AI prompt factory-wide.
export default function AiCorrectionsCard() {
  const qc = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmingSafeFixes, setConfirmingSafeFixes] = useState(false);
  const [applyResult, setApplyResult] = useState<AiMemoryHealthApplyResult | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["ai-corrections"],
    queryFn: fetchAiCorrections,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAiCorrection(id),
    onMutate: (id) => setDeletingId(id),
    onSuccess: (updated) => {
      qc.setQueryData(["ai-corrections"], updated);
      void qc.invalidateQueries({ queryKey: ["ai-memory-health"] });
    },
    onSettled: () => setDeletingId(null),
  });

  const healthQuery = useQuery({
    queryKey: ["ai-memory-health"],
    queryFn: fetchAiMemoryHealth,
    enabled: false,
    staleTime: 0,
  });

  const applyMutation = useMutation({
    mutationFn: applyAiMemorySafeFixes,
    onSuccess: (result) => {
      setApplyResult(result);
      setConfirmingSafeFixes(false);
      qc.setQueryData<AiMemoryHealthReport>(["ai-memory-health"], result.after);
      void qc.invalidateQueries({ queryKey: ["ai-corrections"] });
    },
  });

  const corrections = data ?? [];
  const groups = groupByDomain(corrections);
  const report = healthQuery.data;
  const reviewFindings = report?.correctionFindings.filter(
    (finding) => finding.status !== "healthy" && finding.status !== "covered-by-merge",
  ) ?? [];
  const facilityFindings = report?.facilityKnowledgeFindings ?? [];

  const statusLabel = (status: string) => status.replaceAll("-", " ");
  const statusClass = (status: string) =>
    ["healthy", "covered-by-merge"].includes(status)
      ? "bg-emerald-500/15 text-emerald-400"
      : ["cycle", "orphaned", "outdated-target"].includes(status)
        ? "bg-amber-500/15 text-amber-400"
        : "bg-muted text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            Name Equivalences
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setApplyResult(null);
                setConfirmingSafeFixes(false);
                void healthQuery.refetch();
              }}
              disabled={healthQuery.isFetching}
              className="h-7 px-2 text-xs gap-1.5"
            >
              {healthQuery.isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
              Health check
            </Button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 rounded hover:bg-muted transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Corrections the AI has learned — whenever a name is renamed or merged, an entry is
          recorded here so every AI feature treats the old name as equal to the new one.
            Run the health check before removing an entry: it compares correction memory to confirmed
            merges and current master data. It never includes anyone&apos;s private conversation history.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : isError ? (
          <div className="py-6 text-center">
            <p className="text-sm text-destructive mb-3">Failed to load corrections.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <HealthCheckResults
              report={report}
              isLoading={healthQuery.isFetching}
              isError={healthQuery.isError}
              findings={reviewFindings}
              facilityFindings={facilityFindings}
              confirmingSafeFixes={confirmingSafeFixes}
              onStartConfirm={() => setConfirmingSafeFixes(true)}
              onCancelConfirm={() => setConfirmingSafeFixes(false)}
              onApply={() => applyMutation.mutate()}
              isApplying={applyMutation.isPending}
              applyError={applyMutation.isError}
              applyResult={applyResult}
              statusLabel={statusLabel}
              statusClass={statusClass}
            />
            {corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">
            No name equivalences recorded yet.
          </p>
            ) : (
          <div className="space-y-4">
            {groups.map(([domain, items]) => (
              <div key={domain}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${domainBadgeClass(domain)}`}>
                    {DOMAIN_LABELS[domain] ?? domain}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{items.length} {items.length === 1 ? "entry" : "entries"}</span>
                </div>
                <div className="space-y-1">
                  {items.map((c) => {
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-background/40"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-medium text-muted-foreground truncate" title={c.fromText}>
                            {c.fromText}
                          </span>
                          <span className="mx-1.5 text-[10px] text-muted-foreground">→</span>
                          <span className="text-xs font-semibold truncate" title={c.toText}>
                            {c.toText}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={deletingId === c.id || deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(c.id)}
                          className="shrink-0 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                          title="Remove this equivalence"
                        >
                          {deletingId === c.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HealthCheckResults({
  report,
  isLoading,
  isError,
  findings,
  facilityFindings,
  confirmingSafeFixes,
  onStartConfirm,
  onCancelConfirm,
  onApply,
  isApplying,
  applyError,
  applyResult,
  statusLabel,
  statusClass,
}: {
  report?: AiMemoryHealthReport;
  isLoading: boolean;
  isError: boolean;
  findings: AiMemoryHealthReport["correctionFindings"];
  facilityFindings: AiMemoryHealthReport["facilityKnowledgeFindings"];
  confirmingSafeFixes: boolean;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onApply: () => void;
  isApplying: boolean;
  applyError: boolean;
  applyResult: AiMemoryHealthApplyResult | null;
  statusLabel: (status: string) => string;
  statusClass: (status: string) => string;
}) {
  if (isLoading) {
    return <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking correction and facility memory…</div>;
  }
  if (isError) {
    return <p className="text-xs text-destructive">The health check could not be completed. No AI memory was changed.</p>;
  }
  if (!report) return null;
  return (
    <section className="rounded border border-primary/25 bg-primary/5 p-3 space-y-3" aria-live="polite">
      <div className="flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-semibold">AI Memory Health Check</p>
          <p className="text-xs text-muted-foreground">
            Read-only review of {report.correctionFindings.length} correction{report.correctionFindings.length === 1 ? "" : "s"} and {facilityFindings.length} facility fact{facilityFindings.length === 1 ? "" : "s"}. Per-user conversation history is excluded.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(report.summary).map(([status, count]) => (
          <span key={status} className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize ${statusClass(status)}`}>
            {count} {statusLabel(status)}
          </span>
        ))}
      </div>
      {findings.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold">Correction findings</p>
          {findings.map((finding) => (
            <div key={finding.entry.id} className="rounded border border-border bg-background/60 px-2.5 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{finding.entry.fromText} → {finding.entry.toText}</span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${statusClass(finding.status)}`}>{statusLabel(finding.status)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{finding.evidence.join(" ")}</p>
              {finding.safeRepair && <p className="mt-1 text-primary">Safe repair: {finding.safeRepair.action === "delete" ? "remove this duplicate/cycle row" : `retarget to "${finding.safeRepair.after.toText}"`}.</p>}
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-emerald-400">No correction entries need deterministic repair.</p>}
      <div className="space-y-2">
        <p className="text-xs font-semibold">Facility knowledge (review only)</p>
        {facilityFindings.length === 0 ? <p className="text-xs text-muted-foreground">No facility facts recorded.</p> : facilityFindings.map((finding) => (
          <div key={finding.entry.id} className="rounded border border-border bg-background/60 px-2.5 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{finding.entry.key}</span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${statusClass(finding.status)}`}>{statusLabel(finding.status)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{finding.evidence.join(" ")}</p>
          </div>
        ))}
      </div>
      {report.safeRepairs.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
          <p className="text-xs text-amber-300">
            {report.safeRepairs.length} deterministic repair{report.safeRepairs.length === 1 ? "" : "s"} listed above. Applying only updates or removes those correction rows; facility facts and conversations stay untouched.
          </p>
          {!confirmingSafeFixes ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onStartConfirm}>Review safe fixes</Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={onApply} disabled={isApplying}>
                {isApplying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                Apply listed safe fixes
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelConfirm} disabled={isApplying}>Cancel</Button>
            </div>
          )}
          {applyError && <p className="text-xs text-destructive">No fixes were applied because the safe-repair transaction failed.</p>}
        </div>
      )}
      {applyResult && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-300">
          <p className="font-semibold">Safe repair summary</p>
          <p className="mt-1">
            Applied safely: {applyResult.summary.retargeted} retargeted and {applyResult.summary.deleted} removed.
          </p>
          <p className="mt-1 text-emerald-200/90">
            Before: {applyResult.before.correctionFindings.length} correction finding{applyResult.before.correctionFindings.length === 1 ? "" : "s"} and {applyResult.before.safeRepairs.length} deterministic repair{applyResult.before.safeRepairs.length === 1 ? "" : "s"} listed. After: {applyResult.after.correctionFindings.length} correction finding{applyResult.after.correctionFindings.length === 1 ? "" : "s"} and {applyResult.after.safeRepairs.length} deterministic repair{applyResult.after.safeRepairs.length === 1 ? "" : "s"} remaining. Facility facts and conversation history were not changed.
          </p>
        </div>
      )}
    </section>
  );
}
