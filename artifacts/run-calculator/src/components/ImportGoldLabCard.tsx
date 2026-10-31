import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyImportGoldSyntheticReview,
  deleteImportGoldCleanupCase,
  deleteImportGoldCase,
  downloadImportGoldJsonl,
  fetchImportGoldCleanupPage,
  fetchImportGoldCases,
  fetchImportGoldConfig,
  fetchImportGoldSyntheticReview,
  scoreImportGold,
  setImportGoldLocalScoringEnabled,
  setImportGoldExcluded,
  type ImportGoldCase,
  type ImportGoldCleanupCase,
  type ImportGoldConfig,
  type ImportGoldSyntheticReview,
} from "@/importGold";

import ImportGoldRetentionCard from "@/components/ImportGoldRetentionCard";

export default function ImportGoldLabCard() {
  const [config, setConfig] = useState<ImportGoldConfig | null>(null);
  const [cases, setCases] = useState<ImportGoldCase[]>([]);
  const [cleanupCases, setCleanupCases] = useState<ImportGoldCleanupCase[]>([]);
  const cleanupCursorRef = useRef<string | undefined>(undefined);
  const [cleanupNextCursor, setCleanupNextCursor] = useState<string | null>(null);
  const [cleanupLoaded, setCleanupLoaded] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [syntheticReview, setSyntheticReview] = useState<ImportGoldSyntheticReview | null>(null);
  const [reviewedSynthetic, setReviewedSynthetic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const setOperationBusy = (next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  };

  const refresh = useCallback(async (allowWhileBusy = false) => {
    if (busyRef.current && !allowWhileBusy) return;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    setCleanupLoading(true);
    const pending = (async () => {
      try {
        setError(null);
        const nextConfig = await fetchImportGoldConfig();
        setConfig(nextConfig);
        if (nextConfig.cleanupEnabled) {
          setCases([]);
          setSyntheticReview(null);
          setCleanupLoading(true);
          const page = await fetchImportGoldCleanupPage(cleanupCursorRef.current);
          setCleanupCases(page.cases);
          setCleanupNextCursor(page.nextCursor);
          setCleanupLoaded(true);
        } else if (nextConfig.enabled || nextConfig.syntheticFixtureAvailable) {
          setCleanupCases([]);
          const [nextCases, nextReview] = await Promise.all([
            fetchImportGoldCases(),
            nextConfig.syntheticFixtureAvailable ? fetchImportGoldSyntheticReview() : Promise.resolve(null),
          ]);
          setCases(nextCases);
          setCleanupCases([]);
          setSyntheticReview(nextReview);
        } else {
          setCases([]);
          setCleanupCases([]);
          setSyntheticReview(null);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load evaluation cases.");
      } finally {
        setCleanupLoading(false);
      }
    })();
    refreshInFlightRef.current = pending;
    try {
      await pending;
    } finally {
      if (refreshInFlightRef.current === pending) refreshInFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 15_000);
    const onFocus = () => {
      if (!busyRef.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  useEffect(() => { setReviewedSynthetic(false); }, [syntheticReview?.fixtureVersion]);

  const runScore = async (provider: "local" | "gemini") => {
    setOperationBusy(true);
    setError(null);
    try {
      await refreshInFlightRef.current;
      const result = await scoreImportGold(provider);
      await refresh(true);
      if (result.errorCount > 0) {
        setError(`${result.errorCount} score attempt${result.errorCount === 1 ? "" : "s"} failed. The saved case rows show the bounded error code; correct evaluator availability before retrying.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scoring could not be started.");
    } finally {
      setOperationBusy(false);
    }
  };
  const toggleLocalScoring = async (enabled: boolean) => {
    setOperationBusy(true);
    setError(null);
    try {
      await setImportGoldLocalScoringEnabled(enabled);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update local scoring access.");
    } finally {
      setOperationBusy(false);
    }
  };
  const applySyntheticSample = async () => {
    if (!syntheticReview || !reviewedSynthetic) return;
    setOperationBusy(true);
    setError(null);
    try {
      await applyImportGoldSyntheticReview(syntheticReview.fixtureVersion);
      setReviewedSynthetic(false);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the synthetic sample.");
    } finally {
      setOperationBusy(false);
    }
  };
  const toggleExcluded = async (item: ImportGoldCase) => {
    setOperationBusy(true);
    try {
      await setImportGoldExcluded(item.id, !item.excluded);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the case.");
    } finally {
      setOperationBusy(false);
    }
  };
  const remove = async (item: ImportGoldCase) => {
    await removeCase(item.id);
  };
  const removeCase = async (caseId: number) => {
    if (!window.confirm(`Permanently delete evaluation case #${caseId} and its scores?`)) return;
    setOperationBusy(true);
    try {
      await deleteImportGoldCase(caseId);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the case.");
    } finally {
      setOperationBusy(false);
    }
  };
  const removeCleanupCase = async (item: ImportGoldCleanupCase) => {
    if (!window.confirm(
      `Permanently delete evaluation case #${item.id} and its score history from application storage? This does not delete source workbooks, exports, or backups.`,
    )) return;
    setOperationBusy(true);
    try {
      await deleteImportGoldCleanupCase(item.id);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the case.");
    } finally {
      setOperationBusy(false);
    }
  };
  const exportCases = async () => {
    try { await downloadImportGoldJsonl(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not export evaluation cases."); }
  };

  const activeCount = cases.filter((item) => !item.excluded).length;
  const summaries = ["local", "gemini"].map((provider) => {
    const scores = cases.flatMap((item) => item.scores).filter((score) => score.provider === provider && score.status === "scored");
    return { provider, scores, average: scores.length ? scores.reduce((sum, score) => sum + (score.accuracy ?? 0), 0) / scores.length : null };
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm" aria-labelledby="import-gold-heading" data-testid="import-gold-lab">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="import-gold-heading" className="text-base font-semibold text-foreground">Import Gold Lab</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Evaluation cases use only results that a person reviewed and successfully applied. Scoring never writes to recipes or inventory.
          </p>
        </div>
        {config && !config.cleanupEnabled && (config.enabled || config.syntheticFixtureAvailable) && (
          <div className="flex flex-wrap gap-2">
            {config.localScoringEnabled && config.localConfigured && (
              <button type="button" disabled={busy || activeCount === 0} onClick={() => void runScore("local")} className="min-h-11 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Score locally</button>
            )}
            {config.enabled && config.geminiConfigured && (
              <button type="button" disabled={busy || activeCount === 0} onClick={() => void runScore("gemini")} className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50">Compare with Gemini</button>
            )}
            <button type="button" disabled={busy || activeCount === 0} onClick={() => void exportCases()} className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50">Export JSONL</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
      {!config ? <p className="mt-3 text-sm text-muted-foreground">Checking evaluator settings…</p> : (
        <>
          {!config.cleanupEnabled && config.localScoringSwitchAvailable && (
            <div className="mt-3 rounded-md border border-border p-3">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={config.localScoringEnabled}
                  disabled={busy}
                  onChange={(event) => void toggleLocalScoring(event.target.checked)}
                  aria-label="Enable local scoring in this development workspace"
                  className="h-5 w-5 accent-primary"
                />
                Enable app-side local scoring in this development workspace
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                This setting does not start or stop the private evaluator, approve real-source capture, enable Gemini, or change general AI routing.
              </p>
              <p className="mt-2 text-sm" role="status" aria-live="polite">
                Local evaluator: {config.localConfigured ? "configured" : "not configured"}; {config.localAvailable ? "available" : "unavailable"}.
                {config.localScoringEnabled ? " App scoring access is enabled." : " App scoring access is disabled."}
              </p>
              {config.localScoringEnabled && config.localConfigured && !config.localAvailable && (
                <p className="mt-1 text-xs text-muted-foreground">
                  A score attempt can record a safe provider-unavailable result; import Apply remains independent.
                </p>
              )}
            </div>
          )}
          {!config.cleanupEnabled && !config.localScoringSwitchAvailable && (
            <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              Local scoring controls are available only in a development workspace.
            </p>
          )}
          {!config.enabled && (
            <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              Real-source Import Gold capture and scoring remain disabled until the required source-use and retention approvals are configured.
              {config.syntheticFixtureAvailable ? " This development workspace can use only the fixed synthetic sample below; the local scoring switch does not enable real-source capture." : ""}
            </p>
          )}
          <ImportGoldRetentionCard
            canDeleteCase={config.enabled || config.syntheticFixtureAvailable}
          />
          {config.syntheticFixtureAvailable && syntheticReview && (
            <div className="mt-3 rounded-md border border-dashed border-border p-3" data-testid="import-gold-synthetic-review">
              <h3 className="font-medium">Review a synthetic import sample</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                This fixed fixture contains no workbook or customer data. Applying it creates an evaluation case only; recipes, inventory, approvals, and evaluator workflow state are unchanged.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                <div className="min-w-0 rounded bg-muted/40 p-2">
                  <h4 className="text-xs font-semibold">Synthetic input</h4>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(syntheticReview.input, null, 2)}</pre>
                </div>
                <div className="min-w-0 rounded bg-muted/40 p-2">
                  <h4 className="text-xs font-semibold">Reviewed expected result</h4>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(syntheticReview.expectedResult, null, 2)}</pre>
                </div>
              </div>
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={reviewedSynthetic}
                  disabled={busy}
                  onChange={(event) => setReviewedSynthetic(event.target.checked)}
                  className="h-5 w-5 accent-primary"
                />
                I reviewed this synthetic sample and expected result
              </label>
              <button
                type="button"
                disabled={busy || !reviewedSynthetic}
                onClick={() => void applySyntheticSample()}
                className="mt-2 min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
              >
                Apply synthetic sample
              </button>
            </div>
          )}
        </>
      )}
      {config?.cleanupEnabled && (
        <div className="mt-3 rounded-md border border-border p-3" data-testid="import-gold-cleanup-only">
          <h3 className="font-medium">Cleanup retained evaluation cases</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Source approval is off. This view shows only case IDs, import types, and creation times; it does not read case contents or score details.
            Deletion removes the case and score history from application storage, not source workbooks, exports, or backups.
          </p>
          <div className="mt-3 space-y-2">
            {cleanupCases.map((item) => (
              <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3" data-testid={`import-gold-cleanup-case-${item.id}`}>
                <div>
                  <div className="font-medium capitalize">{item.importType} · #{item.id}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                </div>
                <button
                  type="button"
                  disabled={busy || cleanupLoading || !!error}
                  onClick={() => void removeCleanupCase(item)}
                  className="min-h-11 rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50"
                >
                  Delete case and scores
                </button>
              </article>
            ))}
            {cleanupCases.length === 0 && cleanupLoaded && !error && !cleanupLoading && (
              <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">No retained cases are available for cleanup in this scope.</p>
            )}
            {cleanupLoading && <p role="status" className="text-sm text-muted-foreground">Loading cleanup inventory…</p>}
            {error && cleanupCases.length > 0 && (
              <p className="text-sm text-muted-foreground">Previously loaded cases are shown. Refresh successfully before deleting.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-md border px-3 py-2 text-sm"
                disabled={busy || cleanupLoading}
                onClick={() => { cleanupCursorRef.current = undefined; void refresh(); }}>
                Newest cases
              </button>
              {cleanupNextCursor && (
                <button type="button" className="min-h-11 rounded-md border px-3 py-2 text-sm"
                  disabled={busy || cleanupLoading || !!error}
                  onClick={() => { cleanupCursorRef.current = cleanupNextCursor; void refresh(); }}>
                  Older cases
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {config && !config.cleanupEnabled && (config.enabled || config.syntheticFixtureAvailable) && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-muted/40 p-3 text-sm"><span className="font-medium">{activeCount}</span> active / {cases.length} cases</div>
            {summaries.map(({ provider, scores, average }) => (
              <div key={provider} className="rounded-md bg-muted/40 p-3 text-sm">
                <span className="font-medium capitalize">{provider}</span>: {average === null ? "not scored" : `${average.toFixed(1)}% average field agreement`} ({scores.length} successful scores)
              </div>
            ))}
          </div>
          {config.enabled && <p className="mt-2 text-xs text-muted-foreground">{config.retention} Factory purge does not delete these cases; delete them here by the displayed deadline.</p>}
          <div className="mt-3 space-y-3">
            {cases.map((item) => (
              <article key={item.id} className={`rounded-md border border-border p-3 ${item.excluded ? "opacity-60" : ""}`} data-testid={`import-gold-case-${item.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium capitalize">{item.importType} · {item.sourceLabel} · #{item.id}{item.excluded ? " · excluded" : ""}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {item.scores.map((score) => (
                        <span key={score.id} className="rounded bg-muted px-2 py-1">
                          {score.provider}: {score.status === "scored" ? `${score.accuracy}% (${score.equalFields}/${score.comparedFields})` : `error: ${score.errorCode}`}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => void toggleExcluded(item)} className="rounded border border-border px-2 py-1 text-xs">{item.excluded ? "Include" : "Exclude"}</button>
                    <button type="button" disabled={busy} onClick={() => void remove(item)} className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive">Delete</button>
                  </div>
                </div>
                {item.scores.some((score) => score.fieldDiffs?.length) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium">Review field differences</summary>
                    <div className="mt-2 space-y-1">
                      {item.scores.flatMap((score) => score.fieldDiffs.map((diff, index) => (
                        <div key={`${score.id}-${index}`} className="grid grid-cols-1 gap-1 rounded bg-muted/40 p-2 text-xs sm:grid-cols-3">
                          <strong className="break-all">{score.provider}: {diff.field}</strong>
                          <span className="break-all">Expected: {JSON.stringify(diff.expected)}</span>
                          <span className="break-all">Predicted: {JSON.stringify(diff.predicted)}</span>
                        </div>
                      )))}
                    </div>
                  </details>
                )}
              </article>
            ))}
            {cases.length === 0 && <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              {config.syntheticFixtureAvailable
                ? "No evaluation cases yet. Review and apply the fixed synthetic sample above, or use an authorized real-source import only when the separate approval gate is enabled."
                : "No cases have been captured yet. A manager can opt in during an import review, and the case is saved only if Apply succeeds."}
            </p>}
          </div>
        </>
      )}
    </section>
  );
}
