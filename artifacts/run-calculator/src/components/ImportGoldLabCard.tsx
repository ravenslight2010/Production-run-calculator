import { useCallback, useEffect, useState } from "react";
import {
  deleteImportGoldCase,
  downloadImportGoldJsonl,
  fetchImportGoldCases,
  fetchImportGoldConfig,
  scoreImportGold,
  setImportGoldExcluded,
  type ImportGoldCase,
  type ImportGoldConfig,
} from "@/importGold";

export default function ImportGoldLabCard() {
  const [config, setConfig] = useState<ImportGoldConfig | null>(null);
  const [cases, setCases] = useState<ImportGoldCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const nextConfig = await fetchImportGoldConfig();
      setConfig(nextConfig);
      if (nextConfig.enabled) setCases(await fetchImportGoldCases());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load evaluation cases.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runScore = async (provider: "local" | "gemini") => {
    setBusy(true);
    setError(null);
    try {
      await scoreImportGold(provider);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scoring could not be started.");
    } finally {
      setBusy(false);
    }
  };
  const toggleExcluded = async (item: ImportGoldCase) => {
    setBusy(true);
    try {
      await setImportGoldExcluded(item.id, !item.excluded);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the case.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (item: ImportGoldCase) => {
    if (!window.confirm("Permanently delete this evaluation case and its scores?")) return;
    setBusy(true);
    try {
      await deleteImportGoldCase(item.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the case.");
    } finally {
      setBusy(false);
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
        {config?.enabled && (
          <div className="flex flex-wrap gap-2">
            {config.localConfigured && <button type="button" disabled={busy || activeCount === 0} onClick={() => void runScore("local")} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Score locally</button>}
            {config.geminiConfigured && <button type="button" disabled={busy || activeCount === 0} onClick={() => void runScore("gemini")} className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50">Compare with Gemini</button>}
            <button type="button" disabled={busy || activeCount === 0} onClick={() => void exportCases()} className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50">Export JSONL</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
      {!config ? <p className="mt-3 text-sm text-muted-foreground">Checking evaluator settings…</p> : !config.enabled ? (
        <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">Import Gold is disabled. Capture and scoring stay off until an administrator enables the feature after confirming evaluation-use and retention authorization.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-muted/40 p-3 text-sm"><span className="font-medium">{activeCount}</span> active / {cases.length} cases</div>
            {summaries.map(({ provider, scores, average }) => (
              <div key={provider} className="rounded-md bg-muted/40 p-3 text-sm">
                <span className="font-medium capitalize">{provider}</span>: {average === null ? "not scored" : `${average.toFixed(1)}% average field agreement`} ({scores.length} successful scores)
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{config.retention} Factory purge does not delete these cases; delete them here when retention ends.</p>
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
            {cases.length === 0 && <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">No cases have been captured yet. A manager can opt in during an import review, and the case is saved only if Apply succeeds.</p>}
          </div>
        </>
      )}
    </section>
  );
}
