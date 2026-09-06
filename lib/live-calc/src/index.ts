// Pure production-run calculation engine.
//
// Extracted from LiveRunContext.tsx (Step 2 of server-side refactor).
// This file has ZERO React dependencies — both client and server can import it.
// Pattern follows @workspace/inventory-math: narrow input interfaces, no
// app-level types imported.

import {
  computeCasesInFreezer,
  computeCasesOnLine,
} from "@workspace/inventory-math";

// ── Shared types ─────────────────────────────────────────────────────────────

export type RecipeRow = { ingredient: string; ingredientId?: string; lbs: number };

/** Stoppage record as used by the calc — subset of RunMeta.stoppages. */
export interface CalcStoppage {
  id?: string;
  type?: string;
  startedAt: number;
  endedAt?: number;
}

/** Minimal RunMeta shape needed by the calc. */
export interface CalcRunMeta {
  id?: string;
  startedAt?: number;
  endedAt?: number;
  pausedAt?: number;
  stoppages?: CalcStoppage[];
}

/**
 * Narrow subset of FormValues that the production calc actually reads.
 * Both `v` (liveValues) and `ve` (virtual/effective) are typed as this —
 * they share the same shape but carry different data (e.g. ve may overlay
 * temp overrides for freezerTime, crustsPerCycle, cycleSpeed).
 */
export interface CalcFormValues {
  approxLineSpeed: number;
  speedAdjustment: number;
  freezerTime: number | string;
  crustsPerCycle: number;
  cycleSpeed: number;
  pizzasPerCase: number;
  casesPerSkid: number;
  casesPerLayer: number;
  doughballsPerTray: number;
  crustsPerStack: number;
  doughBatchYield: number;
  crustsPerCase: number;
  casesNeeded: number;
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  traysOnLine: number;
  batchesReady: number;
  targetDoughballWeight: number;
  doughRecipe?: RecipeRow[];
  sauceBarrelLbs: number;
  sauceOzPerPizza: number;
  frontlineRecipe?: RecipeRow[];
  app1OzPerPizza: number; app1BatchLbs: number; app1Type: string; app1CheeseRecipe?: RecipeRow[];
  app2OzPerPizza: number; app2BatchLbs: number; app2Type: string; app2CheeseRecipe?: RecipeRow[];
  app3OzPerPizza: number; app3BatchLbs: number; app3Type: string; app3CheeseRecipe?: RecipeRow[];
  app4OzPerPizza: number; app4BatchLbs: number; app4Type: string; app4CheeseRecipe?: RecipeRow[];
  pep1OzPerPizza: number; pep1Sticks: number; pep1BatchLbs: number; pep1Type: string;
  pep2OzPerPizza: number; pep2Sticks: number; pep2BatchLbs: number; pep2Type: string;
  pep1Combined: boolean;
  pep1TypeB: string; pep1OzPerPizzaB: number; pep1SticksB: number; pep1BatchLbsB: number;
  pep2TypeB: string; pep2OzPerPizzaB: number; pep2SticksB: number; pep2BatchLbsB: number;
}

/** Input for the pure calc function. */
export interface CalcInput {
  /** Live / isolated form values (after isolatePendingRunPackagingProgress). */
  v: CalcFormValues;
  /** Virtual / effective form values (with temp overrides applied). */
  ve: CalcFormValues;
  /** Current run metadata (or undefined if no active run). */
  currentRun?: CalcRunMeta;
  /** Current wall-clock time in milliseconds. */
  nowTimeMs: number;
  /** "dough" or "crusts". */
  doughSubTab: string;
  /** Pepperoni types that are considered "default" (no batch needed). */
  defaultPepTypes: string[];
}

// ── Calc output type ─────────────────────────────────────────────────────────

export type Calc = {
  ppm: number;
  traysPerSkid: number;
  traysPerBatch: number;
  batchesPerSkid: number;
  casesOnLine: number;
  casesInFreezer: number;
  casesLeftToRun: number;
  casesLeftToOpen: number;
  stacksNeededTotal: number;
  casesForTiming: number;
  batchesNeeded: number;
  traysNeeded: number;
  buffer: number;
  doughShortCases: number;
  doughDepletionSec: number;
  casesOnLastSkid: number;
  timePressHzSec: number;
  timePerTraySec: number;
  timePerBatchSec: number;
  timePerSkidSec: number;
  timePerCaseSec: number;
  totalTimeSec: number;
  adjustedTimeSec: number;
  pressCasesLeft: number;
  pressDone: boolean;
  extraCases: number;
  doughMadeTimeSec: number;
  rackTimes: { trays: number; sec: number }[];
  sauceBatches: number;
  sauceDepletionSec: number;
  app1Lbs: number; app1Batches: number;
  app2Lbs: number; app2Batches: number;
  app3Lbs: number; app3Batches: number;
  app4Lbs: number; app4Batches: number;
  pep1Lbs: number; pep1Batches: number;
  pep2Lbs: number; pep2Batches: number;
  pep1LbsB: number; pep1BatchesB: number;
  pep2LbsB: number; pep2BatchesB: number;
  casesCompleted: number;
  paceStatus: "on-pace" | "ahead" | "behind" | null;
  paceDelta: number;
  catchUpPpm: number | null;
  perTray: number;
  perBatch: number;
  sauceEffBarrel: number;
};

