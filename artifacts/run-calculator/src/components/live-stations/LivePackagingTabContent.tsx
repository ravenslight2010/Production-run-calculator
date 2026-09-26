import { memo, useEffect, useRef } from "react";
import { AlertTriangle, Boxes, CheckCircle2, ChevronDown, MoveDown, Package, Snowflake, Sparkles, Zap } from "lucide-react";
import type { RunMeta } from "../../types";
import { PACKAGING_FIELDS, isCartonedValue, labelPositionLabel, withTempOverrides } from "../../types";
import { useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { useLiveRun } from "../../contexts/LiveRunContext";
import { useManualControlLock, getManualSectionLock } from "../../manualSectionLocks";
import { FreezerSurplusPanel } from "../FreezerSurplusPanel";
import { ManualOverrideBanner, manualOverrideBannerShow } from "../ManualOverrideBanner";
import { createPackagingControlAdapter } from "../../packagingManager";
import { loadRunValues, markRunValuesUpdated } from "../../storage";
import { fmtCountdownParts, fmtNum } from "../../utils";
import { AUTO_SUPPRESS_MS, TimelineNode, PkgMiniStepper, fmtMS } from "./stationShared";
import { PackagingSpeedNudgeFeedback } from "../PackagingSpeedNudgeFeedback";
import { runUnlockedManualSectionAction } from "../../packagingManager";
import { isPackagingDrainComplete } from "../../linePhases";

export const LivePackagingTabContent = memo(function LivePackagingTabContent() {
  const hx = useHomeTabCtx();
  const packagingLock = useManualControlLock(hx.currentRun?.id, "packaging-skids");
  const packagingCasesLock = useManualControlLock(hx.currentRun?.id, "packaging-cases");
  const {
    autoSuppressUntilRef, currentRun, currentRunId, dayState, doughSubTab, form,
    lastEndedRun, packagingManager, persistManualPackagingProgress, runStatus, updateDrainingRunValues, v,
    ve, freezerSurplus, freezerSurplusLoaded, freezerSurplusBusy, freezerSurplusError,
    confirmRunSurplus, refreshFreezerSurplus,
  } = hx;

  const {
    calc, nowTime, liveFreezerMin, elapsedBatchSec, linePhases,
    autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion,
    fireAutoTrackNow, tickDueRefs, packagingDrainActive, coordinationStatus,
    speedNudge, speedNudgeStatus, detectPackagingSpeedDrift,
    acceptPackagingSpeedNudge, dismissPackagingSpeedNudge,
  } = useLiveRun();

  const autoAdvancedRunRef = useRef<string | null>(null);
  useEffect(() => {
    const nextIndex = dayState.currentIndex + 1;
    const nextRun = dayState.runs[nextIndex];
    if (
      !currentRun ||
      currentRun.id !== currentRunId ||
      !nextRun ||
      nextRun.startedAt ||
      nextRun.endedAt ||
      autoAdvancedRunRef.current === currentRunId ||
      !isPackagingDrainComplete({
        runStatus,
        endedAt: currentRun.endedAt,
        elapsedBatchSec,
        phases: linePhases,
      })
    ) return;

    if (hx.switchToRun(nextIndex, currentRunId)) {
      autoAdvancedRunRef.current = currentRunId;
    }
  }, [
    currentRun,
    currentRunId,
    dayState.currentIndex,
    dayState.runs,
    elapsedBatchSec,
    hx.switchToRun,
    linePhases,
    runStatus,
  ]);

  // ── Auto-tick skid/case counter for the prior run draining through the
  // Freeze tunnel while the NEXT run is already active on the form.
  // useAutoTrack only drives the CURRENT form run; once endRun() advances
  // currentIndex the ended run's counter stops. This effect replays the same
  // drain-delta logic for the "Freeze Tunnel Draining · Prior Run" panel so cases keep
  // flowing from "in Freeze tunnel" to "cased" automatically. ───────────────
  const priorDrainFreezerRef = useRef<{ id: string; cases: number }>({ id: "", cases: -1 });
  useEffect(() => {
    if (!autoTrackProgress) return;
    const nowMs = nowTime.getTime();

    const draining = packagingManager.selectDrainingRun(dayState.runs, currentRunId, nowMs);
    if (!draining) {
      priorDrainFreezerRef.current = { id: "", cases: -1 };
      return;
    }
    const curFreezer = packagingManager.casesInDrainingFreezer(draining, nowMs);

    const prev = priorDrainFreezerRef.current;
    // First tick for this run — just baseline, don't back-fill a catch-up jump.
    if (prev.id !== draining.run.id) {
      priorDrainFreezerRef.current = { id: draining.run.id, cases: curFreezer };
      return;
    }
    priorDrainFreezerRef.current = { id: draining.run.id, cases: curFreezer };

    const exited = Math.max(0, prev.cases - curFreezer);
    packagingManager.advanceDrainingRun(draining, exited);
  }, [nowTime, autoTrackProgress, currentRunId, dayState.runs, packagingManager]);

  return (
    <>
                <FreezerSurplusPanel
                  mode="packaging"
                  ledger={freezerSurplus}
                  loaded={freezerSurplusLoaded}
                  busy={freezerSurplusBusy}
                  error={freezerSurplusError}
                  completedRun={lastEndedRun}
                  freezerTimeMin={lastEndedRun
                    ? Number(withTempOverrides(loadRunValues(lastEndedRun.id)).freezerTime) || 0
                    : 0}
                  nowMs={nowTime.getTime()}
                  getOriginalTarget={(run) => run.id === currentRunId ? Number(v.casesNeeded) || 0 : Number(loadRunValues(run.id).casesNeeded) || 0}
                  onConfirm={async (run, count, date) => {
                    await confirmRunSurplus(run, count, date);
                    await refreshFreezerSurplus();
                  }}
                  onAllocate={async () => {}}
                />
                <div className="flex flex-col">
                {/* ─── Finishing — Freeze Tunnel Draining (just-ended run still exiting tunnel) ─── */}
                {(() => {
                  // Pick the most-recently-ended run (other than the active one)
                  // whose Freeze tunnel is STILL draining AND that still has unpackaged
                  // cases. Filter for eligibility FIRST, then take the latest, so a
                  // newer ended-but-finished run can't hide an older still-draining one.
                  // (The active run shows its own emptying bar elsewhere.)
                  const nowMsT = nowTime.getTime();
                  const draining = packagingManager.selectDrainingRun(dayState.runs, currentRunId, nowMsT);
                  if (!draining?.run.endedAt) return null;
                  const { run: drainingRun, values: dv } = draining;
                  const fT = Number(dv.freezerTime) || 0;
                  const freezerMs = fT * 60000;
                  const remainMs = Math.max(0, drainingRun.endedAt + freezerMs - nowTime.getTime());
                  const casesPerSkid = Number(dv.casesPerSkid) || 0;
                  const casesNeeded = Number(dv.casesNeeded) || 0;
                  const skids = Number(dv.skidsCompleted) || 0;
                  const casesOnSkid = Number(dv.casesOnCurrentSkid) || 0;
                  const casesDone = skids * casesPerSkid + casesOnSkid;
                  const id = drainingRun.id;
                  const name =
                    `${drainingRun.brand ?? ""}${drainingRun.flavor ? ` – ${drainingRun.flavor}` : ""}`.trim() ||
                    "Finished run";
                  const maxSkids = casesPerSkid > 0 ? Math.floor(casesNeeded / casesPerSkid) : undefined;
                  const maxCasesOnSkid = casesPerSkid > 0 ? casesPerSkid : undefined;
                  const pct = Math.min(1 - remainMs / freezerMs, 1);
                  const mm = Math.floor(remainMs / 60000);
                  const ss = Math.floor((remainMs % 60000) / 1000);
                  const skidNearlyFull =
                    casesPerSkid > 0 && casesOnSkid > 0 &&
                    casesOnSkid >= casesPerSkid - 3 && casesOnSkid < casesPerSkid;
                  return (
                    <div className="flex mb-4">
                      <TimelineNode icon={Zap} active />
                      <div className="flex-1 mt-2">
                        <div className="bg-amber-950/30 border border-amber-600/30 rounded-xl p-3 relative overflow-hidden flex flex-col gap-3">
                          <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-950">
                            <div className="h-full bg-amber-500 transition-all duration-1000" style={{ width: `${pct * 100}%` }} />
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-0.5">Freeze Tunnel Draining · Prior Run</p>
                              <p className="text-sm font-semibold text-amber-100 truncate">{name}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] font-mono font-bold text-amber-500 mb-0.5">
                                {fmtCountdownParts(mm, ss)} left
                              </p>
                              <p className="text-[10px] font-bold uppercase text-amber-200">{fmtNum(casesDone, 0)} / {fmtNum(casesNeeded, 0)} cases</p>
                            </div>
                          </div>
                          <div className="flex gap-2 items-end">
                            <PkgMiniStepper
                              label="Skids"
                              value={skids}
                              max={maxSkids}
                              onDec={() => updateDrainingRunValues(id, { skidsCompleted: Math.max(0, skids - 1) })}
                              onInc={() => updateDrainingRunValues(id, { skidsCompleted: skids + 1 })}
                            />
                            <PkgMiniStepper
                              label="Cases on skid"
                              value={casesOnSkid}
                              max={maxCasesOnSkid}
                              onDec={() => updateDrainingRunValues(id, { casesOnCurrentSkid: Math.max(0, casesOnSkid - 1) })}
                              onInc={() => updateDrainingRunValues(id, { casesOnCurrentSkid: casesOnSkid + 1 })}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                navigator.vibrate?.(15);
                                // A prior-run drain can already have moved cases
                                // onto the next skid. Completing the skid adds
                                // one full skid to the total; it must not erase
                                // those newly arrived cases by resetting the
                                // next skid's counter.
                                updateDrainingRunValues(id, {
                                  skidsCompleted: skids + 1,
                                  casesOnCurrentSkid: casesOnSkid,
                                });
                              }}
                              className="w-12 h-10 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 rounded-lg flex items-center justify-center active:scale-95 transition-all shrink-0"
                              title="Skid done — log & reset"
                              data-testid="btn-draining-skid-done"
                            >
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
                          </div>
                          {skidNearlyFull && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-600/30 text-amber-400 text-xs font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Skid nearly full — {casesPerSkid - casesOnSkid} case{casesPerSkid - casesOnSkid !== 1 ? "s" : ""} to go
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* ─── Line stage (3-phase: filling while running, draining after pause/stop) ─── */}
                {(() => {
                  const freezerMin = Number(ve.freezerTime) || 0;
                  const showFilling = (runStatus === "running" || runStatus === "paused") && freezerMin > 0;
                  const showEmptying =
                    freezerMin > 0 && !!lastEndedRun?.endedAt && lastEndedRun.id === currentRunId;
                  if (!showFilling && !showEmptying) return null;
                  const nowMs = nowTime.getTime();
                  // Thin display of the server-adopted context model: it covers the
                  // current run in every lifecycle state (running / paused / ended),
                  // falling back locally inside LiveRunContext when offline/lagging.
                  const phases = linePhases;
                  const rows = [phases.stage1, phases.stage2, phases.stage3];
                  const anyVisible = rows.some(r => r.state !== "active" && r.state !== "empty");
                  if (!anyVisible && !showEmptying) return null;
                  // A phase can drain only from its persisted pause / end record.
                  // Completion math remains independent so dough and case tracking
                  // can finish while the still-running line stays visually stable.
                  const lifecycleDrainStartedAt = showEmptying
                    ? lastEndedRun?.endedAt
                    : runStatus === "paused"
                    ? currentRun?.pausedAt
                    : undefined;
                  const lifecycleDraining = lifecycleDrainStartedAt != null;
                  // Overall progress: use liveFreezerMin while loading, then the
                  // persisted lifecycle timestamp while draining.
                  const totalSecs = freezerMin * 60;
                  const elapsedSecs = lifecycleDraining
                    ? Math.min(totalSecs, Math.max(0, (nowMs - lifecycleDrainStartedAt) / 1000))
                    : liveFreezerMin * 60;
                  const pct = totalSecs > 0 ? Math.min(elapsedSecs / totalSecs, 1) : 0;
                  const drainDone = lifecycleDraining && rows.every(r => r.state === "empty");
                  return (
                    <div className="flex mb-4">
                      <TimelineNode icon={Snowflake} active />
                      <div className="flex-1 mt-2 space-y-2">
                        <div className={`border rounded-lg p-3 ${drainDone ? "bg-emerald-950/20 border-emerald-700/30" : lifecycleDraining ? "bg-amber-950/20 border-amber-600/30" : "bg-primary/5 border-primary/20"}`}>
                          <div className="flex justify-between items-end mb-2">
                            <span className={`text-sm font-semibold uppercase tracking-wider ${drainDone ? "text-emerald-400" : lifecycleDraining ? "text-amber-400" : "text-primary"}`}>
                              {drainDone ? "Freeze Tunnel Clear" : lifecycleDraining ? "Freeze Tunnel Draining" : "Freeze Tunnel Loading"}
                            </span>
                            <span className={`text-xs font-mono font-bold ${drainDone ? "text-emerald-400" : lifecycleDraining ? "text-amber-400" : "text-primary/80"}`}>
                              {drainDone ? "✓ Freeze tunnel clear" : `${fmtNum(pct * 100, 0)}%`}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-background border border-primary/10 overflow-hidden mb-2">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ${drainDone ? "bg-emerald-500" : lifecycleDraining ? "bg-amber-500" : "bg-primary shadow-[0_0_10px_rgba(255,149,0,0.5)]"}`}
                              style={{ width: `${pct * 100}%` }}
                            />
                          </div>
                          <div className="space-y-1">
                            {rows.filter(r => r.state !== "empty").map((phase, i) => {
                              const mm = Math.floor(phase.remainMs / 60000);
                              const ss = Math.floor((phase.remainMs % 60000) / 1000);
                              const dotCls = phase.state === "paused" ? "bg-muted-foreground" : phase.state === "active" ? "bg-emerald-500" : phase.state === "draining" ? "bg-amber-400 animate-pulse" : "bg-sky-400 animate-pulse";
                              const textCls = phase.state === "paused" ? "text-muted-foreground" : phase.state === "active" ? "text-emerald-400" : phase.state === "draining" ? "text-amber-300" : "text-sky-300";
                              const stateText = phase.state === "filling" ? `filling → ${fmtCountdownParts(mm, ss)}`
                                : phase.state === "draining" ? (phase.remainMs > 0 ? `draining → ${fmtCountdownParts(mm, ss)}` : "draining")
                                : phase.state === "resuming" ? `product arriving in ${fmtCountdownParts(mm, ss)}`
                                : phase.state === "paused" ? "stopped"
                                : phase.state === "active" ? "flowing" : "";
                              return (
                                <div key={i} className="flex items-center gap-2 text-[11px]">
                                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`} />
                                  <span className="text-muted-foreground font-medium">{phase.label}</span>
                                  <span className={`font-semibold ${textCls}`}>— {stateText}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ─── Line assembly stage ─── */}
                <div className="flex mb-4">
                  <TimelineNode icon={MoveDown} done />
                  <div className="flex-1 mt-2">
                    <div className="flex items-center justify-between bg-muted/10 border border-border/40 rounded-lg p-3">
                      <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Line Assembly</span>
                      <span className="text-lg font-mono font-bold tabular-nums text-foreground">
                        {fmtNum(calc.casesOnLine, 0)}{" "}
                        <span className="text-xs text-muted-foreground font-sans font-normal uppercase tracking-widest">on line</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* ─── Active Skid Building (hero) ─── */}
                <div className="flex">
                  <TimelineNode icon={Boxes} last active />
                  <div className="flex-1 mt-2">
                    <div className="bg-card/60 border border-primary/30 rounded-2xl overflow-hidden shadow-[0_8px_30px_rgba(255,149,0,0.08)] flex flex-col">
                      <div className="px-4 py-3 flex items-center justify-between bg-primary/5 border-b border-primary/20">
                        <h3 className="text-sm font-bold text-primary uppercase tracking-wider">Active Skid Building</h3>
                        {(runStatus === "running" || runStatus === "paused") && autoTrackSuggestion && (
                          <div className="flex items-center gap-2">
                            {coordinationStatus !== "ready" && (
                              <span
                                role="status"
                                aria-live="polite"
                                className="text-[9px] font-semibold text-muted-foreground"
                              >
                                {coordinationStatus === "waiting" ? "Syncing automatic count…" : "Automatic count paused — waiting for sync"}
                              </span>
                            )}
                            <div className={`w-2 h-2 rounded-full ${autoTrackProgress ? "bg-primary animate-pulse shadow-[0_0_8px_rgba(255,149,0,0.8)]" : "bg-muted-foreground"}`} />
                            <button
                              type="button"
                              onClick={() => {
                                const next = !autoTrackProgress;
                                setAutoTrackProgress(next);
                                if (next) {
                                  autoSuppressUntilRef.current = 0;
                                  fireAutoTrackNow("all");
                                }
                              }}
                              className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            >
                              <Sparkles className="w-3 h-3" /> {autoTrackProgress ? "Auto" : "Manual"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="p-5 text-center space-y-5">
                        {(() => {
                          const casesPerSkid = Number(v.casesPerSkid) || 0;
                          const casesOnSkid = Number(v.casesOnCurrentSkid) || 0;
                          const skids = Number(v.skidsCompleted) || 0;
                          const maxSkids = casesPerSkid > 0 ? Math.floor(v.casesNeeded / casesPerSkid) : undefined;
                          const totalSkids =
                            casesPerSkid > 0 && Number(v.casesNeeded) > 0 ? Math.ceil(Number(v.casesNeeded) / casesPerSkid) : 0;
                          const s = autoTrackSuggestion;
                          const suppressed = Date.now() < autoSuppressUntilRef.current;
                          const suppressedMinsLeft = suppressed ? Math.ceil((autoSuppressUntilRef.current - Date.now()) / 60000) : 0;
                          const onManual = (
                            nextSkids: number,
                            nextCases: number,
                            manualOverrideUntil = Date.now() + AUTO_SUPPRESS_MS,
                          ) => {
                            persistManualPackagingProgress(
                              currentRunId,
                              nextSkids,
                              nextCases,
                              manualOverrideUntil,
                            );
                          };
                          const packagingControls = createPackagingControlAdapter({
                            skidsCompleted: skids,
                            casesOnCurrentSkid: casesOnSkid,
                            casesPerSkid,
                            applyProgress: (nextSkids, nextCases) => {
                              onManual(nextSkids, nextCases);
                              form.setValue("skidsCompleted", nextSkids, { shouldDirty: true });
                              form.setValue("casesOnCurrentSkid", nextCases, { shouldDirty: true });
                            },
                            reportCorrection: (deltaCases) => detectPackagingSpeedDrift(deltaCases),
                             vibrate: (durationMs) => navigator.vibrate?.(durationMs),
                             isLocked: () => !!getManualSectionLock(currentRunId, "packaging")?.peer,
                          });
                          const skidNearlyFull =
                            casesPerSkid > 0 && casesOnSkid > 0 &&
                            casesOnSkid >= casesPerSkid - 3 && casesOnSkid < casesPerSkid;
                          const skidPct = casesPerSkid > 0 ? Math.min(casesOnSkid / casesPerSkid, 1) : 0;
                          return (
                            <>
                              <ManualOverrideBanner
                                show={manualOverrideBannerShow(autoTrackProgress, s, autoSuppressUntilRef.current)}
                                station="Packaging"
                                minsLeft={suppressedMinsLeft}
                                onResume={() => {
                                  const now = Date.now();
                                  onManual(skids, casesOnSkid, now);
                                  autoSuppressUntilRef.current = 0;
                                  fireAutoTrackNow("case");
                                }}
                              />

                              {(() => {
                                const casePeriodSec = calc.ppm > 0 && v.pizzasPerCase > 0 ? (v.pizzasPerCase / calc.ppm) * 60 : 0;
                                 const caseAutoActive = autoTrackProgress && !!s && !suppressed &&
                                   (runStatus === "running" || packagingDrainActive);
                                if (!caseAutoActive || casePeriodSec <= 0) return null;
                                const nowMs = nowTime.getTime();
                                const secLeft = tickDueRefs.case.current > 0
                                  ? Math.min(casePeriodSec, Math.max(0, (tickDueRefs.case.current - nowMs) / 1000))
                                  : casePeriodSec;
                                return (
                                  <div className="flex items-center justify-center">
                                    <div className="bg-card px-3 py-1.5 rounded-full border border-orange-500/30 text-xs text-muted-foreground font-medium">
                                      Next case in{" "}
                                      <span className="text-orange-400 font-bold tabular-nums">{fmtMS(secLeft)}</span>
                                    </div>
                                  </div>
                                );
                              })()}

                              <div>
                                <div className="flex justify-center items-end gap-3 font-mono">
                                  <button
                                    type="button"
                                    onClick={packagingControls.decrementSkids}
                                     disabled={!!packagingLock}
                                    className="w-12 h-16 rounded-xl bg-muted/40 text-2xl font-bold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all mb-1 select-none flex items-center justify-center"
                                    data-testid="btn-dec-skidsCompleted"
                                  >
                                    −
                                  </button>
                                  <div className="text-[5rem] leading-[1] font-black tabular-nums tracking-tighter text-foreground drop-shadow-md" data-testid="text-skidsCompleted">
                                    {skids}
                                    {totalSkids > 0 && (
                                      <span className="text-[2.5rem] text-muted-foreground font-bold">/{totalSkids}</span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => packagingControls.incrementSkids(maxSkids)}
                                     disabled={!!packagingLock}
                                    className="w-12 h-16 rounded-xl bg-muted/40 text-2xl font-bold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all mb-1 select-none flex items-center justify-center"
                                    data-testid="btn-inc-skidsCompleted"
                                  >
                                    +
                                  </button>
                                </div>
                                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mt-2">Skids Completed</p>
                              </div>

                              <div className="bg-background/50 rounded-xl p-4 border border-border/50 shadow-inner">
                                <div className="flex justify-between items-center mb-3">
                                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cases on Skid</span>
                                  <div className="font-mono text-xl font-bold tabular-nums">
                                    <span className="text-foreground" data-testid="text-casesOnCurrentSkid">{casesOnSkid}</span>
                                    <span className="text-muted-foreground">/{casesPerSkid > 0 ? casesPerSkid : "—"}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={packagingControls.decrementCases}
                                     disabled={!!packagingCasesLock}
                                    className="w-14 h-12 rounded-lg bg-muted/40 border border-border/50 text-2xl font-bold text-foreground hover:bg-muted active:scale-95 transition-all shrink-0 select-none flex items-center justify-center"
                                    data-testid="btn-dec-casesOnCurrentSkid"
                                  >
                                    −
                                  </button>
                                  <div className="flex-1 relative h-8 bg-muted/30 rounded-md overflow-hidden border border-border/40">
                                    <div
                                      className="absolute inset-y-0 left-0 bg-primary transition-all duration-300 ease-out shadow-[0_0_15px_rgba(255,149,0,0.6)]"
                                      style={{ width: `${skidPct * 100}%` }}
                                    />
                                    {skidNearlyFull && (
                                      <div className="absolute inset-0 flex items-center justify-center text-primary-foreground font-bold text-[10px] uppercase tracking-widest animate-pulse">
                                        Nearly Full
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={packagingControls.incrementCases}
                                     disabled={!!packagingCasesLock}
                                    className="w-14 h-12 rounded-lg bg-muted/40 border border-border/50 text-2xl font-bold text-foreground hover:bg-muted active:scale-95 transition-all shrink-0 select-none flex items-center justify-center"
                                    data-testid="btn-inc-casesOnCurrentSkid"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Kept with the manual case/skid controls so phone-sized
                                  screens explain the next speed-suggestion requirement
                                  without making staff scroll past the Packaging card. */}
                              <PackagingSpeedNudgeFeedback
                                nudge={speedNudge}
                                status={speedNudgeStatus}
                                onAccept={() => {
                                  if (!speedNudge) return;
                                  const now = Date.now();
                                  const field = speedNudge.isCrust ? "approxLineSpeed" : "speedAdjustment";
                                  form.setValue(field, speedNudge.value, { shouldDirty: true });
                                  markRunValuesUpdated(currentRunId, now);
                                  hx.lastLocalEditRef.current = now;
                                  hx.schedulePush(hx.dayStateRef.current, 0);
                                  acceptPackagingSpeedNudge(now);
                                }}
                                onDismiss={() => {
                                  dismissPackagingSpeedNudge();
                                }}
                              />

                              {!autoTrackProgress && s && (s.skids !== v.skidsCompleted || s.casesOnSkid !== v.casesOnCurrentSkid) && (
                                <button
                                  type="button"
                                  disabled={!!packagingLock}
                                  title={packagingLock?.peer ? "Packaging is being updated on another device" : undefined}
                                  onClick={() => {
                                     runUnlockedManualSectionAction(() => !!getManualSectionLock(currentRunId, "packaging")?.peer, () => {
                                       navigator.vibrate?.(10);
                                       onManual(s.skids, s.casesOnSkid);
                                       form.setValue("skidsCompleted", s.skids, { shouldDirty: true });
                                       form.setValue("casesOnCurrentSkid", s.casesOnSkid, { shouldDirty: true });
                                     });
                                  }}
                                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-xs font-semibold transition-colors"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                  Apply expected — {s.skids} skids · {s.casesOnSkid} cases
                                </button>
                              )}

                              {(runStatus === "running" || runStatus === "paused") && (
                                <button
                                  type="button"
                                  onClick={packagingControls.completeSkid}
                                   disabled={!!packagingLock}
                                   title={packagingLock?.peer ? "Packaging is being updated on another device" : undefined}
                                  className="w-full h-16 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 text-xl font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-[0_0_20px_rgba(16,185,129,0.15)]"
                                  data-testid="btn-skid-done"
                                >
                                  <CheckCircle2 className="w-7 h-7" />
                                  Skid Done
                                </button>
                              )}

                              <div className="space-y-2">
                                <div className="bg-muted/20 border border-border/30 rounded-xl p-3 flex items-center justify-between">
                                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Skids / Cases Left</span>
                                  {/* Total cases still to PUT ON SKIDS = casesNeeded − casesCompleted.
                                      Previously used casesLeftToRun which subtracts the ~50 cases already
                                      in the Freeze tunnel, understating what packaging still has to do. */}
                                  {(() => {
                                    const toPackage = Math.max(0, v.casesNeeded - calc.casesCompleted);
                                    return (
                                      <span className="text-2xl font-mono font-black tabular-nums text-foreground">
                                        {casesPerSkid > 0 ? (
                                          <>
                                            {fmtNum(Math.floor(toPackage / casesPerSkid), 0)}
                                            <span className="text-muted-foreground mx-1">/</span>
                                            {fmtNum(toPackage % casesPerSkid, 0)}
                                          </>
                                        ) : (
                                          fmtNum(toPackage, 0)
                                        )}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="bg-muted/20 border border-border/30 rounded-xl p-3 flex items-center justify-between">
                                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cases Done</span>
                                  <span className="text-2xl font-mono font-black tabular-nums text-emerald-400">{fmtNum(calc.casesCompleted, 0)}</span>
                                </div>
                                {calc.casesInFreezer > 0 && (
                                  <div className="bg-sky-950/30 border border-sky-700/40 rounded-xl p-3 flex items-center justify-between">
                                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">In Freeze Tunnel / On Line</span>
                                    <span className="text-2xl font-mono font-black tabular-nums text-sky-400">{fmtNum(calc.casesInFreezer, 0)}</span>
                                  </div>
                                )}
                                {calc.extraCases > 0 && (
                                  <div className="bg-emerald-950/30 border border-emerald-700/40 rounded-xl p-3 flex items-center justify-between">
                                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Extra Cases Beyond Target</span>
                                    <span className="text-2xl font-mono font-black tabular-nums text-emerald-400">+{fmtNum(calc.extraCases, 0)}</span>
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
                </div>


                {/* ─── Packaging Config (collapsible) ─── */}
                <details className="group mt-6 rounded-xl border border-border/40 bg-card/40 overflow-hidden">
                  <summary className="list-none cursor-pointer px-4 py-3 flex items-center justify-between select-none [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-bold text-foreground">Packaging Config</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const cartonedVal = ((v.cartoned as string) ?? "").trim().toLowerCase();
                        const isCartoned = isCartonedValue(cartonedVal);
                        const isLabeled = cartonedVal === "labeled";
                        const posLabel = isLabeled ? labelPositionLabel(v.labelPosition as string) : "";
                        const badgeText = isCartoned
                          ? "Cartoned"
                          : isLabeled
                            ? posLabel ? `Labeled · ${posLabel}` : "Labeled"
                            : "N/A";
                        return (
                          <div className="flex gap-1.5 group-open:hidden">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                                isCartoned
                                  ? "bg-primary/10 text-primary border-primary/20"
                                  : "bg-muted text-muted-foreground border-border/60"
                              }`}
                            >
                              {badgeText}
                            </span>
                            {isCartoned && Number(v.cartonsPerCase) > 0 && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground">
                                {fmtNum(Number(v.cartonsPerCase), 0)} / case
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </div>
                  </summary>
                  <div className="px-4 pb-4 border-t border-border/20 pt-3 bg-card/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      {isCartonedValue(v.cartoned as string) && (
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Cartons/Case</span>
                          <span className="text-sm font-mono font-bold text-foreground">
                            {Number(v.cartonsPerCase) > 0 ? fmtNum(Number(v.cartonsPerCase), 0) : "—"}
                          </span>
                        </div>
                      )}
                      {((v.cartoned as string) ?? "").trim().toLowerCase() === "labeled" && (
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Label Position</span>
                          <span className="text-sm font-semibold text-foreground capitalize truncate">
                            {labelPositionLabel(v.labelPosition as string) || "—"}
                          </span>
                        </div>
                      )}
                      {/* Labels-per-roll readouts — only when Labeled and a value is set. */}
                      {((v.cartoned as string) ?? "").trim().toLowerCase() === "labeled" && (() => {
                        const pos = ((v.labelPosition as string) ?? "").trim().toLowerCase();
                        const single = Number(v.labelsPerRoll) || 0;
                        const top = Number(v.topLabelsPerRoll) || 0;
                        const bottom = Number(v.bottomLabelsPerRoll) || 0;
                        return (
                          <>
                            {(pos === "top" || pos === "bottom") && single > 0 && (
                              <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Labels/Roll</span>
                                <span className="text-sm font-mono font-bold text-foreground">{fmtNum(single, 0)}</span>
                              </div>
                            )}
                            {pos === "both" && top > 0 && (
                              <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Top Labels/Roll</span>
                                <span className="text-sm font-mono font-bold text-foreground">{fmtNum(top, 0)}</span>
                              </div>
                            )}
                            {pos === "both" && bottom > 0 && (
                              <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Bottom Labels/Roll</span>
                                <span className="text-sm font-mono font-bold text-foreground">{fmtNum(bottom, 0)}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {PACKAGING_FIELDS.filter((f: any) => f.name !== "cartoned").map((f: any) => {
                        const val = ((v[f.name] as string) ?? "").trim();
                        return (
                          <div key={f.name} className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate">{f.label}</span>
                            <span className="text-sm font-semibold text-foreground capitalize truncate" title={val}>
                              {val || "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
    </>
  );
});
