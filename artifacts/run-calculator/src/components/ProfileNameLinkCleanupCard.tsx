import { CheckCircle2, ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { useGetProfileNameLinkCleanupAudit } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatAppliedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export default function ProfileNameLinkCleanupCard() {
  const cleanupQuery = useGetProfileNameLinkCleanupAudit({
    query: {
      queryKey: ["audit-logs", "profile-name-link-cleanup"],
      staleTime: 30_000,
    },
  });
  const heal = cleanupQuery.data?.heal;
  const removed = heal?.summary.removedStubs;
  const removedTotal = removed
    ? removed.dough + removed.sauce + removed.cheese + removed.mix
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-amber-400" />
            Name-link cleanup
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void cleanupQuery.refetch()}
            disabled={cleanupQuery.isFetching}
            aria-label="Refresh name-link cleanup results"
          >
            {cleanupQuery.isFetching
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Read-only result of the one-time cleanup that realigned saved recipe links and removed unreferenced empty recipe stubs.
        </p>

        {cleanupQuery.isLoading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading cleanup result…
          </div>
        ) : cleanupQuery.isError ? (
          <p className="text-xs text-destructive">
            The cleanup result could not be loaded. Nothing was changed.
          </p>
        ) : !heal ? (
          <p className="text-xs text-muted-foreground">
            This cleanup has not run in this environment yet.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Completed {formatAppliedAt(heal.appliedAt)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded border border-border bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Profiles checked</p>
                <p className="mt-0.5 font-semibold">{heal.summary.scannedProfiles}</p>
              </div>
              <div className="rounded border border-border bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Links corrected</p>
                <p className="mt-0.5 font-semibold">{heal.summary.correctedProfiles}</p>
              </div>
              <div className="rounded border border-border bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Started runs protected</p>
                <p className="mt-0.5 font-semibold">{heal.summary.skippedStarted}</p>
              </div>
              <div className="rounded border border-border bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Empty stubs removed</p>
                <p className="mt-0.5 font-semibold">{removedTotal}</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Removed stubs: {removed?.dough ?? 0} dough, {removed?.sauce ?? 0} sauce, {removed?.cheese ?? 0} cheese, and {removed?.mix ?? 0} mix.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}