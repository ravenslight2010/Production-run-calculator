import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Droplets, Timer } from "lucide-react";
import { computeSauceRunRequirement } from "@workspace/live-calc";
import type { RecipeRow, RunMeta } from "../../types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { BatchMadeRow } from "./BatchMadeRow";
import { TickBar } from "../TickBar";
import { ReadOnlyRecipeCard, fmtMS } from "./stationShared";
import { useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { useLiveRun } from "../../contexts/LiveRunContext";
import { useManualControlLock, getManualSectionLock } from "../../manualSectionLocks";
import { usePrepPhase } from "../../hooks/usePrepPhase";
import { consumeSauceBarrel } from "../../inventoryShared";
import { getSauceBarrelEntry, mirrorSauceBarrelProgress } from "../../sauceBarrelStore";
import { markRunValuesUpdated } from "../../adapters/browserRunPersistence";
import { createPackagingControlAdapter } from "../../packagingManager";
import { fmtNum } from "../../utils";

export const LiveSauceTabContent = memo(function LiveSauceTabContent() {
  const hx = useHomeTabCtx();
  const {
    v, runStatus, currentRunId, currentRun, dayState, dayStateRef, setDayState, schedulePush,
    form, autoSuppressUntilRef, lastLocalEditRef, persistManualPackagingProgress, queueManualCorrection, setWriteError,
    sauceAutoTrackFailure, dismissSauceAutoTrackFailure,
  } = hx;
  // elapsedBatchSec is pause-aware: it uses currentRun.pausedAt when paused,
  // so it stops growing during a pause — no wall-clock deltas needed downstream.
  const { calc, nowTime, nextRunPrepActive, elapsedBatchSec, autoTrackProgress, autoTrackSuggestion, fireAutoTrackNow, tickDueRefs, packagingDrainActive, detectPackagingSpeedDrift } = useLiveRun();
  const packagingLock = useManualControlLock(currentRunId, "packaging-skids");
  const sauceLock = useManualControlLock(currentRunId, "sauce-batches");

  // ── Barrel progress: backed by module-level store so it survives Radix ────
  // TabsContent unmounts (inactive tabs are unmounted by default).  Lazy
  // initialisers read the stored progress on every mount so switching away and
  // back restores the canonical barrel count and anchor.
  const [sauceMade, setSauceMadeRaw] = useState(
    () => Math.max(0, Number(v.sauceBarrelsMade) || getSauceBarrelEntry(currentRunId).barrelsMade),
  );

  // Anchor in net-production elapsed seconds when the current barrel started.
  // 0 means "since run start".  No wall-clock timestamp involved.
  const lastBarrelNetSecRef = useRef<number>(
    Math.max(0, Number(v.sauceBarrelAnchorNetSec) || getSauceBarrelEntry(currentRunId).lastBarrelNetSec),
  );

  const applyManualSauceProgress = useCallback((
    nextMade: number,
    nextAnchor: number,
    targetCorrectionGeneration?: number,
  ) => {
    const made = Math.max(0, Math.floor(nextMade));
    const anchor = Math.max(0, Math.floor(nextAnchor));
    const correctionGeneration = targetCorrectionGeneration
      ?? Math.max(0, Number(form.getValues("sauceBarrelCorrectionGeneration")) || 0) + 1;
    const baseline = {
      sauceBarrelsMade: Number(form.getValues("sauceBarrelsMade")) || 0,
      sauceBarrelAnchorNetSec: Number(form.getValues("sauceBarrelAnchorNetSec")) || 0,
      sauceBarrelCorrectionGeneration: Number(form.getValues("sauceBarrelCorrectionGeneration")) || 0,
    };
    form.setValue("sauceBarrelsMade", made, { shouldDirty: true });
    form.setValue("sauceBarrelAnchorNetSec", anchor, { shouldDirty: true });
    form.setValue("sauceBarrelCorrectionGeneration", correctionGeneration, { shouldDirty: true });
    mirrorSauceBarrelProgress(currentRunId, { barrelsMade: made, lastBarrelNetSec: anchor });
    setSauceMadeRaw(made);
    lastBarrelNetSecRef.current = anchor;
    const now = Date.now();
    markRunValuesUpdated(currentRunId, now);
    lastLocalEditRef.current = now;
    queueManualCorrection(currentRunId, {
      sauceBarrelsMade: made, sauceBarrelAnchorNetSec: anchor,
      sauceBarrelCorrectionGeneration: correctionGeneration,
    }, baseline);
  }, [currentRunId, form, lastLocalEditRef, queueManualCorrection]);
  // Prep phase: shared prepStartedAt with dough tab, own sauce batch counter.
  const {
    prep, prepActive, elapsedSec: prepElapsedSec, startPrep, addPrepBatchSauce,
  } = usePrepPhase({ dayState, dayStateRef, setDayState, schedulePush, nowMs: nowTime.getTime(), doughBatchSec: 580, sauceBatchSec: 1800 });

  // Canonical progress comes from synchronized run values. Mirror it into the
  // tab-surviving UI store so automatic advances remain visible across
  // navigation, reload, run switching, and peer reconciliation.
  useEffect(() => {
    const made = Math.max(0, Math.floor(Number(v.sauceBarrelsMade) || 0));
    const anchor = Math.max(0, Math.floor(Number(v.sauceBarrelAnchorNetSec) || 0));
    mirrorSauceBarrelProgress(currentRunId, { barrelsMade: made, lastBarrelNetSec: anchor });
    setSauceMadeRaw(made);
    lastBarrelNetSecRef.current = anchor;
  }, [currentRunId, v.sauceBarrelAnchorNetSec, v.sauceBarrelsMade]);
  useEffect(() => {
    if (runStatus !== "ended") return;
    mirrorSauceBarrelProgress(currentRunId, { barrelsMade: 0, lastBarrelNetSec: 0 });
    setSauceMadeRaw(0);
    lastBarrelNetSecRef.current = 0;
  }, [currentRunId, runStatus]);
  // Seed sauceMade from prep batches when run first starts (guarded by prepCarriedOver).
  useEffect(() => {
    if (runStatus === "running" && prep.prepCarriedOver && prep.prepBatchesSauce > 0) {
      if ((Number(v.sauceBarrelsMade) || 0) === 0) {
        applyManualSauceProgress(prep.prepBatchesSauce, elapsedBatchSec);
      }
    }
  }, [
    applyManualSauceProgress,
    elapsedBatchSec,
    prep.prepBatchesSauce,
    prep.prepCarriedOver,
    runStatus,
    v.sauceBarrelsMade,
  ]);

  const isLive = runStatus === "running" || runStatus === "paused";
  const sauceRequirement = computeSauceRunRequirement({
    casesNeeded: v.casesNeeded,
    pizzasPerCase: v.pizzasPerCase,
    ozPerPizza: v.sauceOzPerPizza,
    barrelLbs: calc.sauceEffBarrel,
  });

  return (
    <>
      {/* ── Sauce Prep Section (shown before production starts) ─────────────── */}
      {runStatus === "pending" && !prep.prepCarriedOver && dayState.runs.every((r: RunMeta) => !r.startedAt) && (
        <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
          <div className="h-1 bg-red-400 w-full" />
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Timer className="w-4 h-4" /> Sauce Prep
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {!prepActive ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Press <span className="font-semibold">Start Prep</span> to begin tracking pre-production sauce batches.
                </p>
                <Button size="sm" className="w-fit" onClick={startPrep}>
                  Start Prep
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <span className="font-mono font-semibold tabular-nums">{prep.prepBatchesSauce}</span>
                    <span className="text-muted-foreground"> of 1 batch ready</span>
                  </span>
                  {prep.prepBatchesSauce < 1 && (
                    <Button size="sm" variant="outline" onClick={addPrepBatchSauce}>+1 Batch</Button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Prep elapsed:</span>
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {(() => { const s = Math.max(0, Math.floor(prepElapsedSec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; })()}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {sauceAutoTrackFailure && !sauceAutoTrackFailure.dismissed && (
        <div
          role="alert"
          data-testid="sauce-auto-track-failure"
          className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1">
            Automatic Sauce barrel tracking is delayed. Inventory was not advanced; the same barrel will retry when the connection is ready.
          </p>
          <button
            type="button"
            data-testid="button-dismiss-sauce-auto-track-failure"
            onClick={dismissSauceAutoTrackFailure}
            className="shrink-0 text-xs font-semibold text-amber-200 hover:text-amber-50"
          >
            Dismiss
          </button>
        </div>
      )}
      {sauceRequirement.totalUnits > 0 && (
        <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
          <div className="h-1 bg-primary w-full" />
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Droplets className="w-4 h-4" /> Sauce Batches Needed
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <p className="text-xs text-muted-foreground mb-4">
              Based on{" "}
              <span className="font-mono text-foreground">
                {fmtNum(Math.max(0, calc.casesLeftToRun), 0)}
              </span>{" "}
              cases remaining ×{" "}
              <span className="font-mono text-foreground">
                {v.pizzasPerCase}
              </span>{" "}
              pizzas/case
            </p>
            <BatchMadeRow
              label={v.frontlineRecipeName?.trim() || "Sauce"}
              totalBatches={sauceRequirement.totalUnits}
              made={sauceMade}
              onIncrement={() => {
                const barrelIndex = Math.max(0, Number(v.sauceBarrelsMade) || 0) + 1;
                const targetCorrectionGeneration =
                  Math.max(0, Number(v.sauceBarrelCorrectionGeneration) || 0) + 1;
                // Deterministic until this action commits: retries, reloads, or
                // duplicate taps share one marker, while a decrement advances
                // the generation so a genuinely remade barrel gets a new one.
                const manualEventId =
                  `manual:${targetCorrectionGeneration}:${barrelIndex}`.slice(0, 160);
                const sauceName = (v.frontlineRecipeName ?? "").trim();
                const hasSauceRecipe = (v.frontlineRecipe ?? []).some((r: RecipeRow) => Number(r.lbs ?? 0) > 0);
                const itemKey = hasSauceRecipe
                  ? "ingredient:Sauce:batches"
                  : sauceName
                    ? `ingredient:${sauceName}:lbs`
                    : "";
                const barrelQty = hasSauceRecipe ? 1 : calc.sauceEffBarrel;
                if (itemKey && barrelQty > 0) {
                  const retryDelays = [0, 1_500, 5_000];
                  const attempt = (index: number): void => {
                    window.setTimeout(() => {
                      void consumeSauceBarrel(
                        currentRunId,
                        barrelIndex,
                        itemKey,
                        barrelQty,
                        manualEventId,
                      )
                        .then(() => {
                          applyManualSauceProgress(
                            barrelIndex,
                            elapsedBatchSec,
                            targetCorrectionGeneration,
                          );
                        })
                        .catch(() => {
                          setWriteError(
                            "Couldn't record Sauce barrel usage. Inventory was not advanced; this same barrel is retrying.",
                          );
                          if (index + 1 < retryDelays.length) attempt(index + 1);
                        });
                    }, retryDelays[index]);
                  };
                  attempt(0);
                } else {
                  applyManualSauceProgress(barrelIndex, elapsedBatchSec);
                }
              }}
              onDecrement={() => {
                applyManualSauceProgress(Math.max(0, sauceMade - 1), elapsedBatchSec);
              }}
              isLive={isLive}
              testId="output-sauce-batches"
              pipeline="sauce"
              disabled={!!sauceLock}
              disabledReason={sauceLock?.peer ? "Corrections unavailable while another station is editing." : undefined}
            />
             {/* Passive countdown only. Automatic staged supply determines the
                 visible on-line, ready, in-production, and still-to-make values. */}
            {runStatus === "running" && !calc.pressDone && !nextRunPrepActive && calc.sauceDepletionSec > 0 && (() => {
              // Use pause-aware elapsedBatchSec; lastBarrelNetSecRef is also stored
              // in net-elapsed coords so the delta is naturally pause-safe.
              const barrelElapsed = Math.max(0, elapsedBatchSec - lastBarrelNetSecRef.current);
              const secLeft = Math.max(0, calc.sauceDepletionSec - barrelElapsed);
              const pctLeft = calc.sauceDepletionSec > 0 ? secLeft / calc.sauceDepletionSec : 1;
              const color = pctLeft < 0.15 ? "text-red-400" : "text-blue-400";
              return (
                <TickBar
                  label="Current barrel lasts"
                  secLeft={secLeft}
                  periodSec={calc.sauceDepletionSec}
                  color={color}
                />
              );
            })()}
          </CardContent>
        </Card>
      )}
      {/* Packaging quick check — same widget as the dough tab so the sauce
          crew can update skid/case counts without switching tabs. */}
      {(runStatus === "running" || runStatus === "paused" || (runStatus === "ended" && !!autoTrackSuggestion)) && (() => {
        const hasCps = v.casesPerSkid > 0;
        const cps = hasCps ? v.casesPerSkid : 0;
        const packedSkids = Number(v.skidsCompleted) || 0;
        const packedCasesOnSkid = Number(v.casesOnCurrentSkid) || 0;
        const packedTotal = packedSkids * cps + packedCasesOnSkid;
        const skidsTotal = hasCps && v.casesNeeded > 0 ? Math.ceil(v.casesNeeded / cps) : null;
        const s = autoTrackSuggestion;
        const suppressed = Date.now() < autoSuppressUntilRef.current;
        const caseAutoActive = autoTrackProgress && !!s && !suppressed &&
          (runStatus === "running" || packagingDrainActive);
        const casePeriodSec = calc.ppm > 0 && v.pizzasPerCase > 0 ? (v.pizzasPerCase / calc.ppm) * 60 : 0;
        const nowMs = nowTime.getTime();
        const secLeftOf = (dueMs: number, periodSec: number) =>
          dueMs > 0 ? Math.min(periodSec, Math.max(0, (dueMs - nowMs) / 1000)) : periodSec;
        const expectedTotal = s ? s.expectedCases : null;
        const packGapCases = expectedTotal !== null ? expectedTotal - packedTotal : 0;
        const packOnPace = packGapCases <= 2;
        const packBehindSec = packGapCases * casePeriodSec;
        const packagingControls = createPackagingControlAdapter({
          skidsCompleted: packedSkids,
          casesOnCurrentSkid: packedCasesOnSkid,
          casesPerSkid: cps,
          applyProgress: (nextSkids, nextCases, previousSkids, previousCases) => {
            persistManualPackagingProgress(currentRunId, nextSkids, nextCases, undefined, {
              skidsCompleted: previousSkids,
              casesOnCurrentSkid: previousCases,
            });
            form.setValue("skidsCompleted", nextSkids, { shouldDirty: true });
            form.setValue("casesOnCurrentSkid", nextCases, { shouldDirty: true });
          },
          reportCorrection: (deltaCases) => detectPackagingSpeedDrift(deltaCases),
          isLocked: () => !!getManualSectionLock(currentRunId, "packaging")?.peer,
        });
        const setPackedTotal = (total: number) => packagingControls.setTotal(total);
        const bumpSkids = (d: number) => {
          if (d < 0) packagingControls.decrementSkids();
          else if (d > 0) packagingControls.incrementSkids();
        };
        const bumpCases = (d: number) => {
          if (d < 0) packagingControls.decrementCases();
          else if (d > 0) packagingControls.incrementCases();
        };
        const miniBtn = "h-7 w-7 rounded-md border border-input bg-muted/40 hover:bg-muted text-sm font-bold text-foreground shrink-0 select-none";
        return (
          <div className={`mb-4 rounded-lg border px-4 py-3 ${packOnPace ? "border-border/50 bg-card/60" : "border-amber-600/30 bg-amber-950/10"}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Packaging station — quick check (no tab switch){caseAutoActive ? " · Auto" : ""}
              </p>
              {hasCps && expectedTotal !== null && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  packOnPace
                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/20"
                    : "text-amber-400 border-amber-500/30 bg-amber-950/20"
                }`}>
                  {packOnPace ? "On pace" : `Behind ${packGapCases} case${packGapCases !== 1 ? "s" : ""}`}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Skids done</p>
                <div className="flex items-center justify-center gap-1.5 mt-0.5">
                  <button type="button" onClick={() => hasCps ? setPackedTotal(packedTotal - cps) : bumpSkids(-1)} disabled={!!packagingLock} className={miniBtn} data-testid="btn-dec-packSkids">−</button>
                  <p className="text-xl font-mono font-bold text-foreground tabular-nums">
                    {packedSkids}
                    {skidsTotal !== null && <span className="text-xs text-muted-foreground font-normal">/{skidsTotal}</span>}
                  </p>
                  <button type="button" onClick={() => hasCps ? setPackedTotal(packedTotal + cps) : bumpSkids(1)} disabled={!!packagingLock} className={miniBtn} data-testid="btn-inc-packSkids">+</button>
                </div>
              </div>
              <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cases on skid</p>
                <div className="flex items-center justify-center gap-1.5 mt-0.5">
                  <button type="button" onClick={() => hasCps ? setPackedTotal(packedTotal - 1) : bumpCases(-1)} disabled={!!packagingLock} className={miniBtn} data-testid="btn-dec-packCases">−</button>
                  <p className="text-xl font-mono font-bold text-foreground tabular-nums">
                    {packedCasesOnSkid}
                    {hasCps && <span className="text-xs text-muted-foreground font-normal">/{cps}</span>}
                  </p>
                  <button type="button" onClick={() => hasCps ? setPackedTotal(packedTotal + 1) : bumpCases(1)} disabled={!!packagingLock} className={miniBtn} data-testid="btn-inc-packCases">+</button>
                </div>
              </div>
              <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next case in</p>
                <p className="text-xl font-mono font-bold text-orange-400 mt-0.5 tabular-nums">
                  {caseAutoActive && casePeriodSec > 0 ? fmtMS(secLeftOf(tickDueRefs.case.current, casePeriodSec)) : "—:—"}
                </p>
              </div>
            </div>
            {hasCps && expectedTotal !== null && (
              <p className="text-[10px] text-muted-foreground mt-2">
                {packOnPace ? (
                  <>Packed {packedTotal} cases vs {expectedTotal} expected at line speed — packaging is keeping up.</>
                ) : (
                  <>
                    Packed <span className="text-foreground font-semibold">{packedTotal}</span> cases vs{" "}
                    <span className="text-foreground font-semibold">{expectedTotal}</span> expected at line speed —
                    <span className="text-amber-400 font-semibold"> update packed cases or clear the packaging backlog</span>.
                    That is {fmtMS(packBehindSec)} behind.
                  </>
                )}
              </p>
            )}
          </div>
        );
      })()}
      <ReadOnlyRecipeCard
        title="Sauce Recipe"
        subtitle={v.frontlineRecipeName?.trim() || undefined}
        recipe={v.frontlineRecipe ?? []}
        substitutions={dayState.substitutions ?? []}
        accent="bg-red-500/70"
      />
    </>
  );
});
