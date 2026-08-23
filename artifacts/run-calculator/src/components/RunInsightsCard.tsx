import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lightbulb, Check, X, RefreshCw, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchRunSuggestions,
  updateRunSuggestion,
  type RunSuggestion,
} from "@/runInsights";
import { RUN_SUGGESTIONS_QUERY_KEY } from "@/runInsightsQuery";

// Manager-only "Run Insights" card (Setup tab). Shows ONE pending suggestion
// at a time — a deterministic, pattern-based recommendation to adjust a
// setting after recent runs consistently diverged from it. Accept applies the
// change (handled by the parent via onAccept); Dismiss suppresses the pattern
// until it recurs. Also surfaces post-accept follow-up notes ("the update
// seems accurate") with a Got-it clear action. Nothing is ever auto-applied.
export default function RunInsightsCard({
  onAccept,
  getAcceptWarning,
}: {
  /** Applies the accepted setting change; resolves to a confirmation line. */
  onAccept: (s: RunSuggestion) => Promise<string>;
  /**
   * Optional pre-flight check. Called with the pending suggestion before the
   * Accept button is rendered. Return a non-empty string to show a warning
   * (the manager can still accept — the warning explains the likely outcome).
   * Return null/undefined when Accept is expected to succeed.
   */
  getAcceptWarning?: (s: RunSuggestion) => string | null | undefined;
}) {
  const qc = useQueryClient();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: RUN_SUGGESTIONS_QUERY_KEY,
    queryFn: fetchRunSuggestions,
    staleTime: 30_000,
  });

  const suggestions = data ?? [];
  const pending = suggestions
    .filter((s) => s.status === "pending")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const current = pending[0];
  const followUps = suggestions.filter((s) => s.status === "accepted" && s.followUpNote);
  const dismissed = suggestions
    .filter((s) => s.status === "dismissed")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const acceptMutation = useMutation({
    mutationFn: async (s: RunSuggestion) => {
      const message = await onAccept(s);
      const updated = await updateRunSuggestion(s.id, { status: "accepted" });
      return { message, updated };
    },
    onSuccess: ({ message, updated }) => {
      setError(null);
      setConfirmation(message);
      qc.setQueryData(RUN_SUGGESTIONS_QUERY_KEY, updated);
    },
    onError: (err) => {
      setConfirmation(null);
      setError(err instanceof Error ? err.message : "Couldn't apply the suggestion.");
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (s: RunSuggestion) => updateRunSuggestion(s.id, { status: "dismissed" }),
    onSuccess: (updated) => {
      setError(null);
      qc.setQueryData(RUN_SUGGESTIONS_QUERY_KEY, updated);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Couldn't dismiss the suggestion."),
  });

  const clearFollowUpMutation = useMutation({
    mutationFn: (s: RunSuggestion) => updateRunSuggestion(s.id, { clearFollowUp: true }),
    onSuccess: (updated) => qc.setQueryData(RUN_SUGGESTIONS_QUERY_KEY, updated),
  });

  const reopenMutation = useMutation({
    mutationFn: (s: RunSuggestion) => updateRunSuggestion(s.id, { status: "pending" }),
    onSuccess: (updated) => {
      setError(null);
      qc.setQueryData(RUN_SUGGESTIONS_QUERY_KEY, updated);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Couldn't re-open the suggestion."),
  });

  // Nothing to show at all → render nothing (keeps the Setup tab clean).
  if (!isLoading && !current && followUps.length === 0 && dismissed.length === 0 && !confirmation && !error) return null;

  const busy = acceptMutation.isPending || dismissMutation.isPending || reopenMutation.isPending;
  const acceptWarning = current ? (getAcceptWarning?.(current) ?? null) : null;

  const settingLabel = (s: RunSuggestion) =>
    s.type === "speed-target" ? "Cycle speed" : "Tunnel time";
  const productLabel = (s: RunSuggestion) =>
    [s.brand, s.flavor].filter(Boolean).join(" ") || "Unnamed product";

  return (
    <Card className="mb-4 border-primary/30" data-testid="card-run-insights">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" />
            Run Insights
          </CardTitle>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded hover:bg-muted transition-colors disabled:opacity-50"
            title="Refresh"
            data-testid="button-run-insights-refresh"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-muted-foreground ${isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Pattern-based setting suggestions from completed runs. Nothing changes unless you
          accept it.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-xs text-destructive" data-testid="text-run-insights-error">
            {error}
          </p>
        )}
        {confirmation && (
          <div
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400 flex items-start justify-between gap-2"
            data-testid="text-run-insights-confirmation"
          >
            <span>{confirmation}</span>
            <button
              type="button"
              onClick={() => setConfirmation(null)}
              className="shrink-0 hover:text-emerald-300"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {followUps.map((s) => (
          <div
            key={`fu-${s.id}`}
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300 flex items-start justify-between gap-2"
            data-testid={`text-run-insights-followup-${s.type}`}
          >
            <span>
              <span className="font-semibold">{productLabel(s)}:</span> {s.followUpNote}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] shrink-0"
              onClick={() => clearFollowUpMutation.mutate(s)}
              disabled={clearFollowUpMutation.isPending}
              data-testid="button-run-insights-followup-clear"
            >
              Got it
            </Button>
          </div>
        ))}
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </div>
        ) : current ? (
          <div className="space-y-2" data-testid={`suggestion-${current.type}`}>
            <p className="text-sm font-semibold">
              {productLabel(current)}
              {current.dieType ? (
                <span className="text-muted-foreground font-normal"> · {current.dieType}</span>
              ) : null}
            </p>
            <p className="text-sm">{current.narrative || current.statsLine}</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md bg-muted/50 px-2 py-1.5">
                <p className="text-muted-foreground">Configured</p>
                <p className="font-semibold">
                  {current.configuredValue} {current.unit}
                </p>
              </div>
              <div className="rounded-md bg-muted/50 px-2 py-1.5">
                <p className="text-muted-foreground">Observed ({current.runCount} runs)</p>
                <p className="font-semibold">
                  {current.observedValue} {current.unit}
                </p>
              </div>
              <div className="rounded-md bg-primary/10 px-2 py-1.5">
                <p className="text-muted-foreground">
                  Suggested {settingLabel(current).toLowerCase()}
                </p>
                <p className="font-semibold text-primary">
                  {current.recommendedValue} {current.unit}
                </p>
              </div>
            </div>
            {acceptWarning && (
              <p
                className="text-xs text-amber-500 flex items-start gap-1"
                data-testid="text-run-insights-accept-warning"
              >
                <span className="shrink-0 mt-px">⚠</span>
                <span>{acceptWarning}</span>
              </p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => acceptMutation.mutate(current)}
                disabled={busy}
                data-testid="button-run-insights-accept"
              >
                {acceptMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => dismissMutation.mutate(current)}
                disabled={busy}
                data-testid="button-run-insights-dismiss"
              >
                <X className="w-3.5 h-3.5" />
                Dismiss
              </Button>
              {pending.length > 1 && (
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {pending.length - 1} more waiting
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Dismissed suggestions toggle */}
        {dismissed.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              data-testid="button-run-insights-show-dismissed"
            >
              {showDismissed ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
            </button>

            {showDismissed && (
              <div className="space-y-2 mt-1" data-testid="section-dismissed-suggestions">
                {dismissed.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-muted bg-muted/30 px-3 py-2 space-y-1"
                    data-testid={`dismissed-suggestion-${s.type}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">
                          {productLabel(s)}
                          {s.dieType ? (
                            <span className="font-normal"> · {s.dieType}</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {settingLabel(s)}: {s.configuredValue} → {s.recommendedValue} {s.unit}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px] shrink-0 gap-1"
                        onClick={() => reopenMutation.mutate(s)}
                        disabled={reopenMutation.isPending}
                        data-testid="button-run-insights-reopen"
                      >
                        {reopenMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        Re-open
                      </Button>
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
