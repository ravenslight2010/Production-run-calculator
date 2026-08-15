import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Brain, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchAiCorrections, deleteAiCorrection, collapseAiCorrectionChains, type AiCorrectionWithId } from "@/aiCorrections";

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

// Returns the set of IDs that would be dropped by dropConflictingCorrections —
// i.e. entries whose fromText or toText appears on BOTH sides of the pool for
// their domain. These are stale chains/cycles that the AI silently ignores.
function computeConflictedIds(corrections: AiCorrectionWithId[]): Set<number> {
  const dl = (s: string) => s.trim().toLowerCase();
  const froms = new Map<string, Set<string>>();
  const tos   = new Map<string, Set<string>>();
  for (const c of corrections) {
    const d = dl(c.domain);
    let f = froms.get(d);
    if (!f) froms.set(d, (f = new Set()));
    f.add(dl(c.fromText));
    let t = tos.get(d);
    if (!t) tos.set(d, (t = new Set()));
    t.add(dl(c.toText));
  }
  const conflictedIds = new Set<number>();
  for (const c of corrections) {
    const d = dl(c.domain);
    const f = froms.get(d);
    const t = tos.get(d);
    const isConflicted = (name: string) => !!f && !!t && f.has(name) && t.has(name);
    if (isConflicted(dl(c.fromText)) || isConflicted(dl(c.toText))) {
      conflictedIds.add(c.id);
    }
  }
  return conflictedIds;
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
    },
    onSettled: () => setDeletingId(null),
  });

  const collapseMutation = useMutation({
    mutationFn: collapseAiCorrectionChains,
    onSuccess: (updated) => {
      qc.setQueryData(["ai-corrections"], updated);
    },
  });

  const corrections = data ?? [];
  const conflictedIds = computeConflictedIds(corrections);
  const groups = groupByDomain(corrections);
  const hasConflicts = conflictedIds.size > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            Name Equivalences
          </CardTitle>
          <div className="flex items-center gap-1">
            {hasConflicts && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => collapseMutation.mutate()}
                disabled={collapseMutation.isPending}
                className="h-7 px-2 text-xs gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                title="Automatically resolve stale chains and cycles in the AI memory"
              >
                {collapseMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <AlertTriangle className="w-3 h-3" />
                )}
                Fix stale entries
              </Button>
            )}
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
          Delete an entry to stop the AI from applying that substitution.
          Entries marked with <AlertTriangle className="inline w-3 h-3 text-amber-400 mx-0.5 mb-0.5" /> are
          part of a chain or cycle and are currently <strong>ignored by the AI</strong> — use
          "Fix stale entries" to auto-resolve them, or delete manually.
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
        ) : corrections.length === 0 ? (
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
                    const isConflicted = conflictedIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded border bg-background/40 ${
                          isConflicted
                            ? "border-amber-500/40 bg-amber-500/5"
                            : "border-border"
                        }`}
                      >
                        {isConflicted && (
                          <AlertTriangle
                            className="shrink-0 w-3.5 h-3.5 text-amber-400"
                            aria-label="This entry is part of a rename chain or cycle and is currently ignored by the AI. Delete the stale entry to restore it."
                          />
                        )}
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
      </CardContent>
    </Card>
  );
}
