import {
  caseBasedProductionNeedsAvailable,
  computeCasesInFreezer,
  computeCasesOnLine,
} from "@workspace/inventory-math";

export type RecipeRow = { ingredient: string; ingredientId?: string; lbs: number };
export interface CalcStoppage {
  id?: string;
  type?: string;
  startedAt: number;
  endedAt?: number;
  /** Missing legacy values use the safe stop-tunnel policy. */
  stopTunnel?: boolean;
}
export interface CalcRunMeta {
  id?: string;
  metaUpdatedAt?: number;
  startedAt?: number;
  endedAt?: number;
  pausedAt?: number;
  stoppages?: CalcStoppage[];
}
export interface CalcFormValues {
  tempFreezerTime?: number;
  tempCrustsPerCycle?: number;
  tempCycleSpeed?: number;
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
export function applyTemporaryOverrides<T extends Partial<Record<string, unknown>>>(v: T): T {
  const freezerTime = Number(v.tempFreezerTime) || 0;
  const crustsPerCycle = Number(v.tempCrustsPerCycle) || 0;
  const cycleSpeed = Number(v.tempCycleSpeed) || 0;
  if (freezerTime <= 0 && crustsPerCycle <= 0 && cycleSpeed <= 0) return v;
  return {
    ...v,
    ...(freezerTime > 0 ? { freezerTime } : {}),
    ...(crustsPerCycle > 0 ? { crustsPerCycle } : {}),
    ...(cycleSpeed > 0 ? { cycleSpeed } : {}),
  };
}
export interface CalcInput {
  v: CalcFormValues;
  ve: CalcFormValues;
  currentRun?: CalcRunMeta;
  nowTimeMs: number;
  doughSubTab: string;
  defaultPepTypes: string[];
}
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
export function computeEffectiveLineSpeed(input: EffectiveLineSpeedInput): number {
  if (input.mode === "crusts") {
    const ppm = finiteOrZero(input.approxLineSpeed);
    return ppm > 0 ? Math.round(ppm * 100) / 100 : 0;
  }
  const adjustment = input.speedAdjustment == null || !Number.isFinite(input.speedAdjustment)
    ? 1
    : Number(input.speedAdjustment);
  const ppm = finiteOrZero(input.crustsPerCycle) * finiteOrZero(input.cycleSpeed) * adjustment;
  return ppm > 0 ? Math.round(ppm * 100) / 100 : 0;
}

function recipeLbs(rows: RecipeRow[] | undefined): number {
  return (rows ?? []).reduce((sum, row) => sum + Number(row.lbs ?? 0), 0);
}

export function computeCalc({ v, ve, currentRun, nowTimeMs, doughSubTab, defaultPepTypes }: CalcInput): Calc {
  const ppm = computeEffectiveLineSpeed({
    mode: doughSubTab === "crusts" ? "crusts" : "dough",
    approxLineSpeed: v.approxLineSpeed,
    crustsPerCycle: ve.crustsPerCycle,
    cycleSpeed: ve.cycleSpeed,
    speedAdjustment: v.speedAdjustment,
  });
  const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;
  const doughLbs = recipeLbs(v.doughRecipe);
  const effectiveDoughBatchYield = doughLbs > 0 && v.targetDoughballWeight > 0
    ? doughLbs * 16 / v.targetDoughballWeight
    : v.doughBatchYield;
  const traysPerSkid = v.casesPerSkid * v.pizzasPerCase / perTray;
  const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : effectiveDoughBatchYield;
  const traysPerBatch = effectiveDoughBatchYield / perTray;
  const batchesPerSkid = traysPerSkid / traysPerBatch;
  const occupancy = {
    startedAt: currentRun?.startedAt,
    endedAt: currentRun?.endedAt,
    pausedAt: currentRun?.pausedAt,
    stoppages: currentRun?.stoppages,
    now: nowTimeMs,
    ppm,
    pizzasPerCase: v.pizzasPerCase,
    freezerTimeMin: Number(ve.freezerTime),
  };
  const casesOnLine = computeCasesOnLine(occupancy);
  const casesInFreezer = computeCasesInFreezer(occupancy);
  const casesLeftToRun = v.casesNeeded - v.skidsCompleted * v.casesPerSkid -
    v.casesOnCurrentSkid - casesOnLine + v.casesPerLayer;
  const casesForTiming = casesLeftToRun - v.casesPerLayer;
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
  const doughDepletionSec = ppm > 0 ? doughOnHand / ppm * 60 : 0;
  const casesOnLastSkid = Math.ceil(Math.max(0, v.casesPerSkid - casesOnLine));
  const timePressHzSec = doughSubTab !== "crusts" && ppm > 0 && ve.crustsPerCycle > 0
    ? ve.crustsPerCycle / ppm * 60 : 0;
  const timePerTraySec = ppm > 0 ? perTray / ppm * 60 : 0;
  const timePerBatchSec = ppm > 0 ? perBatch / ppm * 60 : 0;
  const timePerSkidSec = ppm > 0 ? v.casesPerSkid * v.pizzasPerCase / ppm * 60 : 0;
  const timePerCaseSec = ppm > 0 ? v.pizzasPerCase / ppm * 60 : 0;
  const totalTimeSec = ppm > 0 ? casesForTiming * v.pizzasPerCase * 60 / ppm : 0;
  const doughMadeTimeSec = ppm > 0 ? doughOnHand / ppm * 60 : 0;
  const rackTimes = [10, 12, 16, 18, 20, 22].map((trays) => ({
    trays, sec: ppm > 0 ? trays * perTray * 60 / ppm : 0,
  }));
  const productionNeedsAvailable = caseBasedProductionNeedsAvailable(v);
  const totalPizzasForSauce = casesLeftToRun * v.pizzasPerCase + v.casesPerLayer * v.pizzasPerCase;
  const sauceEffBarrel = recipeLbs(v.frontlineRecipe) || v.sauceBarrelLbs;
  const sauceLbs = productionNeedsAvailable ? totalPizzasForSauce * v.sauceOzPerPizza / 16 + 30 : 0;
  const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
  const sauceDepletionSec = productionNeedsAvailable && ppm > 0 && sauceEffBarrel > 0 && v.sauceOzPerPizza > 0
    ? sauceEffBarrel * 16 / v.sauceOzPerPizza / ppm * 60 : 0;
  const app = ([1, 2, 3, 4] as const).map((slot) => {
    const prefix = `app${slot}` as const;
    const lbs = productionNeedsAvailable ? totalPizzasForSauce * v[`${prefix}OzPerPizza`] / 16 + 20 : 0;
    const effectiveBatch = recipeLbs(v[`${prefix}CheeseRecipe`]) || v[`${prefix}BatchLbs`];
    const batches = !v[`${prefix}Type`].trim().toLowerCase().includes("mix") && effectiveBatch > 0
      ? lbs / effectiveBatch : 0;
    return { lbs, batches };
  });
  const pepCombined = v.pep1Combined === true;
  const pepStickMult = pepCombined ? 2 : 1;
  const pep1Lbs = productionNeedsAvailable
    ? totalPizzasForSauce * v.pep1OzPerPizza / 16 + v.pep1Sticks * pepStickMult
    : 0;
  const pep1Batches = !defaultPepTypes.includes(v.pep1Type ?? "") && v.pep1BatchLbs > 0
    ? pep1Lbs / v.pep1BatchLbs : 0;
  const pep1TypeB = (v.pep1TypeB ?? "").trim();
  const pep1LbsB = productionNeedsAvailable && pep1TypeB
    ? totalPizzasForSauce * (v.pep1OzPerPizzaB ?? 0) / 16 + (v.pep1SticksB ?? 0) * pepStickMult : 0;
  const pep1BatchesB = pep1TypeB && !defaultPepTypes.includes(pep1TypeB) && (v.pep1BatchLbsB ?? 0) > 0
    ? pep1LbsB / (v.pep1BatchLbsB || 1) : 0;
  const pep2Lbs = !productionNeedsAvailable || pepCombined
    ? 0
    : totalPizzasForSauce * v.pep2OzPerPizza / 16 + v.pep2Sticks;
  const pep2Batches = !pepCombined && !defaultPepTypes.includes(v.pep2Type ?? "") && v.pep2BatchLbs > 0
    ? pep2Lbs / v.pep2BatchLbs : 0;
  const pep2TypeB = (v.pep2TypeB ?? "").trim();
  const pep2LbsB = productionNeedsAvailable && !pepCombined && pep2TypeB
    ? totalPizzasForSauce * (v.pep2OzPerPizzaB ?? 0) / 16 + (v.pep2SticksB ?? 0) : 0;
  const pep2BatchesB = !pepCombined && pep2TypeB && !defaultPepTypes.includes(pep2TypeB) &&
    (v.pep2BatchLbsB ?? 0) > 0 ? pep2LbsB / (v.pep2BatchLbsB || 1) : 0;
  const casesCompleted = v.skidsCompleted * v.casesPerSkid + v.casesOnCurrentSkid;
  const extraCases = Math.max(0, casesCompleted - v.casesNeeded);
  const pressCasesLeft = v.casesNeeded > 0
    ? Math.max(0, v.casesNeeded - casesCompleted - casesInFreezer) : 0;
  const pressDone = v.casesNeeded > 0 && casesCompleted + casesInFreezer >= v.casesNeeded;
  const isLiveRun = !!currentRun?.startedAt && !currentRun?.endedAt;
  const adjustedTimeSec = ppm > 0
    ? (isLiveRun && v.casesNeeded > 0 ? pressCasesLeft : casesForTiming) * v.pizzasPerCase * 60 / ppm
    : totalTimeSec;
  let paceStatus: Calc["paceStatus"] = null;
  let paceDelta = 0;
  let elapsedSec = 0;
  if (currentRun?.startedAt && !currentRun.endedAt && ppm > 0 && v.pizzasPerCase > 0) {
    const refTime = currentRun.pausedAt ?? nowTimeMs;
    const downtimeMs = (currentRun.stoppages ?? []).filter((s) => s.endedAt && s.type !== "pause")
      .reduce((sum, s) => sum + (s.endedAt! - s.startedAt), 0);
    elapsedSec = Math.max(0, refTime - currentRun.startedAt - downtimeMs) / 1000;
    const elapsedMin = elapsedSec / 60;
    const expectedCases = Math.floor(ppm * Math.max(0, elapsedMin - Number(ve.freezerTime)) / v.pizzasPerCase);
    paceDelta = casesCompleted - expectedCases;
    if (elapsedMin >= Number(ve.freezerTime)) {
      paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
    }
  }
  let catchUpPpm: number | null = null;
  if (paceStatus === "behind" && ppm > 0 && v.casesNeeded > 0) {
    const remainingCases = v.casesNeeded - casesCompleted;
    const remainingSec = Math.max(60, v.casesNeeded * v.pizzasPerCase * 60 / ppm - elapsedSec);
    if (remainingCases > 0) catchUpPpm = Math.round(remainingCases * v.pizzasPerCase * 60 / remainingSec);
  }
  return {
    ppm, traysPerSkid, traysPerBatch, batchesPerSkid, casesOnLine, casesInFreezer,
    casesLeftToRun, casesLeftToOpen, stacksNeededTotal, casesForTiming, batchesNeeded,
    traysNeeded, buffer, doughShortCases, doughDepletionSec, casesOnLastSkid,
    timePressHzSec, timePerTraySec, timePerBatchSec, timePerSkidSec, timePerCaseSec,
    totalTimeSec, adjustedTimeSec, pressCasesLeft, pressDone, extraCases, doughMadeTimeSec,
    rackTimes, sauceBatches, sauceDepletionSec,
    app1Lbs: app[0].lbs, app1Batches: app[0].batches,
    app2Lbs: app[1].lbs, app2Batches: app[1].batches,
    app3Lbs: app[2].lbs, app3Batches: app[2].batches,
    app4Lbs: app[3].lbs, app4Batches: app[3].batches,
    pep1Lbs, pep1Batches, pep2Lbs, pep2Batches, pep1LbsB, pep1BatchesB, pep2LbsB, pep2BatchesB,
    casesCompleted, paceStatus, paceDelta, catchUpPpm, perTray, perBatch, sauceEffBarrel,
  };
}

export interface ServerCalcSyncPayload {
  dayState: { runs: CalcRunMeta[]; currentIndex?: number };
  runValues?: Record<string, Record<string, unknown>>;
  packagingProgress?: Record<string, { skidsCompleted: number; casesOnCurrentSkid: number }>;
}
export interface ServerCalcResult { runId: string; calc: Calc }
export function computeServerCalc(
  payload: ServerCalcSyncPayload,
  defaultPepTypes: string[],
  nowTimeMs = Date.now(),
): ServerCalcResult | null {
  const run = payload.dayState?.runs?.[payload.dayState.currentIndex ?? 0];
  if (!run?.id) return null;
  const raw = payload.runValues?.[run.id];
  if (!raw || typeof raw !== "object") return null;
  const base = {
    approxLineSpeed: 0, speedAdjustment: 1, freezerTime: 0,
    crustsPerCycle: 0, cycleSpeed: 0, pizzasPerCase: 0, casesPerSkid: 0,
    casesPerLayer: 0, doughballsPerTray: 0, crustsPerStack: 0,
    doughBatchYield: 0, crustsPerCase: 0, casesNeeded: 0,
    skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0,
    targetDoughballWeight: 0, doughRecipe: [], sauceBarrelLbs: 0,
    sauceOzPerPizza: 0, frontlineRecipe: [],
    app1OzPerPizza: 0, app1BatchLbs: 0, app1Type: "", app1CheeseRecipe: [],
    app2OzPerPizza: 0, app2BatchLbs: 0, app2Type: "", app2CheeseRecipe: [],
    app3OzPerPizza: 0, app3BatchLbs: 0, app3Type: "", app3CheeseRecipe: [],
    app4OzPerPizza: 0, app4BatchLbs: 0, app4Type: "", app4CheeseRecipe: [],
    pep1OzPerPizza: 0, pep1Sticks: 0, pep1BatchLbs: 0, pep1Type: "",
    pep2OzPerPizza: 0, pep2Sticks: 0, pep2BatchLbs: 0, pep2Type: "",
    pep1Combined: false,
    pep1TypeB: "", pep1OzPerPizzaB: 0, pep1SticksB: 0, pep1BatchLbsB: 0,
    pep2TypeB: "", pep2OzPerPizzaB: 0, pep2SticksB: 0, pep2BatchLbsB: 0,
    ...raw,
  } as CalcFormValues;
  const progress = payload.packagingProgress?.[run.id];
  const v = { ...base, ...(progress ?? {}) };
  const ve = applyTemporaryOverrides(v);
  return {
    runId: run.id,
    calc: computeCalc({
      v, ve, currentRun: run, nowTimeMs,
      doughSubTab: (run as CalcRunMeta & { subTab?: string }).subTab ?? "dough",
      defaultPepTypes,
    }),
  };
}

export * from "./autoTrackEngine";
export * from "./autoTrackSchedule";
export * from "./wallClockEngine";
export * from "./linePhases";
export * from "./operationalRunView";
export * from "./operationalProjection";