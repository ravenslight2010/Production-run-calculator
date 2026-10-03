import { memo, useCallback, useEffect, useRef } from "react";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { applyRecipeSubstitutions } from "@workspace/inventory-math";
import { computeFrontlineRunRequirement } from "@workspace/live-calc";
import { markRunValuesUpdated } from "../../adapters/browserRunPersistence";
import { useManualControlLock } from "../../manualSectionLocks";
import { useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { useLiveRun } from "../../contexts/LiveRunContext";
import { isFrontlineDrainComplete } from "../../linePhases";
import { deriveFrontlineNeedRows } from "../../frontlineRows";
import { fmtNum, sauceBarrelBreakdown } from "../../utils";
import { BatchMadeRow } from "./BatchMadeRow";
import { ReadOnlyRecipeCard, StatRow } from "./stationShared";

export const LiveFrontlineTabContent = memo(function LiveFrontlineTabContent() {
  const hx = useHomeTabCtx();
  const { v, runStatus, currentRun, currentRunId, dayState, form, lastLocalEditRef, queueManualCorrection, switchToRun } = hx;
  const { calc, elapsedBatchSec, linePhases, autoSuppressUntilRef } = useLiveRun();
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
      !isFrontlineDrainComplete({
        runStatus,
        endedAt: currentRun.endedAt,
        elapsedBatchSec,
        phases: linePhases,
      })
    ) return;

    if (switchToRun(nextIndex, currentRunId)) {
      autoAdvancedRunRef.current = currentRunId;
    }
  }, [
    currentRun,
    currentRunId,
    dayState.currentIndex,
    dayState.runs,
    elapsedBatchSec,
    linePhases,
    runStatus,
    switchToRun,
  ]);
  const packagingLock = useManualControlLock(currentRunId, "packaging-skids");
  const appLocks = {
    app1: useManualControlLock(currentRunId, "applicator-1-batches"),
    app2: useManualControlLock(currentRunId, "applicator-2-batches"),
    app3: useManualControlLock(currentRunId, "applicator-3-batches"),
    app4: useManualControlLock(currentRunId, "applicator-4-batches"),
  };
  const setManualAppProgress = useCallback((slot: "app1" | "app2" | "app3" | "app4", made: number) => {
    const madeField = `${slot}BatchesMade`;
    const anchorField = `${slot}BatchAnchorNetSec`;
    const generationField = `${slot}BatchCorrectionGeneration`;
    const baseline = {
      [madeField]: Number(form.getValues(madeField)) || 0,
      [anchorField]: Number(form.getValues(anchorField)) || 0,
      [generationField]: Number(form.getValues(generationField)) || 0,
    };
    form.setValue(madeField, Math.max(0, Math.floor(made)) as never, { shouldDirty: true });
    form.setValue(anchorField, Math.max(0, elapsedBatchSec) as never, { shouldDirty: true });
    const correctionGeneration = Math.max(0, Number(form.getValues(generationField)) || 0) + 1;
    form.setValue(generationField, correctionGeneration as never, { shouldDirty: true });
    autoSuppressUntilRef.current = Date.now() + 60_000;
    const now = Date.now();
    markRunValuesUpdated(currentRunId, now);
    lastLocalEditRef.current = now;
    queueManualCorrection(currentRunId, {
      [madeField]: Math.max(0, Math.floor(made)), [anchorField]: Math.max(0, elapsedBatchSec), [generationField]: correctionGeneration,
    }, baseline);
  }, [autoSuppressUntilRef, currentRunId, elapsedBatchSec, form, lastLocalEditRef, queueManualCorrection]);
  const isLive = runStatus === "running" || runStatus === "paused";
  const appRequirement = (slot: 1 | 2 | 3 | 4) => {
    const recipeLbs = (v[`app${slot}CheeseRecipe`] ?? []).reduce((sum: number, row: any) => sum + (Number(row.lbs) || 0), 0);
    return computeFrontlineRunRequirement({ casesNeeded: v.casesNeeded, pizzasPerCase: v.pizzasPerCase, ozPerPizza: v[`app${slot}OzPerPizza`], configuredEffectiveWeight: recipeLbs > 0 ? recipeLbs : v[`app${slot}BatchLbs`] });
  };
  const requirements = [1, 2, 3, 4].map(appRequirement);
  const frontlineRows = deriveFrontlineNeedRows(v, { ...calc, ...Object.fromEntries(requirements.flatMap((r, i) => [[`app${i + 1}Lbs`, r.totalLbs], [`app${i + 1}Batches`, r.totalUnits]])), sauceLbs: Math.max(0, calc.casesLeftToRun * v.pizzasPerCase + v.casesPerLayer * v.pizzasPerCase) * v.sauceOzPerPizza / 16 + 30 } as any);
  return (
    <>
      <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
        <div className="h-1 bg-primary w-full" /><CardHeader className="pb-2 pt-4 px-5"><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Boxes className="w-4 h-4" /> Batches Needed</CardTitle></CardHeader>
        <CardContent className="px-5 pb-5"><p className="text-xs text-muted-foreground mb-4">Based on <span className="font-mono text-foreground">{fmtNum(Math.max(0, calc.casesLeftToRun), 0)}</span> cases × <span className="font-mono text-foreground">{v.pizzasPerCase}</span> pizzas/case</p>
          {frontlineRows.map((row: any) => {
            const testId = `output-${row.key}-batches`;
            if (row.batchProgressField) {
              const slot = row.station as "app1" | "app2" | "app3" | "app4";
              const made = Math.max(0, Number(v[row.batchProgressField]) || 0);
              return <BatchMadeRow key={row.key} label={row.label} totalBatches={row.amount} made={made} onIncrement={() => setManualAppProgress(slot, made + 1)} onDecrement={() => setManualAppProgress(slot, made - 1)} isLive={isLive} disabled={!!appLocks[slot]} disabledReason={appLocks[slot]?.peer ? "Corrections unavailable while another station is editing." : undefined} testId={testId} sub={row.recipeName} pipeline="frontline" />;
            }
            const bd = row.station === "sauce" && row.unit === "batches" ? sauceBarrelBreakdown(row.amount, calc.sauceEffBarrel) : null;
            return <StatRow key={row.key} label={row.label} value={bd ? `${fmtNum(row.amount, 2)} batches · ${bd.totalBarrels} barrels` : `${fmtNum(row.amount, row.unit === "lbs" ? 1 : 2)} ${row.unit}`} testId={testId} highlight={row.amount > 0} sub={row.recipeName} />;
          })}
        </CardContent>
      </Card>
      {[1, 2, 3, 4].map((slot, i) => {
        const app: any = { type: v[`app${slot}Type`], recipe: v[`app${slot}CheeseRecipe`], name: v[`app${slot}CheeseRecipeName`] };
        const t = (app.type ?? "").trim(); if (!t) return null;
        const isMix = t.toLowerCase().includes("mix"); if (t.toLowerCase() !== "cheese" && !isMix) return null;
        const rows = applyRecipeSubstitutions(app.recipe ?? [], dayState.substitutions ?? []).rows.filter((r: any) => (r.ingredient ?? "").trim() !== "" || Number(r.lbs ?? 0) > 0);
        if (!rows.length) return null;
        return <ReadOnlyRecipeCard key={i} title={`${t} Recipe`} subtitle={app.name?.trim() || undefined} recipe={app.recipe ?? []} substitutions={dayState.substitutions ?? []} accent={isMix ? "bg-emerald-500/70" : "bg-amber-500/70"} />;
      })}
    </>
  );
});