// ── Line speed ────────────────────────────────────────────────────────────────

export type LineSpeedMode = "dough" | "crusts";

export type EffectiveLineSpeedInput = {
  mode: LineSpeedMode;
  crustsPerCycle?: number | null;
  cycleSpeed?: number | null;
  speedAdjustment?: number | null;
  approxLineSpeed?: number | null;
};

function finiteOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * Returns the single line-speed basis used by live production calculations.
 *
 * Dough runs use the cycle-derived speed adjusted by the configured multiplier.
 * Crust runs use their approximate speed directly; they do not inherit the
 * dough multiplier. Invalid or non-positive speeds are disabled rather than
 * producing NaN, Infinity, or false timers.
 */
export function computeEffectiveLineSpeed(input: EffectiveLineSpeedInput): number {
  if (input.mode === "crusts") {
    const approxPpm = finiteOrZero(input.approxLineSpeed);
    return approxPpm > 0 ? Math.round(approxPpm * 100) / 100 : 0;
  }

  const crustsPerCycle = finiteOrZero(input.crustsPerCycle);
  const cycleSpeed = finiteOrZero(input.cycleSpeed);
  const speedAdjustment = input.speedAdjustment == null || !Number.isFinite(input.speedAdjustment)
    ? 1
    : Number(input.speedAdjustment);
  const adjustedPpm = crustsPerCycle * cycleSpeed * speedAdjustment;
  return adjustedPpm > 0 ? Math.round(adjustedPpm * 100) / 100 : 0;
}

// ── Pure calculation ─────────────────────────────────────────────────────────

