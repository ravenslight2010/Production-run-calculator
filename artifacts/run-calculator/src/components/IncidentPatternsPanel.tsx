import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Loader2, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  requestIncidentClusters,
  type IncidentCluster,
  type IncidentClustersResult,
} from "../inventoryShared";

const ANALYSIS_WINDOW_DAYS = 30;
const INITIAL_PATTERN_COUNT = 3;
const SEVERITY_RANK: Record<IncidentCluster["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const SEVERITY_STYLE: Record<IncidentCluster["severity"], string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-sky-500/15 text-sky-400",
};

function generatedLabel(generatedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(generatedAt));
}

export function IncidentPatternsPanel({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<IncidentClustersResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const find = useMutation({
    mutationFn: () => requestIncidentClusters(),
    onSuccess: (nextResult) => {
      setResult(nextResult);
      setExpanded(false);
      setShowAll(false);
    },
  });
  const orderedClusters = useMemo(
    () =>
      [...(result?.clusters ?? [])].sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          b.incidentCount - a.incidentCount ||
          a.theme.localeCompare(b.theme),
      ),
    [result],
  );
  const visibleClusters = showAll
    ? orderedClusters
    : orderedClusters.slice(0, INITIAL_PATTERN_COUNT);
  const hasMore = orderedClusters.length > INITIAL_PATTERN_COUNT;
  const detailsId = "incident-pattern-details";

  return (
    <section
      aria-labelledby="incident-patterns-heading"
      className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
      data-testid="incident-patterns-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Network className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <h2 id="incident-patterns-heading" className="text-sm font-semibold text-foreground">
              Find patterns
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Deterministic grouping by screen and platform. Advisory only.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => find.mutate()}
          disabled={disabled || find.isPending}
        >
          {find.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Network className="mr-2 h-4 w-4" />
          )}
          {result ? "Refresh" : "Analyze"}
        </Button>
      </div>

      {find.isPending && (
        <p className="text-xs text-muted-foreground" role="status">
          Analyzing the last {ANALYSIS_WINDOW_DAYS} days…
        </p>
      )}
      {find.isError && (
        <p className="flex items-center gap-2 text-sm text-red-400" role="alert">
          <AlertTriangle className="h-4 w-4" /> Couldn't group the incident log.
        </p>
      )}

      {result && (
        <div className="space-y-3" data-testid="incident-clusters-result">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md bg-card/70 p-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Window</dt>
              <dd className="text-sm font-medium text-foreground">{ANALYSIS_WINDOW_DAYS} days</dd>
            </div>
            <div className="rounded-md bg-card/70 p-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Incidents</dt>
              <dd className="text-sm font-medium text-foreground">{result.totalIncidents}</dd>
            </div>
            <div className="rounded-md bg-card/70 p-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Patterns</dt>
              <dd className="text-sm font-medium text-foreground">{orderedClusters.length}</dd>
            </div>
            <div className="rounded-md bg-card/70 p-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Generated</dt>
              <dd className="text-xs font-medium text-foreground">{generatedLabel(result.generatedAt)}</dd>
            </div>
          </dl>

          {result.note ? (
            <p className="text-sm text-muted-foreground">{result.note}</p>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-between"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Hide pattern details" : "Review pattern details"}
                <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </Button>
              {expanded && (
                <div id={detailsId} className="space-y-2">
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1" tabIndex={0}>
                    {visibleClusters.map((cluster) => (
                      <article key={`${cluster.severity}-${cluster.theme}`} className="rounded-md border border-border bg-card p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[cluster.severity]}`}>
                            {cluster.severity}
                          </span>
                          <span className="text-sm font-medium text-foreground">{cluster.theme}</span>
                          <span className="text-xs text-muted-foreground">
                            {cluster.incidentCount} {cluster.incidentCount === 1 ? "incident" : "incidents"}
                          </span>
                        </div>
                        {cluster.rootCauseHypothesis && (
                          <p className="text-sm text-muted-foreground">{cluster.rootCauseHypothesis}</p>
                        )}
                        {cluster.recommendedAction && (
                          <p className="text-sm text-foreground">
                            <span className="font-medium">Next step: </span>
                            {cluster.recommendedAction}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                  {hasMore && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowAll((value) => !value)}>
                      {showAll
                        ? `Show top ${INITIAL_PATTERN_COUNT}`
                        : `Show all ${orderedClusters.length} patterns`}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}