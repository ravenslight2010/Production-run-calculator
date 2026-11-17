import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayStr } from "@/utils";

type ConflictTrendPoint = {
  date: string;
  conflicts: number;
  events: number;
};

type ConflictStats = {
  today: string;
  totalConflictsToday: number;
  trend: ConflictTrendPoint[];
  fields: Array<{ field: string; count: number }>;
  runs: Array<{ runId: string; count: number; fields: string[] }>;
};

function displayDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

function shortRunId(runId: string): string {
  return runId.length > 18 ? `${runId.slice(0, 18)}…` : runId;
}

export default function SyncConflictStatsCard() {
  const today = todayStr();
  const statsQuery = useQuery<ConflictStats>({
    queryKey: ["sync-conflict-stats", today],
    queryFn: async () => {
      const res = await fetch(`/api/sync/conflict-stats?today=${encodeURIComponent(today)}`);
      if (!res.ok) throw new Error(`Failed to fetch sync conflict stats (${res.status})`);
      return res.json() as Promise<ConflictStats>;
    },
    staleTime: 30_000,
  });
  const stats = statsQuery.data;
  const maxTrend = Math.max(1, ...(stats?.trend.map((point) => point.conflicts) ?? [0]));
  const topFields = stats?.fields.slice(0, 5) ?? [];
  const topRuns = stats?.runs.slice(0, 5) ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" /> Sync conflict monitor
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={statsQuery.isFetching}
            onClick={() => void statsQuery.refetch()}
          >
            {statsQuery.isFetching
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Protected sync merges from your local calendar day and the previous six days.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {statsQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sync conflict history…
          </div>
        ) : statsQuery.isError ? (
          <p className="py-3 text-xs text-destructive">
            Failed to load sync conflict history. Make sure you have manager access.
          </p>
        ) : stats ? (
          <>
            <div className="rounded border border-border bg-muted/20 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Conflicts today
              </p>
              <p className={`mt-0.5 text-2xl font-bold ${stats.totalConflictsToday > 0 ? "text-amber-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                {stats.totalConflictsToday}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {stats.totalConflictsToday === 0
                  ? "No protected merges recorded today."
                  : "Fields kept from the safer merged state."}
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold">Seven-day trend</p>
              <div className="grid grid-cols-7 items-end gap-1.5" aria-label="Seven-day sync conflict trend">
                {stats.trend.map((point) => (
                  <div key={point.date} className="min-w-0 text-center">
                    <div className="flex h-16 items-end rounded-sm bg-muted/40">
                      <div
                        className={`w-full rounded-sm ${point.conflicts > 0 ? "bg-amber-500" : "bg-emerald-500/30"}`}
                        style={{ height: `${point.conflicts > 0 ? Math.max(10, (point.conflicts / maxTrend) * 100) : 4}%` }}
                        title={`${displayDate(point.date)}: ${point.conflicts} conflict${point.conflicts === 1 ? "" : "s"} across ${point.events} merge event${point.events === 1 ? "" : "s"}`}
                      />
                    </div>
                    <p className="mt-1 text-[10px] font-medium">{point.conflicts}</p>
                    <p className="truncate text-[9px] text-muted-foreground">{displayDate(point.date)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold">Most-conflicted fields</p>
                {topFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No conflicts in this seven-day window.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {topFields.map((item) => (
                      <li key={item.field} className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1.5 text-xs">
                        <span>{item.field}</span>
                        <span className="font-semibold tabular-nums text-muted-foreground">{item.count}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold">Runs most affected</p>
                {topRuns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No run-specific conflicts in this seven-day window.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {topRuns.map((item) => (
                      <li key={item.runId} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium" title={item.runId}>Run {shortRunId(item.runId)}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">{item.count}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.fields.join(" · ")}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4" /> No sync conflict data is available.
          </div>
        )}
      </CardContent>
    </Card>
  );
}