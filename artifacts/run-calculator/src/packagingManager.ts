import type { MutableRefObject } from "react";
import type { DayState, FormValues, RunMeta } from "./types";
import { DEFAULT_VALUES, withTempOverrides } from "./types";
import { computeCasesInFreezer } from "@workspace/inventory-math";
import { computeEffectiveLineSpeed } from "./lineSpeed";

export type PackagingProgressSource = "manual" | "auto";

export type PackagingControlAdapter = {
  apply(
    skidsCompleted: number,
    casesOnCurrentSkid: number,
    options?: { vibrationMs?: number; reportCorrection?: boolean },
  ): void;
  setTotal(totalCases: number): void;
  decrementSkids(): void;
  incrementSkids(maxSkids?: number): void;
  decrementCases(): void;
  incrementCases(): void;
  completeSkid(): void;
};

export type DrainingPackagingRun = {
  run: RunMeta;
  values: FormValues;
};

type PackagingControlAdapterDependencies = {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  casesPerSkid: number;
  applyProgress(skidsCompleted: number, casesOnCurrentSkid: number): void;
  reportCorrection(deltaCases: number): void;
  vibrate?(durationMs: number): void;
};

/**
 * Shared action adapter for the full Packaging panel and its station quick
 * checks. UI surfaces own rendering and persistence, while this boundary keeps
 * correction evidence, bounds, and skid/case transitions identical.
 */
export function createPackagingControlAdapter(
  deps: PackagingControlAdapterDependencies,
): PackagingControlAdapter {
  let currentSkids = Math.max(0, Number(deps.skidsCompleted) || 0);
  let currentCases = Math.max(0, Number(deps.casesOnCurrentSkid) || 0);
  const casesPerSkid = Math.max(0, Number(deps.casesPerSkid) || 0);
  const totalCases = (skidsCompleted: number, casesOnCurrentSkid: number) =>
    casesPerSkid > 0
      ? skidsCompleted * casesPerSkid + casesOnCurrentSkid
      : skidsCompleted;

  const apply: PackagingControlAdapter["apply"] = (
    skidsCompleted,
    casesOnCurrentSkid,
    options = {},
  ) => {
    options.vibrationMs && deps.vibrate?.(options.vibrationMs);
    deps.applyProgress(skidsCompleted, casesOnCurrentSkid);
    if (options.reportCorrection !== false) {
      deps.reportCorrection(
        totalCases(skidsCompleted, casesOnCurrentSkid) -
          totalCases(currentSkids, currentCases),
      );
    }
    currentSkids = skidsCompleted;
    currentCases = casesOnCurrentSkid;
  };

  return {
    apply,
    setTotal: (totalCasesToSet) => {
      const total = Math.max(0, totalCasesToSet);
      if (casesPerSkid <= 0) return;
      apply(
        Math.floor(total / casesPerSkid),
        Math.round(total % casesPerSkid),
      );
    },
    decrementSkids: () => apply(Math.max(0, currentSkids - 1), currentCases, { vibrationMs: 8 }),
    incrementSkids: (maxSkids) => {
      if (maxSkids !== undefined && currentSkids >= maxSkids) return;
      apply(currentSkids + 1, currentCases, { vibrationMs: 8 });
    },
    decrementCases: () => apply(currentSkids, Math.max(0, currentCases - 1), { vibrationMs: 8 }),
    incrementCases: () => {
      if (casesPerSkid > 0 && currentCases >= casesPerSkid) return;
      apply(currentSkids, currentCases + 1, { vibrationMs: 8 });
    },
    completeSkid: () => apply(currentSkids + 1, 0, { vibrationMs: 15 }),
  };
}

export interface PackagingManager {
  persistManualProgress(
    runId: string,
    skidsCompleted: number,
    casesOnCurrentSkid: number,
    manualOverrideUntil?: number,
  ): void;
  persistAutomaticProgress(skidsCompleted: number, casesOnCurrentSkid: number): boolean;
  updateDrainingRun(
    runId: string,
    partial: Partial<FormValues>,
    source?: PackagingProgressSource,
  ): void;
  selectDrainingRun(runs: RunMeta[], currentRunId: string, nowMs: number): DrainingPackagingRun | null;
  casesInDrainingFreezer(entry: DrainingPackagingRun, nowMs: number): number;
  advanceDrainingRun(entry: DrainingPackagingRun, exitedCases: number): void;
}

type PackagingManagerDependencies = {
  currentRunIdRef: MutableRefObject<string>;
  autoSuppressUntilRef: MutableRefObject<number>;
  dayStateRef: MutableRefObject<DayState>;
  autoSuppressMs: number;
  loadRunValues(runId: string): FormValues;
  saveRunValues(runId: string, values: FormValues): void;
  markRunValuesUpdated(runId: string, now: number): void;
  markLocalEdit(now: number): void;
  schedulePush(dayState: DayState, delayMs: number): void;
  queueManualCorrection(runId: string, values: Record<string, number>): void;
  recordManualProgress(input: {
    runId: string;
    skidsCompleted: number;
    casesOnCurrentSkid: number;
    manualOverrideUntil: number;
    now: number;
  }): unknown;
  recordAutomaticProgress(input: {
    runId: string;
    skidsCompleted: number;
    casesOnCurrentSkid: number;
  }): unknown | null;
};

/**
 * Owns packaging progression and prior-run drain orchestration. Run lifecycle
 * finalization is deliberately outside this boundary so inventory consumption
 * continues through the server's existing atomic end-run intent.
 */
