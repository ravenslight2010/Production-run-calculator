import { memo, useCallback, useEffect, useRef } from "react";
import { useWatch } from "react-hook-form";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { applyRecipeSubstitutions } from "@workspace/inventory-math";
import {
  APPLICATOR_STOCK_REGISTERS,
  applicatorStockFields,
  capApplicatorStock,
  computeApplicatorStockCapacityLbs,
  computeFrontlineSupplyFromStockLbs,
} from "@workspace/live-calc";
import { MANUAL_SECTION_FIELDS, type ManualSection } from "@workspace/sync-contract";
import type { FormValues } from "../../types";
import { markRunValuesUpdated } from "../../adapters/browserRunPersistence";
import { useManualControlLock } from "../../manualSectionLocks";
import { useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { useLiveRun } from "../../contexts/LiveRunContext";
import { isFrontlineDrainComplete } from "../../linePhases";
import {
  deriveFrontlineNeedRows,
  deriveLiveFrontlineQuantitySource,
} from "../../frontlineRows";
import { fmtNum, sauceBarrelBreakdown } from "../../utils";
import { ReadOnlyRecipeCard, StatRow } from "./stationShared";
import { Button } from "../ui/button";
import { PepperoniSupplyPanel } from "./PepperoniSupplyPanel";

export const LiveFrontlineTabContent = memo(function LiveFrontlineTabContent() {
  const hx = useHomeTabCtx();
  const { v, runStatus, currentRun, currentRunId, dayState, form, lastLocalEditRef, queueManualCorrection, switchToRun } = hx;
  const { calc, elapsedBatchSec, linePhases, autoTrackProgress } = useLiveRun();
  const currentValues = useWatch({ control: form.control }) as FormValues;
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
  const stockLocks = {
    app1: useManualControlLock(currentRunId, "applicator-1-stock"),
    app2: useManualControlLock(currentRunId, "applicator-2-stock"),
    app3: useManualControlLock(currentRunId, "applicator-3-stock"),
    app4: useManualControlLock(currentRunId, "applicator-4-stock"),
  };
  const setManualStock = useCallback((register: (typeof APPLICATOR_STOCK_REGISTERS)[number], requestedLbs: number) => {
    const values = form.getValues();
    const fields = applicatorStockFields(register);
    const capacity = computeApplicatorStockCapacityLbs(values as unknown as Record<string, unknown>, register);
    const next = capApplicatorStock(requestedLbs, capacity);
    const section: ManualSection = register.startsWith("app")
      ? register as ManualSection
      : register.startsWith("pep1") ? "pep1" : "pep2";
    const baseline = Object.fromEntries(
      MANUAL_SECTION_FIELDS[section].map((field) => [
        field,
        Number(values[field as keyof FormValues]) || 0,
      ]),
    );
    const generation = Math.max(0, Number(values[fields.correctionGeneration as keyof FormValues]) || 0) + 1;
    const anchor = Math.max(0, elapsedBatchSec);
    const correction: Record<string, number> = {
      [fields.stock]: next,
      [fields.anchor]: anchor,
      [fields.correctionGeneration]: generation,
    };
    if (register.startsWith("app")) {
      // Both channels touch this supply. Fence an in-flight production claim
      // as well as depletion, and start the next cadence at this correction.
      correction[`${register}BatchAnchorNetSec`] = anchor;
      correction[`${register}BatchCorrectionGeneration`] =
        Math.max(0, Number(values[`${register}BatchCorrectionGeneration` as keyof FormValues]) || 0) + 1;
      correction[`${register}BatchesMade`] =
        Math.max(0, Number(values[`${register}BatchesMade` as keyof FormValues]) || 0);
    }
    for (const [field, value] of Object.entries(correction)) {
      form.setValue(field as keyof FormValues, value as never, { shouldDirty: true });
    }
    form.setValue("applicatorStockInitialized", true, { shouldDirty: true });
    const now = Date.now();
    markRunValuesUpdated(currentRunId, now);
    lastLocalEditRef.current = now;
    queueManualCorrection(currentRunId, correction, baseline);
  }, [currentRunId, elapsedBatchSec, form, lastLocalEditRef, queueManualCorrection]);
  const isLive = runStatus === "running" || runStatus === "paused";
  const frontlineRows = deriveFrontlineNeedRows(v, deriveLiveFrontlineQuantitySource(v, calc));
  const effectiveBatchLbs = (slot: 1 | 2 | 3 | 4) => {
    const recipeLbs = (currentValues[`app${slot}CheeseRecipe`] ?? []).reduce(
      (sum, row) => sum + (Number(row.lbs) || 0), 0,
    );
    const configured = recipeLbs > 0 ? recipeLbs : Number(currentValues[`app${slot}BatchLbs`]);
    return Number.isFinite(configured) && configured > 0 && configured <= 50 ? configured : 0;
  };
  const remainingFrontlineRows = frontlineRows.map((row) => {
    if (!/^app[1-4]$/.test(row.key) || row.unit !== "batches") return row;
    const slot = Number(row.key.slice(3)) as 1 | 2 | 3 | 4;
    const batchLbs = effectiveBatchLbs(slot);
    if (!batchLbs) return row;
    const supply = computeFrontlineSupplyFromStockLbs({
      demandLbs: row.totalLbs,
      consumedLbs: Number(currentValues[`app${slot}StockConsumedLbs`]) || 0,
      onLineLbs: Number(currentValues[`app${slot}StockLbs`]) || 0,
      configuredEffectiveWeight: batchLbs,
    });
    return { ...row, amount: supply?.stillToMake ?? row.amount };
  });
  return (
    <>
      <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
        <div className="h-1 bg-primary w-full" /><CardHeader className="pb-2 pt-4 px-5"><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Boxes className="w-4 h-4" /> Batches Needed</CardTitle></CardHeader>
        <CardContent className="px-5 pb-5"><p className="text-xs text-muted-foreground mb-4">Planned <span className="font-mono text-foreground">{fmtNum(Math.max(0, v.casesNeeded), 0)}</span> cases × <span className="font-mono text-foreground">{v.pizzasPerCase}</span> pizzas/case. Still to make excludes used and on-line supply.</p>
          {remainingFrontlineRows.map((row) => {
            const testId = `output-${row.key}-batches`;
            const bd = row.station === "sauce" && row.unit === "batches" ? sauceBarrelBreakdown(row.amount, calc.sauceEffBarrel) : null;
            return <StatRow key={row.key} label={row.label} value={bd ? `${fmtNum(row.amount, 2)} batches · ${bd.totalBarrels} barrels` : `${fmtNum(row.amount, row.unit === "lbs" ? 1 : 2)} ${row.unit}`} testId={testId} highlight={row.amount > 0} sub={row.recipeName} />;
          })}
        </CardContent>
      </Card>
      <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
        <div className="h-1 bg-emerald-500 w-full" />
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Applicator batches on line</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <p className="text-xs text-muted-foreground mb-3">Current supply is shown in batch units. Automatic tracking consumes available supply; manual corrections change only the current amount.</p>
          {([1, 2, 3, 4] as const).map((slot) => {
            const register = `app${slot}` as const;
            const type = String(currentValues[`${register}Type`] ?? "").trim();
            const batchLbs = effectiveBatchLbs(slot);
            if (!type) return null;
            if (!batchLbs) {
              return <div key={`${register}-${currentRunId}`} data-testid={`frontline-supply-${register}`} className="border-b border-border/40 py-2 last:border-0">
                <div className="text-sm font-medium">{register.toUpperCase()} · {type}</div>
                <div role="status" className="text-xs text-amber-500">Batch supply unavailable — set a valid batch weight in Setup.</div>
              </div>;
            }
            const fields = applicatorStockFields(register);
            const capacity = Math.min(
              computeApplicatorStockCapacityLbs(currentValues as unknown as Record<string, unknown>, register),
              2 * batchLbs,
            );
            const stockLbs = Number(currentValues[fields.stock as keyof FormValues]) || 0;
            const batchesOnLine = stockLbs / batchLbs;
            const lock = stockLocks[register];
            const suppressed = !!lock;
            const status = !autoTrackProgress ? "Manual tracking"
              : runStatus === "paused" ? "Automatic tracking paused with run"
                : suppressed ? "Automatic tracking paused during this correction"
                : "Automatic tracking";
            return (
              <div key={`${register}-${currentRunId}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-2 last:border-0" data-testid={`frontline-supply-${register}`}>
                <div className="min-w-32">
                  <div className="text-sm font-medium">{register.toUpperCase()} · {type}</div>
                  <div className="text-xs text-muted-foreground">{status}</div>
                  {lock?.peer && <div role="status" className="text-xs text-amber-500">Another station is editing this applicator.</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" aria-label={`Decrease ${register} batches on line`} disabled={!isLive || !!lock || batchesOnLine <= 0} onClick={() => setManualStock(register, Math.max(0, stockLbs - batchLbs))}>−</Button>
                  <span className="min-w-24 text-center font-mono text-lg tabular-nums" data-testid={`output-${register}-batches-on-line`}>{fmtNum(batchesOnLine, 2)} batches</span>
                  <Button type="button" variant="outline" size="sm" aria-label={`Increase ${register} batches on line`} disabled={!isLive || !!lock || stockLbs + batchLbs > capacity} onClick={() => setManualStock(register, stockLbs + batchLbs)}>+</Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <PepperoniSupplyPanel runId={currentRunId} values={currentValues} isLive={isLive} onSave={setManualStock} />
      {([
        { slot: 1, type: v.app1Type, recipe: v.app1CheeseRecipe, name: v.app1CheeseRecipeName },
        { slot: 2, type: v.app2Type, recipe: v.app2CheeseRecipe, name: v.app2CheeseRecipeName },
        { slot: 3, type: v.app3Type, recipe: v.app3CheeseRecipe, name: v.app3CheeseRecipeName },
        { slot: 4, type: v.app4Type, recipe: v.app4CheeseRecipe, name: v.app4CheeseRecipeName },
      ] as const).map((app) => {
        const t = app.type.trim(); if (!t) return null;
        const isMix = t.toLowerCase().includes("mix"); if (t.toLowerCase() !== "cheese" && !isMix) return null;
        const rows = applyRecipeSubstitutions(app.recipe ?? [], dayState.substitutions ?? []).rows.filter((row) => row.ingredient.trim() !== "" || Number(row.lbs ?? 0) > 0);
        if (!rows.length) return null;
        return <ReadOnlyRecipeCard key={app.slot} title={`${t} Recipe`} subtitle={app.name?.trim() || undefined} recipe={app.recipe ?? []} substitutions={dayState.substitutions ?? []} accent={isMix ? "bg-emerald-500/70" : "bg-amber-500/70"} />;
      })}
    </>
  );
});