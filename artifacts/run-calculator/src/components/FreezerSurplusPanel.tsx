import { useState } from "react";
import { Snowflake } from "lucide-react";
import { todayStr } from "../utils";
import type { RunMeta } from "../types";
import {
  isMatchingSurplusProduct,
  summarizeSurplusForRun,
  type FreezerSurplusLedger,
} from "@workspace/freezer-pull";
import { getFreezerSurplusRemainingMs } from "../freezerSurplus";

export function FreezerSurplusPanel({
  mode,
  ledger,
  loaded,
  busy,
  error,
  completedRun,
  freezerTimeMin,
  nowMs,
  pendingRuns,
  getOriginalTarget,
  onConfirm,
  onAllocate,
}: {
  mode: "packaging" | "warehouse";
  ledger: FreezerSurplusLedger;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  completedRun?: RunMeta | null;
  freezerTimeMin?: number;
  nowMs?: number;
  pendingRuns?: RunMeta[];
  getOriginalTarget: (run: RunMeta) => number;
  onConfirm: (run: RunMeta, cases: number, date: string) => Promise<void>;
  onAllocate: (run: RunMeta, allocations: Array<{ lotId: string; cases: number }>) => Promise<void>;
}) {
  const [cases, setCases] = useState("");
  const [productionDate, setProductionDate] = useState(todayStr());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, Record<string, number>>>({});
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [confirmedRunId, setConfirmedRunId] = useState<string | null>(null);
  const runs = pendingRuns ?? [];

  async function confirmLot() {
    const count = Number(cases);
    if (!completedRun || !Number.isSafeInteger(count) || count <= 0) {
      setLocalMessage("Enter a positive whole number of excess cases.");
      return;
    }
    if (!productionDate) {
      setLocalMessage("Choose the production date for this freezer lot.");
      return;
    }
    try {
      await onConfirm(completedRun, count, productionDate);
      setCases("");
      setConfirmedRunId(completedRun.id);
      setLocalMessage(`Added ${count} cases as a new freezer lot dated ${productionDate}.`);
    } catch {
      // The parent exposes the server's actionable error.
    }
  }

  async function saveSelection(run: RunMeta) {
    const byLot = selections[run.id] ?? {};
    const allocations = Object.entries(byLot)
      .filter(([, count]) => count > 0)
      .map(([lotId, count]) => ({ lotId, cases: count }));
    try {
      await onAllocate(run, allocations);
      setSelectedRunId(null);
      setLocalMessage(
        allocations.length > 0
          ? `Applied ${allocations.reduce((sum, item) => sum + item.cases, 0)} carried-in cases to ${run.brand}${run.flavor ? ` — ${run.flavor}` : ""}.`
          : "Pull released. The run keeps its full original target.",
      );
    } catch {
      // The parent exposes the server's actionable error.
    }
  }

  if (mode === "packaging") {
    if (!completedRun?.brand && !completedRun?.flavor) return null;
    const remainingMs = getFreezerSurplusRemainingMs({
      endedAt: completedRun.endedAt,
      freezerTimeMin: freezerTimeMin ?? 0,
      nowMs: nowMs ?? 0,
    });
    if (confirmedRunId === completedRun.id || remainingMs <= 0) return null;
    return (
      <section className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4" data-testid="freezer-surplus-confirm">
        <div className="flex items-start gap-3">
          <Snowflake className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">Confirm finished-case freezer surplus</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Record excess cases from the completed run as a separate dated lot. This does not change any future run until Warehouse explicitly pulls it.
            </p>
            <p className="mt-2 text-sm font-semibold">
              {completedRun.brand}{completedRun.flavor ? ` — ${completedRun.flavor}` : ""}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_10rem_auto]">
              <label className="text-xs font-semibold text-muted-foreground">
                Excess cases
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={cases}
                  onChange={(event) => setCases(event.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  aria-label="Excess finished cases"
                />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                Production date
                <input
                  type="date"
                  value={productionDate}
                  onChange={(event) => setProductionDate(event.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  aria-label="Freezer lot production date"
                />
              </label>
              <button
                type="button"
                onClick={() => void confirmLot()}
                disabled={busy}
                className="self-end rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Saving…" : "Confirm surplus"}
              </button>
            </div>
            {localMessage && <p className="mt-2 text-xs font-medium text-primary" role="status">{localMessage}</p>}
            {error && <p className="mt-2 text-xs font-semibold text-destructive" role="alert">{error}</p>}
          </div>
        </div>
      </section>
    );
  }

  const lots = ledger.lots.filter((lot) => lot.remainingCases > 0);
  return (
    <section className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4" data-testid="freezer-surplus-warehouse">
      <div className="flex items-start gap-3">
        <Snowflake className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">Dated freezer surplus</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select a dated lot and case count before the matching run starts. Unselected lots stay available; no selection means the full target is produced.
          </p>
          {error && <p className="mt-2 text-xs font-semibold text-destructive" role="alert">{error}</p>}
          {!loaded && <p className="mt-3 text-xs text-muted-foreground">Loading server-confirmed lots…</p>}
          {loaded && runs.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">No unstarted matching runs are waiting for a freezer pull.</p>
          )}
          <div className="mt-3 space-y-3">
            {runs.map((run) => {
              const summary = summarizeSurplusForRun({
                runId: run.id,
                brand: run.brand,
                flavor: run.flavor,
                originalTarget: getOriginalTarget(run),
                lots: ledger.lots,
                allocations: ledger.allocations,
              });
              const productLots = lots.filter((lot) => isMatchingSurplusProduct(lot, run));
              const current = selections[run.id] ?? Object.fromEntries(
                summary.selected.map((allocation) => [allocation.lotId, allocation.cases]),
              );
              const isEditing = selectedRunId === run.id;
              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-border/50 bg-background/60 p-3"
                  data-testid={`freezer-surplus-run-${run.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{run.brand}{run.flavor ? ` — ${run.flavor}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        Original target <strong className="text-foreground">{summary.originalTarget}</strong>
                        {" · "}Carried in <strong className="text-sky-300">{summary.carriedInCases}</strong>
                        {" · "}Still to produce <strong className="text-foreground">{summary.productionCases}</strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedRunId(isEditing ? null : run.id)}
                      className="rounded-md border border-sky-500/40 px-2.5 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/10"
                    >
                      {isEditing ? "Close pull" : summary.carriedInCases > 0 ? "Revise pull" : "Choose pull"}
                    </button>
                  </div>
                  {isEditing && (
                    <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                      {productLots.length === 0 ? (
                        <p className="text-xs italic text-muted-foreground">No available dated lot matches this brand and flavor.</p>
                      ) : productLots.map((lot) => (
                        <label key={lot.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>
                            {lot.productionDate} · {lot.remainingCases} available
                          </span>
                          <input
                            type="number"
                            min="0"
                            max={lot.remainingCases + (current[lot.id] ?? 0)}
                            step="1"
                            value={current[lot.id] ?? 0}
                            onChange={(event) => {
                              const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                              setSelections((prev) => ({
                                ...prev,
                                [run.id]: { ...(prev[run.id] ?? current), [lot.id]: next },
                              }));
                            }}
                            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm"
                            aria-label={`Cases from freezer lot dated ${lot.productionDate}`}
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        onClick={() => void saveSelection(run)}
                        disabled={busy}
                        className="mt-2 rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Confirm pull"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {localMessage && <p className="mt-2 text-xs font-medium text-sky-300" role="status">{localMessage}</p>}
        </div>
      </div>
    </section>
  );
}