export function createPackagingManager(deps: PackagingManagerDependencies): PackagingManager {
  // Keep the persistence functions as direct identifiers so the repository's
  // AST stamp guard can verify each save and stamp in this extracted boundary.
  const { saveRunValues, markRunValuesUpdated } = deps;
  const persistManualProgress: PackagingManager["persistManualProgress"] = (
    runId,
    skidsCompleted,
    casesOnCurrentSkid,
    manualOverrideUntil = Date.now() + deps.autoSuppressMs,
  ) => {
    const now = Date.now();
    deps.recordManualProgress({
      runId,
      skidsCompleted,
      casesOnCurrentSkid,
      manualOverrideUntil,
      now,
    });
    deps.markRunValuesUpdated(runId, now);
    deps.markLocalEdit(now);
    deps.queueManualCorrection(runId, {
      skidsCompleted: Math.max(0, skidsCompleted),
      casesOnCurrentSkid: Math.max(0, casesOnCurrentSkid),
    });
    if (runId === deps.currentRunIdRef.current) {
      deps.autoSuppressUntilRef.current = Math.max(
        deps.autoSuppressUntilRef.current,
        manualOverrideUntil,
      );
    }
  };

  const persistAutomaticProgress: PackagingManager["persistAutomaticProgress"] = (
    skidsCompleted,
    casesOnCurrentSkid,
  ) => deps.recordAutomaticProgress({
    runId: deps.currentRunIdRef.current,
    skidsCompleted,
    casesOnCurrentSkid,
  }) !== null;

  const updateDrainingRun: PackagingManager["updateDrainingRun"] = (
    runId,
    partial,
    source = "manual",
  ) => {
    const values = {
      ...DEFAULT_VALUES,
      ...deps.loadRunValues(runId),
      ...partial,
    } as FormValues;
    if (partial.skidsCompleted != null || partial.casesOnCurrentSkid != null) {
      if (source === "auto") {
        const accepted = deps.recordAutomaticProgress({
          runId,
          skidsCompleted: values.skidsCompleted,
          casesOnCurrentSkid: values.casesOnCurrentSkid,
        });
        if (!accepted) return;
      } else {
        persistManualProgress(runId, values.skidsCompleted, values.casesOnCurrentSkid);
      }
    }
    saveRunValues(runId, values);
    const now = Date.now();
    markRunValuesUpdated(runId, now);
    deps.markLocalEdit(now);
    deps.schedulePush(deps.dayStateRef.current, 0);
  };

  const selectDrainingRun: PackagingManager["selectDrainingRun"] = (
    runs,
    currentRunId,
    nowMs,
  ) => {
    let selected: DrainingPackagingRun | null = null;
    for (const run of runs) {
      if (!run.endedAt || run.id === currentRunId) continue;
      const values = withTempOverrides(deps.loadRunValues(run.id));
      const freezerTime = Number(values.freezerTime) || 0;
      if (freezerTime <= 0 || nowMs >= run.endedAt + freezerTime * 60_000) continue;
      const casesPerSkid = Number(values.casesPerSkid) || 0;
      const casesNeeded = Number(values.casesNeeded) || 0;
      const casesDone =
        (Number(values.skidsCompleted) || 0) * casesPerSkid
        + (Number(values.casesOnCurrentSkid) || 0);
      if (casesNeeded > 0 && casesDone >= casesNeeded) continue;
      if (!selected?.run.endedAt || run.endedAt > selected.run.endedAt) {
        selected = { run, values };
      }
    }
    return selected;
  };

  const casesInDrainingFreezer: PackagingManager["casesInDrainingFreezer"] = (
    { run, values },
    nowMs,
  ) => {
    const subTab = run.subTab ?? "dough";
    const ppm = computeEffectiveLineSpeed({
      mode: subTab === "crusts" ? "crusts" : "dough",
      approxLineSpeed: Number(values.approxLineSpeed),
      crustsPerCycle: Number(values.crustsPerCycle),
      cycleSpeed: Number(values.cycleSpeed),
      speedAdjustment: Number(values.speedAdjustment),
    });
    return Math.max(0, Math.floor(computeCasesInFreezer({
      startedAt: run.startedAt ?? undefined,
      endedAt: run.endedAt ?? undefined,
      pausedAt: run.pausedAt ?? undefined,
      stoppages: run.stoppages,
      now: nowMs,
      ppm,
      pizzasPerCase: Number(values.pizzasPerCase) || 0,
      freezerTimeMin: Number(values.freezerTime) || 0,
    })));
  };

  const advanceDrainingRun: PackagingManager["advanceDrainingRun"] = (
    { run, values },
    exitedCases,
  ) => {
    if (exitedCases <= 0) return;
    const casesPerSkid = Number(values.casesPerSkid) || 0;
    if (casesPerSkid <= 0) return;
    const casesNeeded = Number(values.casesNeeded) || 0;
    const currentTotal =
      (Number(values.skidsCompleted) || 0) * casesPerSkid
      + (Number(values.casesOnCurrentSkid) || 0);
    const target = currentTotal + exitedCases;
    const nextTotal =
      casesNeeded > 0 ? Math.min(target, Math.max(currentTotal, casesNeeded)) : target;
    if (nextTotal === currentTotal) return;
    updateDrainingRun(run.id, {
      skidsCompleted: Math.floor(nextTotal / casesPerSkid),
      casesOnCurrentSkid: Math.round(nextTotal % casesPerSkid),
    }, "auto");
  };

  return {
    persistManualProgress,
    persistAutomaticProgress,
    updateDrainingRun,
    selectDrainingRun,
    casesInDrainingFreezer,
    advanceDrainingRun,
  };
}