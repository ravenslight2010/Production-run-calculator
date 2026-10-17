import { memo, useCallback, useEffect, useRef } from "react";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { applyRecipeSubstitutions } from "@workspace/inventory-math";
import {
  APPLICATOR_STOCK_REGISTERS,
  applicatorStockFields,
  capApplicatorStock,
  computeApplicatorStockCapacityLbs,
  computeFrontlineRunRequirement,
} from "@workspace/live-calc";
import { MANUAL_SECTION_FIELDS, type ManualSection } from "@workspace/sync-contract";
import type { FormValues } from "../../types";
import { markRunValuesUpdated } from "../../adapters/browserRunPersistence";
import { useManualControlLock } from "../../manualSectionLocks";
import { useHomeTabCtx } from "../../contexts/HomeTabCtx";
import { useLiveRun } from "../../contexts/LiveRunContext";
import { isFrontlineDrainComplete } from "../../linePhases";
import { deriveFrontlineNeedRows } from "../../frontlineRows";
import { fmtNum, sauceBarrelBreakdown } from "../../utils";
import { ApplicatorStockRow } from "./ApplicatorStockRow";
import { ReadOnlyRecipeCard, StatRow } from "./stationShared";

export const LiveFrontlineTabContent = memo(function LiveFrontlineTabContent() {
  const hx = useHomeTabCtx();
  const { v, runStatus, currentRun, currentRunId, dayState, form, lastLocalEditRef, queueManualCorrection, switchToRun } = hx;
  const { calc, elapsedBatchSec, linePhases } = useLiveRun();
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
    pep1: useManualControlLock(currentRunId, "pepperoni-1-stock"),
    pep2: useManualControlLock(currentRunId, "pepperoni-2-stock"),
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
    form.setValue(fields.stock as keyof FormValues, next as never, { shouldDirty: true });
    form.setValue(fields.anchor as keyof FormValues, anchor as never, { shouldDirty: true });
    form.setValue(fields.correctionGeneration as keyof FormValues, generation as never, { shouldDirty: true });
    form.setValue("applicatorStockInitialized", true, { shouldDirty: true });
    const now = Date.now();
    markRunValuesUpdated(currentRunId, now);
    lastLocalEditRef.current = now;
    queueManualCorrection(currentRunId, {
      [fields.stock]: next,
      [fields.anchor]: anchor,
      [fields.correctionGeneration]: generation,
    }, baseline);
  }, [currentRunId, elapsedBatchSec, form, lastLocalEditRef, queueManualCorrection]);
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
            const bd = row.station === "sauce" && row.unit === "batches" ? sauceBarrelBreakdown(row.amount, calc.sauceEffBarrel) : null;
            return <StatRow key={row.key} label={row.label} value={bd ? `${fmtNum(row.amount, 2)} batches · ${bd.totalBarrels} barrels` : `${fmtNum(row.amount, row.unit === "lbs" ? 1 : 2)} ${row.unit}`} testId={testId} highlight={row.amount > 0} sub={row.recipeName} />;
          })}
        </CardContent>
      </Card>
      <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
        <div className="h-1 bg-emerald-500 w-full" />
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Applicator Stock On Hand</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <p className="text-xs text-muted-foreground mb-3">Current pounds loaded at each configured applicator. Save an adjustment or fill the slot to its cap after a load or refill.</p>
          {APPLICATOR_STOCK_REGISTERS.map((register) => {
            const values = v as unknown as Record<string, unknown>;
            const fields = applicatorStockFields(register);
            const capacity = computeApplicatorStockCapacityLbs(values, register);
            if (capacity <= 0) return null;
            const lockKey: keyof typeof stockLocks = register.startsWith("app")
              ? register as "app1" | "app2" | "app3" | "app4"
              : register.startsWith("pep1") ? "pep1" : "pep2";
            const lock = stockLocks[lockKey];
            const label = register.startsWith("app")
              ? `App ${register.slice(-1)} · ${String(values[`${register}Type`] ?? "").trim()}`
              : register.endsWith("b")
                ? `Pep ${register.slice(3, 4)} additional · ${String(values[`${register.slice(0, -1)}TypeB`] ?? "").trim()}`
                : `Pep ${register.slice(3, 4)} · ${String(values[`${register}Type`] ?? "").trim()}`;
            return (
              <ApplicatorStockRow
                key={register}
                label={label}
                stockLbs={Number(values[fields.stock]) || 0}
                capacityLbs={capacity}
                disabled={!isLive || !!lock}
                disabledReason={lock?.peer ? "Stock adjustments unavailable while another station is editing." : undefined}
                testId={`stock-${register}-lbs`}
                onSave={(stockLbs) => setManualStock(register, stockLbs)}
              />
            );
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