export function computeCalc(input: CalcInput): Calc {
  const { v, ve, currentRun, nowTimeMs, doughSubTab, defaultPepTypes } = input;

  const ppm = computeEffectiveLineSpeed({
    mode: doughSubTab === "crusts" ? "crusts" : "dough",
    approxLineSpeed: v.approxLineSpeed,
    crustsPerCycle: ve.crustsPerCycle,
    cycleSpeed: ve.cycleSpeed,
    speedAdjustment: v.speedAdjustment,
  });

  const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;

  const doughRecipeLbs = (v.doughRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const effectiveDoughBatchYield =
    doughRecipeLbs > 0 && v.targetDoughballWeight > 0
      ? (doughRecipeLbs * 16) / v.targetDoughballWeight
      : v.doughBatchYield;

  const traysPerSkid = (v.casesPerSkid * v.pizzasPerCase) / perTray;
  const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : effectiveDoughBatchYield;
  const traysPerBatch = effectiveDoughBatchYield / perTray;
  const batchesPerSkid = traysPerSkid / traysPerBatch;

  const casesOnLine = computeCasesOnLine({
    startedAt: currentRun?.startedAt,
    endedAt: currentRun?.endedAt,
    pausedAt: currentRun?.pausedAt,
    stoppages: currentRun?.stoppages,
    now: nowTimeMs,
    ppm,
    pizzasPerCase: v.pizzasPerCase,
    freezerTimeMin: Number(ve.freezerTime),
  });

  const casesInFreezer = computeCasesInFreezer({
    startedAt: currentRun?.startedAt,
    endedAt: currentRun?.endedAt,
    pausedAt: currentRun?.pausedAt,
    stoppages: currentRun?.stoppages,
    now: nowTimeMs,
    ppm,
    pizzasPerCase: v.pizzasPerCase,
    freezerTimeMin: Number(ve.freezerTime),
  });

  const casesLeftToRun =
    v.casesNeeded - v.skidsCompleted * v.casesPerSkid - v.casesOnCurrentSkid - casesOnLine + v.casesPerLayer;
  const casesForTiming =
    v.casesNeeded - v.skidsCompleted * v.casesPerSkid - v.casesOnCurrentSkid - casesOnLine;

  const totalPizzasLeft = casesLeftToRun * v.pizzasPerCase;
  const doughOnHand = v.traysOnLine * perTray + v.batchesReady * effectiveDoughBatchYield;
  const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
  const batchesNeeded = doughDeficit / effectiveDoughBatchYield;
  const traysNeeded = doughDeficit / perTray;
  const pizzasNetOfStaged = Math.max(0, totalPizzasLeft - v.traysOnLine * perTray);
  const casesLeftToOpen = v.crustsPerCase > 0 ? Math.ceil(pizzasNetOfStaged / v.crustsPerCase) : 0;
  const stacksNeededTotal = perTray > 0 ? Math.ceil(pizzasNetOfStaged / perTray) : 0;
  const buffer = Math.max(0, doughOnHand - totalPizzasLeft) / v.pizzasPerCase;
  const doughShortCases = doughDeficit / v.pizzasPerCase;
  const doughDepletionSec = ppm > 0 ? (doughOnHand / ppm) * 60 : 0;

  const casesOnLastSkid = Math.ceil(Math.max(0, v.casesPerSkid - casesOnLine));

  const timePressHzSec =
    doughSubTab !== "crusts" && ppm > 0 && ve.crustsPerCycle > 0
      ? (ve.crustsPerCycle / ppm) * 60
      : 0;
  const timePerTraySec = ppm > 0 ? (perTray / ppm) * 60 : 0;
  const timePerBatchSec = ppm > 0 ? (perBatch / ppm) * 60 : 0;
  const timePerSkidSec = ppm > 0 ? ((v.casesPerSkid * v.pizzasPerCase) / ppm) * 60 : 0;
  const timePerCaseSec = ppm > 0 ? (v.pizzasPerCase / ppm) * 60 : 0;
  const totalTimeSec = ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : 0;
  const doughMadeTimeSec =
    ppm > 0
      ? ((v.traysOnLine * perTray + v.batchesReady * effectiveDoughBatchYield) / ppm) * 60
      : 0;

  const rackTimes = [10, 12, 16, 18, 20, 22].map((n) => ({
    trays: n,
    sec: ppm > 0 ? (n * perTray * 60) / ppm : 0,
  }));

  // Frontline
  const totalPizzasRun = casesLeftToRun * v.pizzasPerCase;
  const totalPizzasForSauce = totalPizzasRun + v.casesPerLayer * v.pizzasPerCase;
  const frontlineRecipeLbs = (v.frontlineRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const sauceEffBarrel = frontlineRecipeLbs > 0 ? frontlineRecipeLbs : v.sauceBarrelLbs;
  const sauceLbs = (totalPizzasForSauce * v.sauceOzPerPizza) / 16 + 30;
  const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
  const sauceDepletionSec =
    ppm > 0 && sauceEffBarrel > 0 && v.sauceOzPerPizza > 0
      ? (sauceEffBarrel * 16 / v.sauceOzPerPizza / ppm) * 60
      : 0;

  // Applicators
  const app1RecipeLbs = (v.app1CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app1Lbs = (totalPizzasForSauce * v.app1OzPerPizza) / 16 + 20;
  const app1IsMix = v.app1Type.trim().toLowerCase().includes("mix");
  const app1EffBatch = app1RecipeLbs > 0 ? app1RecipeLbs : v.app1BatchLbs;
  const app1Batches = !app1IsMix && app1EffBatch > 0 ? app1Lbs / app1EffBatch : 0;

  const app2RecipeLbs = (v.app2CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app2Lbs = (totalPizzasForSauce * v.app2OzPerPizza) / 16 + 20;
  const app2IsMix = v.app2Type.trim().toLowerCase().includes("mix");
  const app2EffBatch = app2RecipeLbs > 0 ? app2RecipeLbs : v.app2BatchLbs;
  const app2Batches = !app2IsMix && app2EffBatch > 0 ? app2Lbs / app2EffBatch : 0;

  const app3RecipeLbs = (v.app3CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app3Lbs = (totalPizzasForSauce * v.app3OzPerPizza) / 16 + 20;
  const app3IsMix = v.app3Type.trim().toLowerCase().includes("mix");
  const app3EffBatch = app3RecipeLbs > 0 ? app3RecipeLbs : v.app3BatchLbs;
  const app3Batches = !app3IsMix && app3EffBatch > 0 ? app3Lbs / app3EffBatch : 0;

  const app4RecipeLbs = (v.app4CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app4Lbs = (totalPizzasForSauce * v.app4OzPerPizza) / 16 + 20;
  const app4IsMix = v.app4Type.trim().toLowerCase().includes("mix");
  const app4EffBatch = app4RecipeLbs > 0 ? app4RecipeLbs : v.app4BatchLbs;
  const app4Batches = !app4IsMix && app4EffBatch > 0 ? app4Lbs / app4EffBatch : 0;

  // Pepperoni
  const pepCombined = v.pep1Combined === true;
  const pepStickMult = pepCombined ? 2 : 1;
  const pep1Lbs = (totalPizzasForSauce * v.pep1OzPerPizza) / 16 + v.pep1Sticks * pepStickMult;
  const pep1Batches =
    !defaultPepTypes.includes(v.pep1Type ?? "") && v.pep1BatchLbs > 0
      ? pep1Lbs / v.pep1BatchLbs
      : 0;
  const pep1TypeBTrim = (v.pep1TypeB ?? "").trim();
  const pep1LbsB = pep1TypeBTrim
    ? (totalPizzasForSauce * (v.pep1OzPerPizzaB ?? 0)) / 16 + (v.pep1SticksB ?? 0) * pepStickMult
    : 0;
  const pep1BatchesB =
    pep1TypeBTrim && !defaultPepTypes.includes(pep1TypeBTrim) && (v.pep1BatchLbsB ?? 0) > 0
      ? pep1LbsB / (v.pep1BatchLbsB ?? 1)
      : 0;
  const pep2Lbs = pepCombined ? 0 : (totalPizzasForSauce * v.pep2OzPerPizza) / 16 + v.pep2Sticks;
  const pep2Batches =
    !pepCombined && !defaultPepTypes.includes(v.pep2Type ?? "") && v.pep2BatchLbs > 0
      ? pep2Lbs / v.pep2BatchLbs
      : 0;
  const pep2TypeBTrim = (v.pep2TypeB ?? "").trim();
  const pep2LbsB =
    !pepCombined && pep2TypeBTrim
      ? (totalPizzasForSauce * (v.pep2OzPerPizzaB ?? 0)) / 16 + (v.pep2SticksB ?? 0)
      : 0;
  const pep2BatchesB =
    !pepCombined && pep2TypeBTrim && !defaultPepTypes.includes(pep2TypeBTrim) && (v.pep2BatchLbsB ?? 0) > 0
      ? pep2LbsB / (v.pep2BatchLbsB ?? 1)
      : 0;

  // Pace
  const casesCompleted = v.skidsCompleted * v.casesPerSkid + v.casesOnCurrentSkid;
  const extraCases = Math.max(0, casesCompleted - v.casesNeeded);
  const pressCasesLeft = v.casesNeeded > 0 ? Math.max(0, v.casesNeeded - casesCompleted - casesInFreezer) : 0;
  const pressDone = v.casesNeeded > 0 && casesCompleted + casesInFreezer >= v.casesNeeded;
  const isLiveRun = !!currentRun?.startedAt && !currentRun?.endedAt;
  const adjustedTimeSec =
    ppm > 0
      ? isLiveRun && v.casesNeeded > 0
        ? (pressCasesLeft * v.pizzasPerCase * 60) / ppm
        : (casesForTiming * v.pizzasPerCase * 60) / ppm
      : totalTimeSec;

  let paceStatus: "on-pace" | "ahead" | "behind" | null = null;
  let paceDelta = 0;
  if (currentRun?.startedAt && !currentRun?.endedAt && ppm > 0 && v.pizzasPerCase > 0) {
    const refTime = currentRun.pausedAt ?? Date.now();
    const downtimeMs = (currentRun.stoppages ?? [])
      .filter(s => s.endedAt && s.type !== "pause")
      .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
    const elapsedMin = Math.max(0, refTime - currentRun.startedAt - downtimeMs) / 60000;
    const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(ve.freezerTime));
    const expectedCases = Math.floor((ppm * elapsedMinAfterTunnel) / v.pizzasPerCase);
    paceDelta = casesCompleted - expectedCases;
    if (elapsedMin >= Number(ve.freezerTime)) {
      paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
    }
  }

  let catchUpPpm: number | null = null;
  if (
    paceStatus === "behind" &&
    currentRun?.startedAt &&
    !currentRun?.endedAt &&
    ppm > 0 &&
    v.pizzasPerCase > 0 &&
    v.casesNeeded > 0
  ) {
    const refTime = currentRun.pausedAt ?? Date.now();
    const downtimeMs = (currentRun.stoppages ?? [])
      .filter(s => s.endedAt && s.type !== "pause")
      .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
    const elapsedSec = Math.max(0, refTime - currentRun.startedAt - downtimeMs) / 1000;
    const remainingCases = v.casesNeeded - casesCompleted;
    const originalTotalSec = ppm > 0 ? (v.casesNeeded * v.pizzasPerCase * 60) / ppm : 0;
    const remainingSec = Math.max(60, originalTotalSec - elapsedSec);
    if (remainingSec > 0 && remainingCases > 0) {
      catchUpPpm = Math.round((remainingCases * v.pizzasPerCase * 60) / remainingSec);
    }
  }

  return {
    ppm, traysPerSkid, traysPerBatch, batchesPerSkid, casesOnLine, casesInFreezer,
    casesLeftToRun, casesLeftToOpen, stacksNeededTotal, casesForTiming, batchesNeeded,
    traysNeeded, buffer, doughShortCases, doughDepletionSec, casesOnLastSkid,
    timePressHzSec, timePerTraySec, timePerBatchSec, timePerSkidSec, timePerCaseSec,
    totalTimeSec, adjustedTimeSec, pressCasesLeft, pressDone, extraCases, doughMadeTimeSec,
    rackTimes, sauceBatches, sauceDepletionSec,
    app1Lbs, app1Batches, app2Lbs, app2Batches, app3Lbs, app3Batches, app4Lbs, app4Batches,
    pep1Lbs, pep1Batches, pep2Lbs, pep2Batches,
    pep1LbsB, pep1BatchesB, pep2LbsB, pep2BatchesB,
    casesCompleted, paceStatus, paceDelta, catchUpPpm,
    perTray, perBatch, sauceEffBarrel,
  };
}

// ── Server-side computation ──────────────────────────────────────────────────
// Computes calc for the current run from a SyncPayload-shaped object.
// The server calls this after every sync merge and attaches the result to
// SSE broadcasts so clients can display server-computed values.

/** Minimal SyncPayload shape needed for server-side calc (untyped on server). */
export interface ServerCalcSyncPayload {
  dayState: {
    runs: CalcRunMeta[];
    currentIndex?: number;
  };
  runValues?: Record<string, Record<string, unknown>>;
  packagingProgress?: Record<string, { skidsCompleted: number; casesOnCurrentSkid: number }>;
}

export interface ServerCalcResult {
  runId: string;
  calc: Calc;
}

/**
 * Compute calc for the currently-active run from a SyncPayload.
 * Returns null if there is no valid current run or its FormValues are missing.
 */
export function computeServerCalc(
  payload: ServerCalcSyncPayload,
  defaultPepTypes: string[],
): ServerCalcResult | null {
  const { runs, currentIndex = 0 } = payload.dayState;
  const run = runs?.[currentIndex];
  if (!run?.id) return null;
  const rawValues = payload.runValues?.[run.id];
  if (!rawValues || typeof rawValues !== "object") return null;

  // The server stores raw FormValues; cast the needed fields.
  const v = rawValues as unknown as CalcFormValues;
  const packagingProgress = payload.packagingProgress?.[run.id];
  const vEffective: CalcFormValues = {
    ...v,
    skidsCompleted: packagingProgress?.skidsCompleted ?? v.skidsCompleted,
    casesOnCurrentSkid: packagingProgress?.casesOnCurrentSkid ?? v.casesOnCurrentSkid,
  };

  const doughSubTab = (run as { subTab?: string }).subTab ?? "dough";

  const calc = computeCalc({
    v: vEffective,
    ve: vEffective, // Server uses the same FormValues for both (no temp overrides stored separately)
    currentRun: run,
    nowTimeMs: Date.now(),
    doughSubTab,
    defaultPepTypes,
  });
  return { runId: run.id, calc };
}

// ── Server-side auto-track schedule (refactor step 6a) ─────────────────────
export {
  AUTO_TRACK_SCHEDULE_CHANNELS,
  computeAutoTrackElapsedMs,
  computeAutoTrackSchedule,
  type AutoTrackSchedule,
  type AutoTrackScheduleChannel,
  type AutoTrackScheduleCoordinationState,
  type AutoTrackScheduleEntry,
  type AutoTrackScheduleInput,
  type AutoTrackScheduleProgress,
} from "./autoTrackSchedule";

// ── Pure auto-track decision math (refactor step 6b foundation) ─────────────
export {
  buildAppSlotClaimMutations,
  buildCaseClaimMutations,
  buildSauceClaimMutations,
  clampWebPeriodMs,
  computeAppSlotInfo,
  computeAutoTrackSuggestion,
  computeNetSecondDue,
  getAutoTrackTiming,
  suggestedDoughStaging,
  type AppSlotInfo,
  type AppSlotKey,
  type AutoTrackSuggestion,
  type AutoTrackSuggestionInput,
  type AutoTrackTiming,
  type SuggestedDoughStagingReturn,
} from "./autoTrackEngine";
