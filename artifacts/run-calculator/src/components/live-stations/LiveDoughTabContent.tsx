import { memo, useEffect, useRef, useState } from "react";
import { ArrowRight, AlertTriangle, CheckCircle2, Clock, Pause, PauseCircle, Timer } from "lucide-react";
import { useHomeCtx } from "../../contexts/HomeCtx";
import { useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { useLiveRun } from "../../contexts/LiveRunContext";
import { useManualControlLock, getManualSectionLock } from "../../manualSectionLocks";
import { usePrepPhase } from "../../hooks/usePrepPhase";
import { getAutoTrackTiming, suggestedDoughStaging } from "../../hooks/useAutoTrack";
import { useAutomaticUpdateReloadBlocker } from "../../updateReloadSafety";
import { createPackagingControlAdapter } from "../../packagingManager";
import { markRunValuesUpdated, saveDayState } from "../../storage";
import { getProductionStartTime } from "../../factoryDataSync";
import { StepperField } from "./StepperField";
import { ManualOverrideBanner, manualOverrideBannerShow } from "../ManualOverrideBanner";
import type { RunMeta } from "../../types";
import { DOUGH_TRAY_SECTION_CAPACITY, DOUGH_TRAY_SECTION_COUNT, DOUGH_TRAY_ADVISORY_TOTAL } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { DoughRoleGate } from "../DoughRoleGate";
import RecipeSubstitutionBadge from "../RecipeSubstitutionBadge";
import { ReadOnlyRecipeCard, SecondsField, fmtMS } from "./stationShared";
import { TickBar } from "../TickBar";
import { fmtNum, fmtTime } from "../../utils";

export const LiveDoughTabContent = memo(function LiveDoughTabContent() {
  const doughLock = useManualControlLock(useHomeCtx().currentRun?.id, "dough-trays");
  const packagingLock = useManualControlLock(useHomeCtx().currentRun?.id, "dough-quick-check-skids");
  const hx = useHomeTabCtx();
  const {
    autoSuppressUntilRef, currentRunId, dayState, dayStateRef, doughSubTab,
    form, isSupervisor, persistManualPackagingProgress, queueManualCorrection, runStatus, runToTime,
    schedulePush, setDayState, setRunToTime, v,
  } = hx;

  const {
    calc, nowTime, elapsedBatchSec,
    showBatchDue, setShowBatchDue,
    autoTrackProgress, autoTrackSuggestion,
    fireAutoTrackNow, tickDueRefs, doughAutoSuppressUntilRef,
    isDoughTimerPaused, pauseDoughTimers, resumeDoughTimers,
    nextRunPrepActive, packagingDrainActive, detectPackagingSpeedDrift,
  } = useLiveRun();

  // ── Shift prep phase (pre-production batch tracking) ─────────────────────
  const doughPrepBatchSec = Math.max(30,
    (Number(v.mixerLowSec) || 330) + (Number(v.mixerHighSec) || 180) + (Number(v.hopperSec) || 70),
  );
  const {
    prep, prepActive, elapsedSec: prepElapsedSec, doughSecLeft, doughBatchNum, startPrep, addPrepBatchDough,
  } = usePrepPhase({ dayState, dayStateRef, setDayState, schedulePush, nowMs: nowTime.getTime(), doughBatchSec: doughPrepBatchSec, sauceBatchSec: 1800 });
  const [showPrepBatchDue, setShowPrepBatchDue] = useState(false);
  useAutomaticUpdateReloadBlocker(
    "dough-production-due-alert",
    (!autoTrackProgress && showBatchDue) || showPrepBatchDue,
  );
  const prevDoughBatchNumRef = useRef(0);
  useEffect(() => {
    if (prepActive && doughBatchNum > 0 && doughBatchNum > prevDoughBatchNumRef.current) setShowPrepBatchDue(true);
    prevDoughBatchNumRef.current = doughBatchNum;
  }, [doughBatchNum, prepActive]);
  useEffect(() => { if (runStatus !== "pending") setShowPrepBatchDue(false); }, [runStatus]);

  // Next-run prep handoff reset is handled by LiveRunHandoffGuard (always
  // mounted inside LiveRunProvider) so it fires regardless of which tab is open.

  return (
    <>
      {/* ── Shift Prep Section (shown before production starts) ─────────────────── */}
      {runStatus === "pending" && !prep.prepCarriedOver && doughSubTab === "dough" && dayState.runs.every((r: RunMeta) => !r.startedAt) && (
        <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
          <div className="h-1 bg-amber-500 w-full" />
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Timer className="w-4 h-4" /> Shift Prep
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {!prepActive ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Press <span className="font-semibold">Start Prep</span> to begin tracking pre-production dough batches.
                </p>
                <Button size="sm" className="w-fit" onClick={startPrep}>
                  Start Prep
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Prep elapsed:</span>
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {(() => { const s = Math.max(0, Math.floor(prepElapsedSec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; })()}
                  </span>
                </div>
                {showPrepBatchDue && (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs">
                    <span className="text-amber-600 font-semibold">⚠ Prep batch ready — mark +1 when mixed.</span>
                    <button className="text-muted-foreground hover:text-foreground ml-2" onClick={() => setShowPrepBatchDue(false)}>✕</button>
                  </div>
                )}
                <TickBar label="Next batch due" secLeft={doughSecLeft} periodSec={doughPrepBatchSec} color="text-amber-500" />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm">
                    <span className="font-mono font-semibold tabular-nums">{prep.prepBatchesDough}</span>
                    <span className="text-muted-foreground"> {prep.prepBatchesDough === 1 ? "batch" : "batches"} ready</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={addPrepBatchDough}>+1 Batch</Button>
                </div>
                {(() => {
                  const prodTime = getProductionStartTime();
                  if (!prodTime) return null;
                  const [h, m] = prodTime.split(":").map(Number);
                  const target = new Date(nowTime.getTime());
                  target.setHours(h, m, 0, 0);
                  const msLeft = target.getTime() - nowTime.getTime();
                  if (msLeft <= 0) return null;
                  const minLeft = Math.round(msLeft / 60000);
                  return <p className="text-xs text-muted-foreground mt-1">Production starts in <span className="font-semibold">{minLeft}m</span></p>;
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      )}
                {/* Batch pipeline + measured machine times (dough runs only) */}
                {doughSubTab === "dough" && (() => {
                  const safeLow = Math.max(0, Number(v.mixerLowSec) || 0);
                  const safeHigh = Math.max(0, Number(v.mixerHighSec) || 0);
                  const safeHopper = Math.max(0, Number(v.hopperSec) || 0);
                  const spinTotalSec = safeLow + safeHigh;
                  const timing = getAutoTrackTiming(calc.ppm, v.pizzasPerCase, calc.perTray, calc.perBatch, {
                    spinSec: spinTotalSec,
                    hopperSec: safeHopper,
                  });
                  const lineBatchSec = calc.ppm > 0 && calc.perBatch > 0 ? (calc.perBatch / calc.ppm) * 60 : 0;
                  const measured = spinTotalSec > 0 && lineBatchSec > 0;
                  const supplySec = Math.max(spinTotalSec, safeHopper);
                  const keepUpMargin = lineBatchSec - supplySec;
                  const keepsUp = keepUpMargin >= 0;
                  const running = runStatus === "running" && autoTrackProgress;
                  const nowMs = nowTime.getTime();
                  // The mixer spin countdown anchors to auto-track's "+1 batch"
                  // tick — when times are measured, that tick fires every
                  // spin-total, so display and counter always agree.
                  const batchProdDue = tickDueRefs.batchProd.current;
                  const spinLeft = running && batchProdDue > 0
                    ? Math.min(timing.batchProductionMs / 1000, Math.max(0, (batchProdDue - nowMs) / 1000))
                    : null;
                  const spinElapsed = spinLeft !== null ? Math.max(0, spinTotalSec - spinLeft) : null;
                  const onLowStage = spinElapsed !== null && spinElapsed < safeLow;
                  const stageLeft = spinLeft === null || spinElapsed === null
                    ? null
                    : onLowStage ? safeLow - spinElapsed : spinLeft;
                  const hopperProdDue = tickDueRefs.hopperProd.current;
                  const hopperLeft = running && timing.hopperMs > 0 && hopperProdDue > 0
                    ? Math.min(timing.hopperMs / 1000, Math.max(0, (hopperProdDue - nowMs) / 1000))
                    : null;
                   const suppressedNow = Date.now() < doughAutoSuppressUntilRef.current;
                   const suppressedMinsLeftNow = suppressedNow ? Math.ceil((doughAutoSuppressUntilRef.current - Date.now()) / 60000) : 0;
                  return (
                    <>
                      <ManualOverrideBanner
                         show={manualOverrideBannerShow(autoTrackProgress, autoTrackSuggestion, doughAutoSuppressUntilRef.current)}
                        station="Dough"
                        minsLeft={suppressedMinsLeftNow}
                         onResume={() => { doughAutoSuppressUntilRef.current = 0; fireAutoTrackNow("dough"); }}
                      />
                      <div className="rounded-lg border border-border/50 bg-card/60 px-4 py-3 mb-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Batch Pipeline · 3 max
                            </p>
                            {running && !isDoughTimerPaused && (
                              <button
                                type="button"
                                 onClick={() => pauseDoughTimers()}
                                className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-amber-400 transition-colors"
                                title="Pause dough timers"
                                data-testid="btn-pause-dough-timers"
                              >
                                <Pause className="w-2.5 h-2.5" />
                                Pause
                              </button>
                            )}
                          </div>
                          {isDoughTimerPaused && (
                            <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-card/60 border border-amber-500/20 border-l-4 border-l-amber-500 text-[10px] mb-2" data-testid="dough-timers-paused-banner">
                              <span className="text-amber-400 font-semibold flex items-center gap-1">
                                <PauseCircle className="w-3 h-3 shrink-0" />
                                Timers paused
                              </span>
                              <button
                                type="button"
                                onClick={resumeDoughTimers}
                                className="text-amber-400 hover:text-amber-300 font-semibold ml-2 shrink-0"
                                data-testid="btn-resume-dough-timers"
                              >
                                Resume timers
                              </button>
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">1 · Prepped</p>
                              <p className="text-xs font-semibold text-foreground mt-1">Waiting</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">spins when mixer frees</p>
                            </div>
                            <div className="bg-primary/10 rounded-lg p-2 text-center border border-primary/30">
                              <p className="text-[10px] uppercase tracking-wider text-primary">2 · Spinning</p>
                              <p className="text-xs font-mono font-bold text-primary mt-1 tabular-nums">
                                {isDoughTimerPaused ? "—:—" : spinLeft !== null ? fmtMS(spinLeft) : "—:—"}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {isDoughTimerPaused
                                  ? "timers paused"
                                  : spinTotalSec <= 0
                                    ? "enter mixer times below"
                                    : spinLeft === null
                                      ? "counts while running"
                                      : onLowStage
                                        ? `low speed · ${fmtMS(stageLeft ?? 0)} to high`
                                        : `high speed · ${fmtMS(stageLeft ?? 0)} left`}
                              </p>
                            </div>
                            <div className="bg-muted/20 rounded-lg p-2 text-center border border-orange-500/30">
                              <p className="text-[10px] uppercase tracking-wider text-orange-400">3 · In Hopper</p>
                              <p className="text-xs font-mono font-bold text-orange-400 mt-1 tabular-nums">
                                {isDoughTimerPaused ? "—:—" : hopperLeft !== null ? fmtMS(hopperLeft) : "—:—"}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {isDoughTimerPaused
                                  ? "timers paused"
                                  : safeHopper > 0 ? "until batch is all balls" : "enter hopper time below"}
                              </p>
                            </div>
                          </div>
                          {measured ? (
                            <>
                              <div className={`flex items-center gap-1.5 mt-2 text-[10px] font-semibold ${keepsUp ? "text-emerald-400" : "text-amber-400"}`}>
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                {keepsUp
                                  ? `Keeping up: a fresh batch every ${fmtMS(supplySec)}, line eats one every ${fmtMS(lineBatchSec)} (${fmtMS(keepUpMargin)} spare)`
                                  : `Falling behind: a fresh batch every ${fmtMS(supplySec)}, line eats one every ${fmtMS(lineBatchSec)} (${fmtMS(-keepUpMargin)} short)`}
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                Start prepping the next batch every{" "}
                                <span className="font-mono text-foreground">{fmtMS(supplySec)}</span> — set by the{" "}
                                {spinTotalSec >= safeHopper ? "mixer (low + high)" : "hopper"}.
                              </p>
                            </>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-2">
                              Time your mixer and hopper once, enter the seconds below, and this card shows live spin/hopper
                              countdowns plus whether the mixer keeps up with the line.
                            </p>
                          )}
                        </div>
                      <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2 mb-3">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 shrink-0">
                            <Timer className="w-2.5 h-2.5" /> Machine Times
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">
                            {spinTotalSec > 0 || safeHopper > 0
                              ? `spin ${fmtMS(spinTotalSec)} + hopper ${fmtMS(safeHopper)}`
                              : "time your mixer & hopper for live timers"}
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <SecondsField control={form.control} name="mixerLowSec" label="Mixer low (sec)" />
                          <SecondsField control={form.control} name="mixerHighSec" label="Mixer high (sec)" />
                          <SecondsField control={form.control} name="hopperSec" label="Hopper (sec)" />
                        </div>
                      </div>
                    </>
                  );
                })()}
                {/* What You Need Now — above the steppers, matching the
                    approved mockup's order */}
                <DoughRoleGate isSupervisor={!!isSupervisor}>
                {/* ── Crust run ── */}
                {doughSubTab === "crusts" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
                    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
                      <div className="h-1 bg-sky-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          What You Need Now
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-muted/20 rounded-lg p-3 text-center">
                            <p className="text-3xl font-mono font-bold text-sky-400 tabular-nums" data-testid="output-cases-to-open">{fmtNum(calc.casesLeftToOpen, 0)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Cases to open</p>
                          </div>
                          <div className="bg-muted/20 rounded-lg p-3 text-center">
                            <p className="text-3xl font-mono font-bold tabular-nums" data-testid="output-stacks-needed">{fmtNum(calc.stacksNeededTotal, 0)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Stacks to stage</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* ── Dough run ── */}
                {doughSubTab === "dough" && (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
                  <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden">
                    <div className="h-1 bg-primary w-full" />
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        What You Need Now
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-3">
                        {(() => {
                          const traysOnLine = v.traysOnLine ?? 0;
                          const batchesReady = v.batchesReady ?? 0;
                          const hasDoughOnHand = traysOnLine > 0 || batchesReady > 0;
                          const doughOnHandPizzas = traysOnLine * calc.perTray + batchesReady * calc.perBatch;
                          const onHandBatches = calc.perBatch > 0 ? doughOnHandPizzas / calc.perBatch : 0;
                          const onHandTrays = calc.perTray > 0 ? doughOnHandPizzas / calc.perTray : 0;
                          const totalBatches = calc.batchesNeeded + onHandBatches;
                          const totalTrays = calc.traysNeeded + onHandTrays;
                          return (
                            <>
                              <div className="bg-muted/20 rounded-lg p-3 text-center">
                                <p className="text-3xl font-mono font-bold text-primary tabular-nums" data-testid="output-batches-needed">{fmtNum(calc.batchesNeeded, 2)}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">Batches still to mix</p>
                                {hasDoughOnHand && (
                                  <p className="text-xs text-muted-foreground/70 mt-0.5">{fmtNum(totalBatches, 2)} total − {fmtNum(onHandBatches, 2)} on hand</p>
                                )}
                              </div>
                              <div className="bg-muted/20 rounded-lg p-3 text-center">
                                <p className="text-3xl font-mono font-bold tabular-nums" data-testid="output-trays-needed">{fmtNum(calc.traysNeeded, 0)}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">Trays still needed</p>
                                {hasDoughOnHand && (
                                  <p className="text-xs text-muted-foreground/70 mt-0.5">{fmtNum(totalTrays, 0)} total − {fmtNum(onHandTrays, 0)} on hand</p>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      {v.targetDoughballWeight > 0 && (
                        <p className="text-xs text-muted-foreground mt-3">
                          Target ball weight:{" "}
                          <span data-testid="text-target-ball-weight" className="font-mono font-semibold text-foreground">
                            {v.targetDoughballWeight % 1 === 0
                              ? v.targetDoughballWeight.toString()
                              : v.targetDoughballWeight.toFixed(2)}{" "}oz
                          </span>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
                  </>
                )}
                </DoughRoleGate>
                {/* Supply progress steppers (moved from Current Progress) */}
                <div className="mb-4">
                  {(() => {
                    const s = autoTrackSuggestion;
                    const { trays: suggestedTrays, batches: suggestedBatches } =
                      suggestedDoughStaging(calc.traysNeeded, calc.batchesNeeded);
                    const timing = getAutoTrackTiming(
                      calc.ppm,
                      v.pizzasPerCase,
                      calc.perTray,
                      calc.perBatch,
                      {
                        spinSec: Math.max(0, Number(v.mixerLowSec) || 0) + Math.max(0, Number(v.mixerHighSec) || 0),
                        hopperSec: Math.max(0, Number(v.hopperSec) || 0),
                      },
                    );
                    const onManual = (values: Record<string, number>, baseline?: Record<string, number>) => {
                      const now = Date.now();
                      if (timing.trayMs > 0) {
                        doughAutoSuppressUntilRef.current = now + timing.trayMs;
                        pauseDoughTimers(timing.trayMs);
                      } else {
                        // No valid tray cadence means the dough hook cannot
                        // tick either, so clear any stale timed pause rather
                        // than inventing a fixed fallback interval.
                        doughAutoSuppressUntilRef.current = 0;
                        resumeDoughTimers();
                      }
                      markRunValuesUpdated(currentRunId, now);
                      queueManualCorrection(currentRunId, values, baseline);
                    };
                    // Stop auto-track TickBars once the press is done — no more
                    // batches are needed for this run at that point.
                    const suppressed = Date.now() < doughAutoSuppressUntilRef.current;
                    const trayAutoActive = autoTrackProgress && runStatus === "running" && !suppressed && !calc.pressDone;
                    const batchAutoActive = autoTrackProgress && runStatus === "running" && !suppressed && !calc.pressDone;
                    // ── Live countdowns to each auto counter's next tick ──
                    const nowMs = nowTime.getTime();
                    const secLeftOf = (dueMs: number, periodSec: number) =>
                      dueMs > 0 ? Math.min(periodSec, Math.max(0, (dueMs - nowMs) / 1000)) : periodSec;
                    const trayPeriodSec = timing.trayMs / 1000;
                    const trayProductionSec = timing.trayProductionMs / 1000;
                    const drainQuarterSec = timing.batchConsumptionMs / 1000;
                    const spinSec = timing.batchProductionMs / 1000;
                    return (
                      <>
                        <div className={doughSubTab !== "crusts" ? "grid grid-cols-2 gap-2" : ""}>
                          <div>
                            <StepperField
                              control={form.control}
                              name="traysOnLine"
                              label={trayAutoActive
                                ? (doughSubTab === "crusts" ? "Total Stacks Ready · Auto" : "Total Trays on Line · Auto")
                                : (doughSubTab === "crusts" ? "Total Stacks Ready" : "Total Trays on Line")}
                              suggestion={!trayAutoActive ? suggestedTrays : null}
                              disabled={!!doughLock}
                              onSuggest={() => { const baseline = { traysOnLine: Number(form.getValues("traysOnLine")) || 0, batchesReady: Number(form.getValues("batchesReady")) || 0 }; const next = suggestedTrays ?? v.traysOnLine; markRunValuesUpdated(currentRunId, Date.now()); form.setValue("traysOnLine", next, { shouldDirty: true }); onManual({ traysOnLine: next }, baseline); }}
                              onManualChange={(next, previous) => {
                                onManual({ traysOnLine: next }, { traysOnLine: previous, batchesReady: Number(v.batchesReady) || 0 });
                              }}
                            />
                            {doughSubTab !== "crusts" && (
                              <div className="mt-1.5 space-y-1" data-testid="tray-section-capacity-guide">
                                <p className="text-[10px] text-muted-foreground">
                                  Physical guide: {DOUGH_TRAY_SECTION_COUNT} sections × {DOUGH_TRAY_SECTION_CAPACITY} trays
                                  {" "}({DOUGH_TRAY_ADVISORY_TOTAL} total). This aggregate count is not capped.
                                </p>
                                {v.traysOnLine > DOUGH_TRAY_ADVISORY_TOTAL && (
                                  <p
                                    className="text-[11px] text-amber-400 font-semibold flex items-start gap-1"
                                    role="status"
                                    data-testid="tray-section-capacity-warning"
                                  >
                                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                                    Above the three-section guide — confirm tray placement; auto-track will keep the full count.
                                  </p>
                                )}
                              </div>
                            )}
                            {doughSubTab !== "crusts" && (trayAutoActive && trayPeriodSec > 0 ? (
                              <>
                                <TickBar
                                  label="Line eats 1 tray in"
                                  secLeft={secLeftOf(tickDueRefs.tray.current, trayPeriodSec)}
                                  periodSec={trayPeriodSec}
                                  color="text-orange-400"
                                />
                                {calc.traysNeeded > 0 && (
                                  <TickBar
                                    label="Press adds 1 tray in"
                                    secLeft={secLeftOf(tickDueRefs.trayProd.current, trayProductionSec)}
                                    periodSec={trayProductionSec}
                                    color="text-emerald-400"
                                  />
                                )}
                              </>
                            ) : (
                              <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                                <Pause className="w-2.5 h-2.5" /> Timers paused
                              </p>
                            ))}
                          </div>
                          {doughSubTab !== "crusts" && (
                            <div>
                              <StepperField
                                control={form.control}
                                name="batchesReady"
                                label={batchAutoActive ? "Batches of Dough Ready · Auto" : "Batches of Dough Ready"}
                                max={3}
                                suggestion={!batchAutoActive ? suggestedBatches : null}
                              onSuggest={() => { const baseline = { traysOnLine: Number(form.getValues("traysOnLine")) || 0, batchesReady: Number(form.getValues("batchesReady")) || 0 }; const next = suggestedBatches ?? v.batchesReady; markRunValuesUpdated(currentRunId, Date.now()); form.setValue("batchesReady", next, { shouldDirty: true }); onManual({ batchesReady: next }, baseline); }}
                              onManualChange={(next, previous) => {
                                onManual({ batchesReady: next }, { traysOnLine: Number(v.traysOnLine) || 0, batchesReady: previous });
                              }}
                              disabled={!!doughLock}
                              />
                              {v.batchesReady >= 3 && (
                                <p className="text-[11px] text-amber-400 font-semibold flex items-center gap-1 mt-1">
                                  <AlertTriangle className="w-3 h-3 shrink-0" /> Max 3 batches — avoid over-mixing
                                </p>
                              )}
                              {batchAutoActive && drainQuarterSec > 0 ? (
                                <>
                                  <TickBar
                                    label="Line uses ¼ batch in"
                                    secLeft={secLeftOf(tickDueRefs.batch.current, drainQuarterSec)}
                                    periodSec={drainQuarterSec}
                                    color="text-orange-400"
                                  />
                                  {calc.batchesNeeded > 0 && spinSec > 0 && (
                                    <TickBar
                                      label="Mixer finishes +1 in"
                                      secLeft={secLeftOf(tickDueRefs.batchProd.current, spinSec)}
                                      periodSec={spinSec}
                                      color="text-emerald-400"
                                    />
                                  )}
                                </>
                              ) : (
                                <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                                  <Pause className="w-2.5 h-2.5" /> Timers paused
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Packaging quick check — skids/cases pace without a tab
                            switch. Crust mode (and missing cases-per-skid) keeps
                            the plain steppers. */}
                        {doughSubTab !== "crusts" ? (() => {
                          const hasCps = v.casesPerSkid > 0;
                          const cps = hasCps ? v.casesPerSkid : 0;
                          const packedSkids = Number(v.skidsCompleted) || 0;
                          const packedCasesOnSkid = Number(v.casesOnCurrentSkid) || 0;
                          const packedTotal = packedSkids * cps + packedCasesOnSkid;
                          const skidsTotal = hasCps && v.casesNeeded > 0 ? Math.ceil(v.casesNeeded / cps) : null;
                          const casePeriodSec = calc.ppm > 0 && v.pizzasPerCase > 0 ? (v.pizzasPerCase / calc.ppm) * 60 : 0;
                          const caseAutoActive = autoTrackProgress && !!s && !suppressed &&
                            (runStatus === "running" || runStatus === "ended" || packagingDrainActive);
                          const expectedTotal = s ? s.expectedCases : null;
                          const packGapCases = expectedTotal !== null ? expectedTotal - packedTotal : 0;
                          const packOnPace = packGapCases <= 2;
                          const packBehindSec = packGapCases * casePeriodSec;
                          const packagingControls = createPackagingControlAdapter({
                            skidsCompleted: packedSkids,
                            casesOnCurrentSkid: packedCasesOnSkid,
                            casesPerSkid: cps,
                            applyProgress: (nextSkids, nextCases) => {
                              persistManualPackagingProgress(currentRunId, nextSkids, nextCases);
                              form.setValue("skidsCompleted", nextSkids, { shouldDirty: true });
                              form.setValue("casesOnCurrentSkid", nextCases, { shouldDirty: true });
                            },
                            reportCorrection: (deltaCases) => detectPackagingSpeedDrift(deltaCases),
                            isLocked: () => !!getManualSectionLock(currentRunId, "packaging")?.peer,
                          });
                          // No upper cap: manual counts can exceed the planned
                          // need (run may over-produce). Auto-track still stops
                          // at casesNeeded on its own.
                          const setPackedTotal = (total: number) => packagingControls.setTotal(total);
                          // Without a cases-per-skid setting the two counters
                          // can't be combined into one total — bump each field
                          // directly instead (same as the old plain steppers).
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
                            <div className={`mt-2 rounded-lg border px-4 py-3 ${packOnPace ? "border-border/50 bg-card/60" : "border-amber-600/30 bg-amber-950/10"}`}>
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
                              <div className="grid grid-cols-3 gap-2">
                                <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Skids done</p>
                                  <div className="flex items-center justify-center gap-1.5 mt-0.5">
                                    <button type="button" onClick={() => hasCps ? setPackedTotal(packedTotal - cps) : bumpSkids(-1)} disabled={!!packagingLock} className={miniBtn} data-testid="btn-dec-packSkids">−</button>
                                    <p className="text-xl font-mono font-bold text-foreground tabular-nums" data-testid="text-pack-skids">
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
                                    <p className="text-xl font-mono font-bold text-foreground tabular-nums" data-testid="text-pack-cases">
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
                                      That is {fmtMS(packBehindSec)} of production not boxed yet; dough keeps feeding the line either way.
                                    </>
                                  )}
                                </p>
                              )}
                            </div>
                          );
                        })() : (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <StepperField
                            control={form.control}
                            name="skidsCompleted"
                            label={autoTrackProgress && s && !suppressed ? "Total Skids Completed · Auto" : "Total Skids Completed"}
                            suggestion={!autoTrackProgress && s && s.skids !== v.skidsCompleted ? s.skids : null}
                            onSuggest={() => { persistManualPackagingProgress(currentRunId, s!.skids, s!.casesOnSkid); form.setValue("skidsCompleted", s!.skids, { shouldDirty: true }); form.setValue("casesOnCurrentSkid", s!.casesOnSkid, { shouldDirty: true }); }}
                            onManualChange={(nextSkids) => { persistManualPackagingProgress(currentRunId, nextSkids, Number(v.casesOnCurrentSkid) || 0); }}
                             disabled={!!packagingLock}
                          />
                          <StepperField
                            control={form.control}
                            name="casesOnCurrentSkid"
                            label={autoTrackProgress && s && !suppressed ? "Cases on Current Skid · Auto" : "Cases on Current Skid"}
                            max={v.casesPerSkid > 0 ? v.casesPerSkid : undefined}
                            suggestion={!autoTrackProgress && s && s.casesOnSkid !== v.casesOnCurrentSkid ? s.casesOnSkid : null}
                            onSuggest={() => { persistManualPackagingProgress(currentRunId, Number(v.skidsCompleted) || 0, s!.casesOnSkid); form.setValue("casesOnCurrentSkid", s!.casesOnSkid, { shouldDirty: true }); }}
                            onManualChange={(nextCases) => { persistManualPackagingProgress(currentRunId, Number(v.skidsCompleted) || 0, nextCases); }}
                             disabled={!!packagingLock}
                          />
                        </div>
                        )}
                      </>
                    );
                  })()}
                </div>


                {/* Next-run prep handoff card — visible once this run's press is done */}
                {doughSubTab === "dough" && nextRunPrepActive && (() => {
                  const nextRunMeta = dayState.runs[dayState.currentIndex + 1];
                  const nextRunName = nextRunMeta
                    ? [nextRunMeta.brand, nextRunMeta.flavor].filter(Boolean).join(" – ") || `Run ${dayState.currentIndex + 2}`
                    : "";
                  return (
                    <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ArrowRight className="w-5 h-5 shrink-0 text-emerald-400" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-emerald-400">Prepping for next run</p>
                            {nextRunName && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{nextRunName}</p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="px-4 pb-3 flex items-center justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                          <p className="text-xs text-muted-foreground">Dough batches ready for next run</p>
                          <p className="text-2xl font-mono font-black tabular-nums text-foreground">
                            {prep.prepBatchesDough}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={addPrepBatchDough} className="shrink-0 border-emerald-500/40 text-emerald-400 hover:bg-emerald-950/50">
                          +1 Batch
                        </Button>
                      </div>
                      <div className="border-t border-emerald-500/20 px-4 py-2">
                        <TickBar label="Next batch due" secLeft={doughSecLeft} periodSec={doughPrepBatchSec} color="text-emerald-400" />
                      </div>
                    </div>
                  );
                })()}

                {/* Manual-mode next-batch countdown and dismissible reminder. */}
                {doughSubTab === "dough" && runStatus === "running" && !calc.pressDone && !autoTrackProgress && (() => {
                  const spinSecCard = getAutoTrackTiming(
                    calc.ppm,
                    v.pizzasPerCase,
                    calc.perTray,
                    calc.perBatch,
                    {
                      spinSec: (Math.max(0, Number(v.mixerLowSec) || 0) + Math.max(0, Number(v.mixerHighSec) || 0)),
                      hopperSec: Math.max(0, Number(v.hopperSec) || 0),
                    },
                  ).batchProductionMs / 1000;
                  const dueMs = tickDueRefs.batchProd.current;
                  const secLeft = spinSecCard > 0 && dueMs > 0
                    ? Math.min(spinSecCard, Math.max(0, (dueMs - nowTime.getTime()) / 1000))
                    : null;
                  return (
                    <div className={`mb-4 rounded-xl border overflow-hidden ${showBatchDue ? "border-orange-500/50 bg-orange-950/40 animate-pulse" : "border-amber-500/30 bg-card/60"}`}>
                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Timer className={`w-5 h-5 shrink-0 ${showBatchDue ? "text-orange-400" : "text-amber-500"}`} />
                          <div className="min-w-0">
                            <p className={`text-sm font-bold ${showBatchDue ? "text-orange-400" : "text-foreground"}`}>
                              {showBatchDue ? "Dough station — batch reminder" : "Dough station — next batch due"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {showBatchDue ? `Time per batch: ${fmtTime(spinSecCard)}` : "Countdown to the next mixer batch at current pace"}
                            </p>
                          </div>
                        </div>
                        <span className={`text-xl font-black font-mono tabular-nums shrink-0 ${showBatchDue ? "text-orange-400" : "text-amber-500"}`} data-testid="text-next-batch-countdown">
                          {secLeft !== null ? fmtMS(secLeft) : "—:—"}
                        </span>
                      </div>
                      {showBatchDue && (
                        <button
                          type="button"
                          data-testid="button-dismiss-batch-reminder"
                          onClick={() => setShowBatchDue(false)}
                          className="w-full bg-amber-600 hover:bg-amber-500 text-black font-black text-sm py-3 flex items-center justify-center gap-2 transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Dismiss reminder
                        </button>
                      )}
                    </div>
                  );
                })()}
                {/* Run to Time card — available to all roles */}
                {doughSubTab === "dough" && (() => {
                  const target = new Date(nowTime);
                  const [hrs, mins] = runToTime.split(":").map(Number);
                  target.setHours(hrs, mins, 0, 0);
                  if (target <= nowTime) target.setDate(target.getDate() + 1);
                  const minutesAvailable = Math.max(0, (target.getTime() - nowTime.getTime()) / 60000);
                  // Measured mixer time (low + high) beats the line-speed guess
                  // for min/batch when the operator has timed the machines.
                  const measuredSpinSec = Math.max(0, Number(v.mixerLowSec) || 0) + Math.max(0, Number(v.mixerHighSec) || 0);
                  const timePerBatchMin = measuredSpinSec > 0 ? measuredSpinSec / 60 : calc.timePerBatchSec / 60;
                  const onHandBatches = v.batchesReady ?? 0;
                  const onHandTrays = v.traysOnLine ?? 0;
                  const hasOnHand = onHandBatches > 0 || onHandTrays > 0;
                  // Total doughballs the line will consume in the available window
                  const totalDoughballsNeeded = calc.ppm > 0 ? calc.ppm * minutesAvailable : 0;
                  // Combine ALL on-hand dough into a single doughball count
                  const doughOnHand = onHandBatches * calc.perBatch + onHandTrays * calc.perTray;
                  // Net doughballs still needed after deducting everything on hand
                  const doughStillNeeded = Math.max(0, totalDoughballsNeeded - doughOnHand);
                  // Batches to mix — allow partial so the decimal shows a partial batch
                  const batchesStillToMix = calc.perBatch > 0 ? doughStillNeeded / calc.perBatch : 0;
                  // Trays those remaining batches will produce
                  const traysFromBatches = calc.perTray > 0 ? (batchesStillToMix * calc.perBatch) / calc.perTray : 0;
                  // Total cases the line will run in this window
                  const casesInWindow = v.pizzasPerCase > 0 ? Math.floor(totalDoughballsNeeded / v.pizzasPerCase) : 0;
                  const to12hr = (hhmm: string) => {
                    const [h, m] = hhmm.split(":").map(Number);
                    const ampm = h >= 12 ? "PM" : "AM";
                    const h12 = h % 12 || 12;
                    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                  };
                  const nowLabel = to12hr(
                    `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`
                  );
                  return (
                    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mt-0">
                      <div className="h-1 bg-amber-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" />
                          Run to Time
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs text-muted-foreground shrink-0">{nowLabel}</span>
                          <span className="text-xs text-muted-foreground shrink-0">→ run until</span>
                          <input
                            type="time"
                            value={runToTime}
                            onChange={(e: any) => {
                              const t = e.target.value;
                              setRunToTime(t);
                              const newDs = { ...dayStateRef.current, runToTime: t };
                              setDayState(newDs);
                              saveDayState(newDs);
                              schedulePush(newDs, 0);
                            }}
                            className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                          <span className="text-xs text-muted-foreground shrink-0 font-mono">{fmtNum(timePerBatchMin, 1)} min/batch</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-amber-400">
                              {Math.floor(minutesAvailable / 60) > 0 && `${Math.floor(minutesAvailable / 60)}h `}{Math.round(minutesAvailable % 60)}m
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Time available</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-primary">{fmtNum(batchesStillToMix, 2)}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Batches to mix</p>
                          </div>
                          {calc.perBatch > 0 && calc.perTray > 0 && (
                            <div className="bg-muted/30 rounded-lg p-2 text-center">
                              <p className="text-xl font-mono font-bold text-emerald-400">{Math.ceil(traysFromBatches)}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Trays to make</p>
                            </div>
                          )}
                          {v.pizzasPerCase > 0 && (
                            <div className="bg-muted/30 rounded-lg p-2 text-center">
                              <p className="text-xl font-mono font-bold text-sky-400">{casesInWindow}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Cases in window</p>
                            </div>
                          )}
                        </div>
                        {hasOnHand && (
                          <p className="text-[10px] text-muted-foreground mt-2">
                            {[
                              onHandBatches > 0 && `${onHandBatches} batch${onHandBatches !== 1 ? "es" : ""} ready`,
                              onHandTrays > 0 && `${onHandTrays} tray${onHandTrays !== 1 ? "s" : ""} on line`,
                            ].filter(Boolean).join(" · ")} already on hand — subtracted from totals
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Run to Time card — crust mode */}
                {doughSubTab === "crusts" && (() => {
                  const target = new Date(nowTime);
                  const [hrs, mins] = runToTime.split(":").map(Number);
                  target.setHours(hrs, mins, 0, 0);
                  if (target <= nowTime) target.setDate(target.getDate() + 1);
                  const minutesAvailable = Math.max(0, (target.getTime() - nowTime.getTime()) / 60000);
                  const pizzasByTime = calc.ppm * minutesAvailable;
                  const casesToOpenByTime = v.crustsPerCase > 0 ? Math.ceil(pizzasByTime / v.crustsPerCase) : 0;
                  const stacksByTime = calc.perTray > 0 ? Math.ceil(pizzasByTime / calc.perTray) : 0;
                  const stacksAlreadyOpen = v.traysOnLine ?? 0;
                  const moreStacksNeeded = Math.max(0, stacksByTime - stacksAlreadyOpen);
                  const moreCasesNeeded = v.crustsPerCase > 0 && v.crustsPerStack > 0
                    ? Math.max(0, casesToOpenByTime - Math.floor(stacksAlreadyOpen * v.crustsPerStack / v.crustsPerCase))
                    : casesToOpenByTime;
                  const hasAlreadyOpen = stacksAlreadyOpen > 0;
                  const to12hr = (hhmm: string) => {
                    const [h, m] = hhmm.split(":").map(Number);
                    const ampm = h >= 12 ? "PM" : "AM";
                    const h12 = h % 12 || 12;
                    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                  };
                  const nowLabel = to12hr(
                    `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`
                  );
                  return (
                    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mt-0">
                      <div className="h-1 bg-sky-500 w-full" />
                      <CardHeader className="pb-2 pt-4 px-5">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" />
                          Run to Time
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs text-muted-foreground shrink-0">{nowLabel}</span>
                          <span className="text-xs text-muted-foreground shrink-0">→ run until</span>
                          <input
                            type="time"
                            value={runToTime}
                            onChange={(e: any) => {
                              const t = e.target.value;
                              setRunToTime(t);
                              const newDs = { ...dayStateRef.current, runToTime: t };
                              setDayState(newDs);
                              saveDayState(newDs);
                              schedulePush(newDs, 0);
                            }}
                            className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-amber-400">
                              {Math.floor(minutesAvailable / 60) > 0 && `${Math.floor(minutesAvailable / 60)}h `}{Math.round(minutesAvailable % 60)}m
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Time available</p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-sky-400">{casesToOpenByTime}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {hasAlreadyOpen ? "Cases total" : "Cases to open"}
                            </p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-primary">{stacksByTime}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {hasAlreadyOpen ? "Stacks total" : "Stacks to stage"}
                            </p>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <p className="text-xl font-mono font-bold text-emerald-400">{moreStacksNeeded}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">More stacks needed</p>
                          </div>
                        </div>
                        {hasAlreadyOpen && (
                          <p className="text-[10px] text-muted-foreground mt-2">
                            {stacksAlreadyOpen} stack{stacksAlreadyOpen !== 1 ? "s" : ""} already open — subtracted from totals
                            {moreCasesNeeded > 0 && ` · open ${moreCasesNeeded} more case${moreCasesNeeded !== 1 ? "s" : ""}`}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Extra Info — trays/skid, trays/batch, batches/skid (graduated mockup) */}
                {doughSubTab === "dough" && (
                  <div className="mt-4 rounded-xl border border-border/50 bg-card/60 shadow-md overflow-hidden">
                    <div className="bg-muted/30 px-4 py-2.5 border-b border-border/40">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Extra Info</p>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-border/40">
                      <div className="p-3 text-center">
                        <p className="text-lg font-mono font-bold text-foreground tabular-nums" data-testid="output-trays-per-skid">{fmtNum(calc.traysPerSkid, 2)}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Trays / Skid</p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-lg font-mono font-bold text-foreground tabular-nums" data-testid="output-trays-per-batch">{fmtNum(calc.traysPerBatch, 2)}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Trays / Batch</p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-lg font-mono font-bold text-foreground tabular-nums" data-testid="output-batches-per-skid">{fmtNum(calc.batchesPerSkid, 2)}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Batches / Skid</p>
                      </div>
                    </div>
                  </div>
                )}

                <RecipeSubstitutionBadge
                  substitutions={dayState.substitutions ?? []}
                  recipes={[v.doughRecipe, v.frontlineRecipe, v.app1CheeseRecipe, v.app2CheeseRecipe, v.app3CheeseRecipe, v.app4CheeseRecipe]}
                  typeValues={[v.app1Type, v.app2Type, v.app3Type, v.app4Type, v.pep1Type, v.pep2Type]}
                />
                {doughSubTab === "dough" && (
                <ReadOnlyRecipeCard
                  title="Dough Recipe"
                  subtitle={v.doughRecipeName?.trim() || undefined}
                  recipe={v.doughRecipe ?? []}
                  substitutions={dayState.substitutions ?? []}
                  accent="bg-orange-500/70"
                  scalable
                />
                )}
    </>
  );
});
