import { useHomeTabCtx } from "../contexts/HomeTabCtx";
import { useLiveRun } from "../contexts/LiveRunContext";
import {
  computeSummaryStats,
  fmtClock,
  fmtComma,
  fmtCountdownParts,
  fmtMins,
  fmtNum,
  fmtTime,
  runLabel,
  sauceBarrelBreakdown,
} from "../utils";
import { groupWarehouseNeedRows } from "../warehouseGrouping";
import { loadRunValues } from "../storage";
import { withTempOverrides, DEFAULT_VALUES, DEFAULT_PEP_TYPES, type RunMeta } from "../types";
import { Factory, ArrowRight, Droplets, Layers, Clock, AlertTriangle, BarChart2, Warehouse } from "lucide-react";


export default function ScreenModeView() {
  const {
    activePackagingRows, activeWarehouseRows, currentRun, dayState, doughSubTab, nextRunDieType, runStatus,
    runSummaryStatsById, runValuesById,
    scheduledDays, screenMode, v, ve,
  } = useHomeTabCtx();

  const {
    calc, nowTime, liveFreezerMin, elapsedBatchSec, currentRunDowntimeMs,
    casesPct, casesFreezerPct, casesPctWithFreezer,
    currentBatchNum, secUntilNextBatch, totalBatchesNeeded,
    showBatchDue, setShowBatchDue,
    autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion,
    fireAutoTrackNow, tickDueRefs,
    stallPrompt, setStallPrompt, stallCheck,
  } = useLiveRun();

  if (screenMode === "dashboard") {
    const paceColor = calc.paceStatus === "ahead" ? "text-emerald-400" : calc.paceStatus === "behind" ? "text-red-400" : "text-yellow-400";
    const paceLabel = calc.paceStatus === "ahead" ? "AHEAD" : calc.paceStatus === "behind" ? "BEHIND" : "ON PACE";
    const dashDowntimeSec = (currentRun?.stoppages ?? []).filter((s: any) => s.endedAt && s.type !== "pause").reduce((a: any, s: any) => a + (s.endedAt! - s.startedAt) / 1000, 0);
    const dashMinutesDelta = calc.ppm > 0 && calc.paceDelta !== 0 ? Math.round(Math.abs(calc.paceDelta) * v.pizzasPerCase / calc.ppm) : 0;
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-6 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Factory className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Production Dashboard</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Run name + status */}
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-5xl font-black tracking-tight break-words min-w-0">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
          {runStatus === "running" && <span className="px-3 py-1 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-sm font-bold uppercase">Running</span>}
          {runStatus === "paused" && <span className="px-3 py-1 rounded-full bg-yellow-600/20 border border-yellow-600/40 text-yellow-400 text-sm font-bold uppercase">Paused</span>}
          {runStatus === "ended" && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold uppercase">Ended</span>}
          {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
        </div>

        {/* Main stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 flex-1">
          {/* PPM */}
          <div className="rounded-2xl bg-card border border-border p-8 flex flex-col justify-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">Pizzas / Min</p>
            <p className="text-8xl font-black tabular-nums text-primary">{calc.ppm > 0 ? fmtComma(calc.ppm) : "—"}</p>
          </div>

          {/* Cases progress */}
          <div className="rounded-2xl bg-card border border-border p-8 flex flex-col justify-center gap-4">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Cases Done</p>
            <p className="text-7xl font-black tabular-nums">
              {fmtComma(calc.casesCompleted)}
              <span className="text-3xl text-muted-foreground"> / {fmtComma(v.casesNeeded)}</span>
            </p>
            <div className="h-4 rounded-full bg-muted/30 overflow-hidden flex">
              <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${casesPct * 100}%` }} />
              {casesFreezerPct > 0 && (
                <div className="h-full bg-sky-400/40 transition-all duration-1000" style={{ width: `${casesFreezerPct * 100}%` }} />
              )}
            </div>
            <div className="flex items-center gap-6 flex-wrap">
              <p className="text-lg font-semibold text-muted-foreground">
                {Math.round(casesPct * 100)}% complete
                {calc.casesInFreezer > 0 && (
                  <span className="text-sky-400"> · +{fmtComma(calc.casesInFreezer)} in Freeze tunnel ({Math.round(casesPctWithFreezer * 100)}%)</span>
                )}
              </p>
              {v.casesPerSkid > 0 && v.casesNeeded > 0 && (
                <p className="text-lg font-semibold text-muted-foreground">
                  {v.skidsCompleted} / {Math.floor(v.casesNeeded / v.casesPerSkid)} skids
                </p>
              )}
            </div>
          </div>

          {/* Pace + time */}
          <div className="rounded-2xl bg-card border border-border p-8 flex flex-col justify-center gap-4">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Pace</p>
            <p className={`text-6xl font-black ${paceColor}`}>{paceLabel}</p>
            {calc.paceDelta !== 0 && (
              <p className="text-2xl font-bold text-muted-foreground">
                {calc.paceDelta > 0 ? "+" : ""}{fmtComma(Math.abs(calc.paceDelta))} cases
                {dashMinutesDelta > 0 && <span className="text-lg ml-2 opacity-70">(~{fmtMins(dashMinutesDelta)})</span>}
              </p>
            )}
            {dashDowntimeSec > 0 && (
              <p className="text-lg font-semibold text-red-400/80">
                ↓ {fmtTime(dashDowntimeSec)} downtime
              </p>
            )}
            {calc.adjustedTimeSec > 0 && (
              <div className="mt-2 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold mb-1">Est. Finish</p>
                <p className="text-3xl font-black tabular-nums">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</p>
                <p className="text-lg text-muted-foreground">{fmtTime(calc.adjustedTimeSec)} remaining</p>
              </div>
            )}
          </div>
        </div>

        {/* Next run footer */}
        {dayState.runs[dayState.currentIndex + 1] && (
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-muted/20 border border-border/50 text-muted-foreground">
            <ArrowRight className="w-4 h-4 shrink-0" />
            <span className="text-sm font-semibold min-w-0 truncate">Next: {runLabel(dayState.runs[dayState.currentIndex + 1])}</span>
            {nextRunDieType && nextRunDieType !== v.dieType && (
              <span className="ml-2 text-xs font-bold text-amber-400">⚠ Die change → {nextRunDieType}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "dough") {
    const batchUrgent = secUntilNextBatch > 0 && secUntilNextBatch < 120;
    const batchDue = secUntilNextBatch <= 0 || (elapsedBatchSec > 0 && secUntilNextBatch < 5);
    const mm = Math.floor(secUntilNextBatch / 60);
    const ss = Math.floor(secUntilNextBatch % 60);
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-8 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Droplets className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Dough Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        <h1 className="text-4xl font-black break-words min-w-0">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>

        {/* Big countdown */}
        {runStatus === "running" && calc.timePerBatchSec > 0 && doughSubTab !== "crusts" ? (
          <div className={`flex-1 flex flex-col items-center justify-center gap-6 rounded-3xl border p-12 ${batchDue ? "bg-orange-950/40 border-orange-500/50" : batchUrgent ? "bg-amber-950/30 border-amber-600/40" : "bg-card border-border"}`}>
            <p className={`text-lg font-bold uppercase tracking-widest ${batchDue ? "text-orange-400" : batchUrgent ? "text-amber-400" : "text-muted-foreground"}`}>
              {batchDue ? "🍕 Start Next Batch Now!" : "Next Batch In"}
            </p>
            <p className={`text-[10rem] font-black tabular-nums leading-none ${batchDue ? "text-orange-400 animate-pulse" : batchUrgent ? "text-amber-400" : "text-primary"}`}>
              {batchDue ? "GO" : `${fmtCountdownParts(mm, ss)}`}
            </p>
            <div className="flex items-center gap-8 text-center mt-4">
              <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wider">Current Batch</p>
                <p className="text-5xl font-black tabular-nums">{currentBatchNum + 1}</p>
              </div>
              {totalBatchesNeeded > 0 && (
                <>
                  <p className="text-4xl text-muted-foreground font-light">of</p>
                  <div>
                    <p className="text-sm text-muted-foreground uppercase tracking-wider">Total Batches</p>
                    <p className="text-5xl font-black tabular-nums">{totalBatchesNeeded}</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-6 text-muted-foreground">
              <div className="text-center">
                <p className="text-xs uppercase tracking-wider mb-1">Time Per Batch</p>
                <p className="text-2xl font-bold">{fmtTime(calc.timePerBatchSec)}</p>
              </div>
              {calc.perBatch > 0 && (
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wider mb-1">Yield / Batch</p>
                  <p className="text-2xl font-bold">{fmtComma(Math.round(calc.perBatch))}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-3xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">
              {doughSubTab === "crusts" ? "Crust run — no dough batches to mix" : runStatus === "pending" ? "Run not started" : runStatus === "ended" ? "Run ended" : "Enter line speed to see batch timing"}
            </p>
          </div>
        )}

        {/* Dough stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-card border border-border p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{doughSubTab === "crusts" ? "Stacks Ready" : "Trays on Line"}</p>
            <p className="text-3xl font-black tabular-nums">{v.traysOnLine > 0 ? v.traysOnLine : "—"}</p>
            {calc.traysNeeded > 0 && <p className="text-sm text-muted-foreground">/ {fmtNum(calc.traysNeeded, 0)} still needed <span className="opacity-60">(net)</span></p>}
          </div>
          {doughSubTab !== "crusts" && (
            <div className="rounded-2xl bg-card border border-border p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Batches Ready</p>
              <p className="text-3xl font-black tabular-nums">{v.batchesReady}</p>
              {calc.batchesNeeded > 0 && <p className="text-sm text-muted-foreground">/ {fmtNum(calc.batchesNeeded, 1)} still needed <span className="opacity-60">(net)</span></p>}
            </div>
          )}
          {v.doughBatchYield > 0 && doughSubTab !== "crusts" && (
            <div className="rounded-2xl bg-card border border-border p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Batch Yield</p>
              <p className="text-3xl font-black tabular-nums">{fmtComma(v.doughBatchYield)}</p>
              <p className="text-sm text-muted-foreground">doughballs</p>
            </div>
          )}
          {v.casesNeeded > 0 && (
            <div className="rounded-2xl bg-card border border-border p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cases Done</p>
              <p className="text-3xl font-black tabular-nums">{fmtComma(calc.casesCompleted)}</p>
              <p className="text-sm text-muted-foreground">/ {fmtComma(v.casesNeeded)}</p>
              {calc.casesInFreezer > 0 && (
                <p className="text-sm font-semibold text-sky-400 tabular-nums">+{fmtComma(calc.casesInFreezer)} in Freeze tunnel</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screenMode === "frontline") {
    const s = computeSummaryStats(v);
    const items: { label: string; value: string; sub?: string }[] = [];
    if (s.sauceBatches > 0) {
      const bd = sauceBarrelBreakdown(s.sauceBatches, s.sauceEffBarrel);
      items.push({ label: "Sauce", value: bd ? `${fmtNum(s.sauceBatches, 2)} batches · ${bd.totalBarrels} barrels` : fmtNum(s.sauceBatches, 2) + " barrels" });
    }
    if (s.app1Type) {
      const isMix = s.app1Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app1Lbs > 0 : s.app1Batches > 0)
        items.push({ label: `App 1 — ${s.app1Type}`, value: isMix ? fmtNum(s.app1Lbs, 1) + " lbs" : fmtNum(s.app1Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app1Lbs, 1) + " lbs total" });
    }
    if (s.app2Type) {
      const isMix = s.app2Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app2Lbs > 0 : s.app2Batches > 0)
        items.push({ label: `App 2 — ${s.app2Type}`, value: isMix ? fmtNum(s.app2Lbs, 1) + " lbs" : fmtNum(s.app2Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app2Lbs, 1) + " lbs total" });
    }
    // Pep applicators sit between App 2 and App 3, matching the physical line
    // order (and the Run/Frontline tabs' card order).
    const pep1Label = v.pep1Combined === true ? "Pep 1 & 2" : "Pep 1";
    if (s.pep1Type) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep1Type);
      if ((isPepStd ? s.pep1Lbs : s.pep1Batches) > 0)
        items.push({ label: `${pep1Label} — ${s.pep1Type}`, value: isPepStd ? fmtNum(s.pep1Lbs, 2) + " lbs" : fmtNum(s.pep1Batches, 2) + " batches" });
    }
    if (s.pep1TypeB) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep1TypeB);
      if ((isPepStd ? s.pep1LbsB : s.pep1BatchesB) > 0)
        items.push({ label: `${pep1Label} — ${s.pep1TypeB}`, value: isPepStd ? fmtNum(s.pep1LbsB, 2) + " lbs" : fmtNum(s.pep1BatchesB, 2) + " batches" });
    }
    if (s.pep2Type) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep2Type);
      if ((isPepStd ? s.pep2Lbs : s.pep2Batches) > 0)
        items.push({ label: `Pep 2 — ${s.pep2Type}`, value: isPepStd ? fmtNum(s.pep2Lbs, 2) + " lbs" : fmtNum(s.pep2Batches, 2) + " batches" });
    }
    if (s.pep2TypeB) {
      const isPepStd = DEFAULT_PEP_TYPES.includes(s.pep2TypeB);
      if ((isPepStd ? s.pep2LbsB : s.pep2BatchesB) > 0)
        items.push({ label: `Pep 2 — ${s.pep2TypeB}`, value: isPepStd ? fmtNum(s.pep2LbsB, 2) + " lbs" : fmtNum(s.pep2BatchesB, 2) + " batches" });
    }
    if (s.app3Type) {
      const isMix = s.app3Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app3Lbs > 0 : s.app3Batches > 0)
        items.push({ label: `App 3 — ${s.app3Type}`, value: isMix ? fmtNum(s.app3Lbs, 1) + " lbs" : fmtNum(s.app3Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app3Lbs, 1) + " lbs total" });
    }
    if (s.app4Type) {
      const isMix = s.app4Type.trim().toLowerCase().includes("mix");
      if (isMix ? s.app4Lbs > 0 : s.app4Batches > 0)
        items.push({ label: `App 4 — ${s.app4Type}`, value: isMix ? fmtNum(s.app4Lbs, 1) + " lbs" : fmtNum(s.app4Batches, 2) + " batches", sub: isMix ? undefined : fmtNum(s.app4Lbs, 1) + " lbs total" });
    }
    const cheeseRecipes: { label: string; rows: { ingredient: string; lbs: number }[] }[] = [];
    if ((v.app1CheeseRecipe ?? []).length > 0) cheeseRecipes.push({ label: `App 1 Cheese Recipe`, rows: v.app1CheeseRecipe.filter((r: any) => r.ingredient && Number(r.lbs) > 0).map((r: any) => ({ ingredient: r.ingredient, lbs: Number(r.lbs) })) });
    if ((v.app2CheeseRecipe ?? []).length > 0) cheeseRecipes.push({ label: `App 2 Cheese Recipe`, rows: v.app2CheeseRecipe.filter((r: any) => r.ingredient && Number(r.lbs) > 0).map((r: any) => ({ ingredient: r.ingredient, lbs: Number(r.lbs) })) });

    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Frontline Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Run name + status */}
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-4xl font-black break-words min-w-0">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
          {runStatus === "running" && <span className="px-3 py-1 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-sm font-bold uppercase">Running</span>}
          {runStatus === "paused" && <span className="px-3 py-1 rounded-full bg-yellow-600/20 border border-yellow-600/40 text-yellow-400 text-sm font-bold uppercase">Paused</span>}
          {runStatus === "ended" && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold uppercase">Ended</span>}
          {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
          {v.casesNeeded > 0 && (
            <span className="ml-auto text-2xl font-black tabular-nums text-muted-foreground">
              {fmtComma(calc.casesCompleted)} <span className="text-lg">/ {fmtComma(v.casesNeeded)} cases</span>
              {calc.casesInFreezer > 0 && (
                <span className="text-lg text-sky-400"> · +{fmtComma(calc.casesInFreezer)} in Freeze tunnel</span>
              )}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {v.casesNeeded > 0 && (
          <div className="h-3 rounded-full bg-muted/30 overflow-hidden -mt-2 flex">
            <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${casesPct * 100}%` }} />
            {casesFreezerPct > 0 && (
              <div className="h-full bg-sky-400/40 transition-all duration-1000" style={{ width: `${casesFreezerPct * 100}%` }} />
            )}
          </div>
        )}

        {/* Ingredient grid */}
        {items.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 flex-1">
            {items.map((item: any, i: any) => (
              <div key={i} className="rounded-2xl bg-card border border-border p-6 flex flex-col justify-center gap-1">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="text-5xl font-black tabular-nums text-foreground">{item.value}</p>
                {item.sub && <p className="text-base text-muted-foreground font-semibold">{item.sub}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-2xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">No frontline ingredients configured</p>
          </div>
        )}

        {/* Cheese recipe breakdown */}
        {cheeseRecipes.filter((r: any) => r.rows.length > 0).map((recipe: any, i: any) => (
          <div key={i} className="rounded-2xl bg-card border border-border p-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">{recipe.label}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {recipe.rows.map((row: any, j: any) => (
                <div key={j} className="flex items-center justify-between gap-3">
                  <span className="text-xl font-semibold">{row.ingredient}</span>
                  <span className="text-2xl font-black tabular-nums text-primary">{fmtNum(row.lbs, 1)} lbs</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Time remaining footer */}
        {(runStatus === "running" || runStatus === "paused") && calc.adjustedTimeSec > 0 && (
          <div className="flex items-center gap-8 px-6 py-4 rounded-2xl bg-muted/20 border border-border/50 text-muted-foreground">
            <div><p className="text-xs uppercase tracking-wider">Est. Finish</p><p className="text-3xl font-black tabular-nums">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</p></div>
            <div><p className="text-xs uppercase tracking-wider">Time Left</p><p className="text-3xl font-black tabular-nums">{fmtTime(calc.adjustedTimeSec)}</p></div>
            {calc.ppm > 0 && <div><p className="text-xs uppercase tracking-wider">PPM</p><p className="text-3xl font-black tabular-nums">{fmtComma(calc.ppm)}</p></div>}
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "backline") {
    const freezerMs = Number(ve.freezerTime) * 60000;
    const freezerRemainMs = runStatus === "ended" && currentRun?.endedAt && freezerMs > 0
      ? Math.max(0, currentRun.endedAt + freezerMs - nowTime.getTime())
      : 0;
    const freezerDraining = freezerRemainMs > 0;
    const freezerPct = freezerMs > 0 ? Math.max(0, 1 - freezerRemainMs / freezerMs) : 1;
    const fmm = Math.floor(freezerRemainMs / 60000);
    const fss = Math.floor((freezerRemainMs % 60000) / 1000);
    const upcomingRuns = dayState.runs.filter((_: any, i: any) => i > dayState.currentIndex);

    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Backline Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Current run block */}
        <div className={`rounded-3xl border p-8 flex flex-col gap-5 ${
          runStatus === "ended" && freezerDraining ? "bg-amber-950/30 border-amber-600/40"
          : runStatus === "ended" ? "bg-emerald-950/20 border-emerald-700/30"
          : runStatus === "running" ? "bg-primary/5 border-primary/30"
          : "bg-card border-border"
        }`}>
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-4xl font-black break-words min-w-0">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
            {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
            {runStatus === "running" && <span className="px-3 py-1 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-sm font-bold uppercase">Running</span>}
            {runStatus === "paused" && <span className="px-3 py-1 rounded-full bg-yellow-600/20 border border-yellow-600/40 text-yellow-400 text-sm font-bold uppercase">Paused</span>}
            {runStatus === "ended" && !freezerDraining && <span className="px-3 py-1 rounded-full bg-emerald-700/30 text-emerald-400 text-sm font-bold uppercase">Complete</span>}
          </div>

          {/* Cases progress while running */}
          {(runStatus === "running" || runStatus === "paused") && v.casesNeeded > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-end gap-4">
                <p className="text-6xl font-black tabular-nums">{fmtComma(calc.casesCompleted)}</p>
                <p className="text-3xl text-muted-foreground font-bold mb-1">/ {fmtComma(v.casesNeeded)} cases</p>
                {calc.casesInFreezer > 0 && (
                  <p className="text-2xl font-bold text-sky-400 tabular-nums mb-1">+{fmtComma(calc.casesInFreezer)} in Freeze tunnel</p>
                )}
              </div>
              <div className="h-4 rounded-full bg-muted/30 overflow-hidden flex">
                <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${casesPct * 100}%` }} />
                {casesFreezerPct > 0 && (
                  <div className="h-full bg-sky-400/40 transition-all duration-1000" style={{ width: `${casesFreezerPct * 100}%` }} />
                )}
              </div>
              <div className="flex gap-6 flex-wrap">
                {v.casesPerSkid > 0 && (
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Skids Done</p><p className="text-2xl font-black tabular-nums">{v.skidsCompleted}{v.casesNeeded > 0 ? ` / ${Math.floor(v.casesNeeded / v.casesPerSkid)}` : ""}</p></div>
                )}
                {calc.ppm > 0 && <div><p className="text-xs text-muted-foreground uppercase tracking-wider">PPM</p><p className="text-2xl font-black tabular-nums">{fmtComma(calc.ppm)}</p></div>}
                {currentRunDowntimeMs > 0 && <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Downtime</p><p className="text-2xl font-black tabular-nums text-amber-400">{fmtTime(currentRunDowntimeMs / 1000)}</p></div>}
              </div>
              {calc.adjustedTimeSec > 0 && (
                <div className="flex gap-8 mt-1">
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Est. Finish</p><p className="text-3xl font-black tabular-nums">{fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}</p></div>
                  <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Time Left</p><p className="text-3xl font-black tabular-nums">{fmtTime(calc.adjustedTimeSec)}</p></div>
                </div>
              )}
            </div>
          )}

          {/* Freeze tunnel countdown */}
          {runStatus === "ended" && freezerMs > 0 && (
            <div className="flex flex-col gap-4">
              <p className={`text-sm font-bold uppercase tracking-widest ${freezerDraining ? "text-amber-400" : "text-emerald-400"}`}>
                {freezerDraining ? "❄️ Freeze Tunnel Draining" : "✅ Freeze Tunnel Empty — Ready"}
              </p>
              {freezerDraining && (
                <>
                  <p className="text-[8rem] font-black tabular-nums leading-none text-amber-400">
                    {fmtCountdownParts(fmm, fss)}
                  </p>
                  <div className="h-4 rounded-full bg-muted/30 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500 transition-all duration-1000" style={{ width: `${freezerPct * 100}%` }} />
                  </div>
                  <p className="text-lg text-muted-foreground">{fmtMins(Number(ve.freezerTime))} total · clears at {fmtClock((currentRun?.endedAt ?? 0) + freezerMs)}</p>
                </>
              )}
              {!freezerDraining && (
                <p className="text-5xl font-black text-emerald-400">CLEAR</p>
              )}
            </div>
          )}

          {/* Ended with no freezer */}
          {runStatus === "ended" && freezerMs === 0 && (
            <p className="text-5xl font-black text-emerald-400">Run Complete</p>
          )}
        </div>

        {/* Upcoming runs */}
        {upcomingRuns.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Up Next — {upcomingRuns.length} run{upcomingRuns.length > 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {upcomingRuns.map((run: any, i: any) => {
                const vals = withTempOverrides(loadRunValues(run.id));
                const s = computeSummaryStats(vals);
                const estSec = s.estimatedTimeSec;
                const dieChange = vals.dieType && v.dieType && vals.dieType !== (i === 0 ? v.dieType : loadRunValues(upcomingRuns[i - 1].id).dieType);
                return (
                  <div key={run.id} className="rounded-2xl bg-card border border-border p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">#{dayState.currentIndex + i + 2}</span>
                      {dieChange && <span className="text-xs font-bold text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Die change</span>}
                    </div>
                    <p className="text-2xl font-black leading-tight break-words min-w-0">{runLabel(run)}</p>
                    {vals.dieType && <span className="self-start px-2 py-0.5 rounded text-xs font-bold bg-muted/50 border border-border/50 text-muted-foreground">{vals.dieType}</span>}
                    <div className="flex gap-4 mt-auto">
                      {s.totalCases > 0 && <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cases</p><p className="text-xl font-black tabular-nums">{fmtComma(s.totalCases)}</p></div>}
                      {estSec > 0 && <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Est. Time</p><p className="text-xl font-black tabular-nums">{fmtTime(estSec)}</p></div>}
                       {vals.freezerTime && Number(vals.freezerTime) > 0 && <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Freeze Tunnel</p><p className="text-xl font-black tabular-nums">{fmtNum(Number(vals.freezerTime), 0)}m</p></div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {upcomingRuns.length === 0 && runStatus === "ended" && !freezerDraining && (
          <div className="flex items-center justify-center rounded-2xl border border-border bg-card py-10">
            <p className="text-2xl text-muted-foreground">No more runs scheduled for this shift</p>
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "sauce") {
    const bd = sauceBarrelBreakdown(calc.sauceBatches, calc.sauceEffBarrel);
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-8 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Droplets className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Sauce Station</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        {/* Run name + status */}
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-4xl font-black break-words min-w-0">{currentRun ? runLabel(currentRun) : "No Active Run"}</h1>
          {v.dieType && <span className="px-3 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground text-sm font-bold">{v.dieType}</span>}
          {v.casesNeeded > 0 && (
            <span className="ml-auto text-2xl font-black tabular-nums text-muted-foreground">
              {fmtComma(Math.max(0, calc.casesLeftToRun))} <span className="text-lg">cases left</span>
            </span>
          )}
        </div>

        {/* Big sauce display */}
        {calc.sauceBatches > 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 rounded-3xl border border-border bg-card p-12">
            <p className="text-lg font-bold uppercase tracking-widest text-muted-foreground">Sauce Needed</p>
            <p className="text-[10rem] font-black tabular-nums leading-none text-primary">{fmtNum(calc.sauceBatches, 2)}</p>
            <p className="text-3xl font-bold text-muted-foreground">batches</p>
            {bd && (
              <div className="flex items-center gap-8 text-center mt-4">
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Batches / Barrel</p>
                  <p className="text-5xl font-black tabular-nums">{bd.batchesPerBarrel}</p>
                </div>
                <p className="text-4xl text-muted-foreground font-light">→</p>
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Total Barrels</p>
                  <p className="text-5xl font-black tabular-nums text-primary">{bd.totalBarrels}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-3xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">No sauce configured for this run</p>
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "warehouse") {
    const activeRuns = dayState.runs.filter((r: any) => !r.endedAt);
    const warehouseRows = [
      ...activeWarehouseRows,
      ...activePackagingRows,
    ];
    const warehouseGroups = groupWarehouseNeedRows(warehouseRows);
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Warehouse className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Warehouse</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>

        <h1 className="text-4xl font-black">Warehouse Needs — {activeRuns.length} active run{activeRuns.length !== 1 ? "s" : ""}</h1>

        {/* Aggregate ingredient grid, grouped to match the interactive warehouse tab. */}
        {warehouseGroups.length > 0 ? (
          <div className="space-y-6 flex-1 content-start">
            {warehouseGroups.map((group) => (
              <section key={group.area}>
                <h2 className="mb-3 text-lg font-bold uppercase tracking-widest text-muted-foreground">{group.area}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {group.rows.map((row, i) => (
                    <div key={`${group.area}-${i}`} className="rounded-2xl bg-card border border-border p-6 flex flex-col justify-center gap-1">
                      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground truncate">{row.label}</p>
                      <p className="text-5xl font-black tabular-nums text-foreground">{row.value}</p>
                      {row.sub && <p className="text-base text-muted-foreground font-semibold">{row.sub}</p>}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-2xl border border-border bg-card">
            <p className="text-2xl text-muted-foreground">No active runs with ingredient needs</p>
          </div>
        )}

        {/* Upcoming production schedule */}
        {scheduledDays.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Upcoming Production</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {scheduledDays.map((day: any) => (
                <div key={day.date} className="rounded-2xl bg-card border border-border p-5 flex items-center justify-between gap-3">
                  <span className="text-2xl font-black">{day.date}</span>
                  <span className="text-lg text-muted-foreground font-semibold">{day.runCount} run{day.runCount !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screenMode === "summary") {
    const finished = dayState.runs.filter((r: any) => !!r.endedAt);
    const totalCases = finished.reduce(
      (sum: number, run: RunMeta) => sum + (
        runSummaryStatsById.get(run.id)?.totalCases ??
        computeSummaryStats(runValuesById.get(run.id) ?? DEFAULT_VALUES).totalCases
      ),
      0,
    );
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col p-8 gap-6 select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart2 className="w-6 h-6 text-primary" />
            <span className="text-base font-bold text-muted-foreground uppercase tracking-widest">Shift Summary</span>
          </div>
          <span className="text-2xl font-black tabular-nums">{fmtClock(nowTime.getTime())}</span>
        </div>
        <div className="grid grid-cols-2 gap-4 flex-1">
          {dayState.runs.map((run: any, i: any) => {
            const vals = runValuesById.get(run.id) ?? DEFAULT_VALUES;
            const s = runSummaryStatsById.get(run.id) ?? computeSummaryStats(vals);
            const isCurr = i === dayState.currentIndex;
            const isDone = !!run.endedAt;
            return (
              <div key={run.id} className={`rounded-2xl border p-6 flex flex-col gap-3 ${isCurr ? "bg-primary/10 border-primary/40" : isDone ? "bg-emerald-950/20 border-emerald-700/30" : "bg-card border-border/50"}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-2xl font-black break-words min-w-0">{runLabel(run)}</p>
                  {vals.dieType && <span className="px-2 py-0.5 rounded text-xs font-bold bg-muted/50 border border-border text-muted-foreground">{vals.dieType}</span>}
                  <span className={`ml-auto text-xs font-bold uppercase px-2 py-0.5 rounded-full ${isCurr ? "bg-primary/20 text-primary" : isDone ? "bg-emerald-700/30 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                    {isCurr ? "Current" : isDone ? "Done" : "Upcoming"}
                  </span>
                </div>
                <div className="flex gap-6 flex-wrap">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Cases</p>
                    <p className="text-3xl font-black tabular-nums">{fmtComma(isDone && run.actualCases != null ? run.actualCases : isCurr ? calc.casesCompleted : 0)}<span className="text-lg text-muted-foreground"> / {fmtComma(s.totalCases)}</span></p>
                  </div>
                  {isCurr && calc.ppm > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">PPM</p>
                      <p className="text-3xl font-black tabular-nums">{fmtComma(calc.ppm)}</p>
                    </div>
                  )}
                  {isCurr && calc.paceStatus && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Pace</p>
                      <p className={`text-2xl font-black ${calc.paceStatus === "ahead" ? "text-emerald-400" : calc.paceStatus === "behind" ? "text-red-400" : "text-yellow-400"}`}>
                        {calc.paceStatus === "ahead" ? "AHEAD" : calc.paceStatus === "behind" ? "BEHIND" : "ON PACE"}
                        {calc.paceDelta !== 0 && <span className="text-lg text-muted-foreground ml-1">{calc.paceDelta > 0 ? "+" : ""}{fmtComma(Math.abs(calc.paceDelta))}</span>}
                      </p>
                    </div>
                  )}
                  {s.estimatedTimeSec > 0 && !isCurr && !isDone && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Est. Time</p>
                      <p className="text-2xl font-black tabular-nums">{fmtTime(s.estimatedTimeSec)}</p>
                    </div>
                  )}
                </div>
                {run.startedAt && <p className="text-xs text-muted-foreground">Started {fmtClock(run.startedAt)}{run.endedAt ? ` · Ended ${fmtClock(run.endedAt)}` : ""}</p>}
              </div>
            );
          })}
        </div>
        {finished.length > 0 && (
          <div className="flex items-center gap-8 px-6 py-4 rounded-2xl bg-card border border-border">
            <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Runs Finished</p><p className="text-4xl font-black">{finished.length}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Total Cases</p><p className="text-4xl font-black tabular-nums">{fmtComma(totalCases)}</p></div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

