import AsyncStorage from "@react-native-async-storage/async-storage";
import { MIX_SEED } from "@/data/mixSeed";
import {
  SPEC_BRANDS,
  SPEC_BRAND_FLAVORS,
  SPEC_PEP_TYPES,
  SPEC_CHEESE_INGREDIENTS,
  SPEC_PROFILES,
  SPEC_DIE_TYPES,
  DOUGH_RECIPES,
  DOUGH_BRAND_SPECS,
  SAUCE_RECIPES,
  SAUCE_BRAND_SPECS,
  CHEESE_RECIPES,
  CHEESE_BRAND_SPECS,
} from "@/data/specSeed";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { appStateToPayload, applyPayloadToState } from "./sync/mapping";
import {
  fetchToday,
  getApiBaseUrl,
  getOrCreateClientId,
  openSyncStream,
  putToday,
  type SyncStream,
} from "./sync/client";
import type { SyncPayload } from "./sync/payloadTypes";

const STORAGE_KEY = "run-calc-mobile-v2";
// One-time marker for seeding the imported pizza-spec brand/flavor presets.
const SPEC_SEED_KEY = "run-calc-mobile-spec-v1";
// One-time marker for backfilling die sizes onto existing brand/flavor profiles.
const DIE_SEED_KEY = "run-calc-mobile-die-v1";
// One-time marker for seeding the imported dough recipes + brand/flavor ties.
const DOUGH_SEED_KEY = "run-calc-mobile-dough-v1";
// One-time marker for seeding the imported sauce recipes + brand/flavor ties.
const SAUCE_SEED_KEY = "run-calc-mobile-sauce-v1";
// One-time marker for seeding the imported cheese recipes + brand/flavor ties.
const CHEESE_SEED_KEY = "run-calc-mobile-cheese-v1";

// Live-sync tuning. Pushes are debounced so rapid edits collapse into one PUT;
// incoming remote payloads are deferred briefly after a local edit so they don't
// clobber a field the user is actively changing.
const PUSH_DEBOUNCE_MS = 800;
const PUSH_RETRY_MS = 4000;
const EDIT_QUIET_MS = 2500;

export type SyncStatus = "connecting" | "online" | "offline";

// Deterministic JSON (sorted object keys) so the same logical payload always
// produces the same signature, used to detect real changes vs. echoes.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {});
    }
    return val;
  });
}

// One line in an ingredient recipe (e.g. { ingredient: "Flour", lbs: 100 }).
export interface RecipeRow {
  ingredient: string;
  lbs: number;
}

export interface RunSettings {
  brand: string;
  flavor: string;
  dieType: string;
  casesNeeded: number;
  pizzasPerCase: number;
  casesPerSkid: number;
  casesPerLayer: number;
  // Line speed: computed = crustsPerCycle * cycleSpeed * speedAdjustment
  // If crustsPerCycle === 0, lineSpeedPPM is used directly
  lineSpeedPPM: number;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  // Minutes pizzas spend in the freezer before they can be cased
  freezerTime: number;
  // Sauce
  sauceOzPerPizza: number;
  sauceBarrelLbs: number;
  // Applicators 1–4
  app1Type: string;
  app1OzPerPizza: number;
  app1BatchLbs: number;
  app2Type: string;
  app2OzPerPizza: number;
  app2BatchLbs: number;
  app3Type: string;
  app3OzPerPizza: number;
  app3BatchLbs: number;
  app4Type: string;
  app4OzPerPizza: number;
  app4BatchLbs: number;
  // Pepperoni 1–2
  pep1Type: string;
  pep1OzPerPizza: number;
  pep1Sticks: number;
  pep1BatchLbs: number;
  pep2Type: string;
  pep2OzPerPizza: number;
  pep2Sticks: number;
  pep2BatchLbs: number;
  // Dough
  doughBatchLbs: number;
  doughballWeightOz: number;
  // Dough/crust supply tracking
  doughballsPerTray: number;
  crustsPerStack: number;
  crustsPerCase: number;
  doughBatchYield: number;
  // Ingredient recipes. When a recipe has rows, its summed lbs override the
  // flat *BatchLbs figure as the effective batch/barrel weight.
  doughRecipeName: string;
  doughRecipe: RecipeRow[];
  app1CheeseRecipeName: string;
  app1CheeseRecipe: RecipeRow[];
  app2CheeseRecipeName: string;
  app2CheeseRecipe: RecipeRow[];
  app3CheeseRecipeName: string;
  app3CheeseRecipe: RecipeRow[];
  app4CheeseRecipeName: string;
  app4CheeseRecipe: RecipeRow[];
  frontlineRecipeName: string;
  frontlineRecipe: RecipeRow[];
  // Notes
  notes: string;
}

export interface RunProgress {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  traysOnLine: number;
  batchesReady: number;
  carryOverDone: boolean;
  subTab: "dough" | "crusts";
}

export interface Stoppage {
  id: string;
  type: "jam" | "changeover" | "break" | "other";
  startedAt: number;
  endedAt?: number;
  reason?: string;
  notes?: string;
}

export interface RunState {
  id: string;
  settings: RunSettings;
  progress: RunProgress;
  stoppages: Stoppage[];
  startedAt?: number;
  endedAt?: number;
  isRunning: boolean;
  actualCases?: number;
  wasteLbs?: number;
}

export interface RunCalc {
  casesLeft: number;
  casesLeftToRun: number;
  pizzasLeft: number;
  ppm: number;
  minutesRemaining: number | null;
  estCompletionMs: number | null;
  sauceLbs: number;
  sauceBatches: number;
  sauceEffBarrel: number;
  app1Lbs: number;
  app1Batches: number;
  app2Lbs: number;
  app2Batches: number;
  app3Lbs: number;
  app3Batches: number;
  app4Lbs: number;
  app4Batches: number;
  pep1Lbs: number;
  pep1Batches: number;
  pep2Lbs: number;
  pep2Batches: number;
  doughLbs: number;
  doughBatches: number;
  doughEffBatch: number;
  timePerBatchSec: number;
  totalDowntimeSec: number;
  netElapsedSec: number;
}

export const DEFAULT_SETTINGS: RunSettings = {
  brand: "",
  flavor: "",
  dieType: "",
  casesNeeded: 0,
  pizzasPerCase: 12,
  casesPerSkid: 48,
  casesPerLayer: 6,
  lineSpeedPPM: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  freezerTime: 15,
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  app1Type: "",
  app1OzPerPizza: 0,
  app1BatchLbs: 0,
  app2Type: "",
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3Type: "",
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4Type: "",
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Type: "",
  pep1OzPerPizza: 0,
  pep1Sticks: 0,
  pep1BatchLbs: 25,
  pep2Type: "",
  pep2OzPerPizza: 0,
  pep2Sticks: 0,
  pep2BatchLbs: 25,
  doughBatchLbs: 0,
  doughballWeightOz: 0,
  doughballsPerTray: 0,
  crustsPerStack: 0,
  crustsPerCase: 0,
  doughBatchYield: 0,
  doughRecipeName: "",
  doughRecipe: [],
  app1CheeseRecipeName: "",
  app1CheeseRecipe: [],
  app2CheeseRecipeName: "",
  app2CheeseRecipe: [],
  app3CheeseRecipeName: "",
  app3CheeseRecipe: [],
  app4CheeseRecipeName: "",
  app4CheeseRecipe: [],
  frontlineRecipeName: "",
  frontlineRecipe: [],
  notes: "",
};

// ── Master data defaults (manageable lists shared across runs) ──────────────
export const DEFAULT_PEP_TYPES = ["Pep - Cured", "Pep - Natural"];
export const DEFAULT_CHEESE_INGREDIENTS = [
  "Mozzarella", "Cheddar", "Provolone", "Swiss", "Monterey Jack", "Parmesan",
];
export const DEFAULT_DOUGH_INGREDIENTS = [
  "Flour", "Water", "Salt", "Yeast", "Oil", "Sugar",
];
export const DEFAULT_FRONTLINE_INGREDIENTS = [
  "Flour", "Water", "Salt", "Sugar", "Oil", "Yeast",
];
export const DEFAULT_STOP_REASONS = [
  "Equipment jam", "Changeover", "Break", "Maintenance",
  "Quality hold", "Staffing", "Waiting on dough",
];
export const DEFAULT_SUPERVISOR_PIN = "1234";

export const DEFAULT_PROGRESS: RunProgress = {
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  carryOverDone: false,
  subTab: "dough",
};

export function runLabel(r: RunState, index: number): string {
  const { brand, flavor } = r.settings;
  if (brand && flavor) return `${brand} – ${flavor}`;
  if (brand) return brand;
  if (flavor) return flavor;
  return `Run ${index + 1}`;
}

function makeNewRun(overrides?: Partial<RunSettings>): RunState {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    settings: { ...DEFAULT_SETTINGS, ...(overrides ?? {}) },
    progress: { ...DEFAULT_PROGRESS },
    stoppages: [],
    isRunning: false,
  };
}

// Freeze a run at a time boundary so archived history is immutable: stop the
// clock, close any open stoppages, and clear the running flag.
function closeOutRun(run: RunState, boundaryMs: number): RunState {
  return {
    ...run,
    isRunning: false,
    endedAt: run.endedAt ?? (run.startedAt != null ? boundaryMs : undefined),
    stoppages: run.stoppages.map((s) =>
      s.endedAt == null ? { ...s, endedAt: boundaryMs } : s,
    ),
  };
}

// Sum the lbs across an ingredient recipe's rows (0 when empty/missing).
export function sumRecipe(rows: RecipeRow[] | undefined): number {
  return (rows ?? []).reduce((acc, r) => acc + (Number(r.lbs) || 0), 0);
}

// How many physical 450 lb barrels to stage, given total sauce lbs and the
// weight of one mixing batch. Returns null when batching into 450 lb barrels
// doesn't apply (batch >= 450 lb, or fewer than 2 batches fit per barrel).
export function sauceBarrelBreakdown(
  sauceLbs: number,
  effBarrelLbs: number,
): { batchesPerBarrel: number; totalBarrels: number } | null {
  if (effBarrelLbs <= 0 || effBarrelLbs >= 450 || sauceLbs <= 0) return null;
  const batchesPerBarrel = Math.floor(450 / effBarrelLbs);
  if (batchesPerBarrel < 2) return null;
  const batches = sauceLbs / effBarrelLbs;
  const totalBarrels = Math.ceil(batches / batchesPerBarrel);
  return { batchesPerBarrel, totalBarrels };
}

export function computeCalc(state: RunState, nowMs: number): RunCalc {
  const { settings: s, progress: p } = state;

  const casesLeft = Math.max(
    0,
    s.casesNeeded -
      p.skidsCompleted * s.casesPerSkid -
      p.casesOnCurrentSkid,
  );
  const pizzasLeft = casesLeft * s.pizzasPerCase;

  // PPM: prefer machine params; fall back to direct entry
  const computedPPM = s.crustsPerCycle > 0 && s.cycleSpeed > 0
    ? s.crustsPerCycle * s.cycleSpeed * s.speedAdjustment
    : s.lineSpeedPPM;
  const ppm = computedPPM;

  let minutesRemaining: number | null = null;
  let estCompletionMs: number | null = null;
  if (ppm > 0) {
    minutesRemaining = pizzasLeft > 0 ? pizzasLeft / ppm : 0;
    estCompletionMs = nowMs + minutesRemaining * 60 * 1000;
  }

  // Frontline ingredients (match web computeCalc exactly): base on
  // casesLeftToRun — which nets out cases already on the line and adds a
  // casesPerLayer buffer — then add a second casesPerLayer buffer to the
  // ingredient pizza total (web doubles the layer buffer for sauce/apps/peps).
  const freezerMin = liveFreezerMin(state, nowMs);
  const casesOnLine =
    ppm > 0 && s.pizzasPerCase > 0
      ? Math.floor((ppm * freezerMin) / s.pizzasPerCase)
      : 0;
  const casesLeftToRun =
    s.casesNeeded -
    p.skidsCompleted * s.casesPerSkid -
    p.casesOnCurrentSkid -
    casesOnLine +
    s.casesPerLayer;
  const pizzasForIngredients =
    casesLeftToRun * s.pizzasPerCase + s.casesPerLayer * s.pizzasPerCase;

  // Effective batch/barrel weight: a recipe's summed lbs override the flat figure.
  const sauceEffBarrel =
    sumRecipe(s.frontlineRecipe) > 0 ? sumRecipe(s.frontlineRecipe) : s.sauceBarrelLbs;
  const app1EffBatch =
    sumRecipe(s.app1CheeseRecipe) > 0 ? sumRecipe(s.app1CheeseRecipe) : s.app1BatchLbs;
  const app2EffBatch =
    sumRecipe(s.app2CheeseRecipe) > 0 ? sumRecipe(s.app2CheeseRecipe) : s.app2BatchLbs;
  const app3EffBatch =
    sumRecipe(s.app3CheeseRecipe) > 0 ? sumRecipe(s.app3CheeseRecipe) : s.app3BatchLbs;
  const app4EffBatch =
    sumRecipe(s.app4CheeseRecipe) > 0 ? sumRecipe(s.app4CheeseRecipe) : s.app4BatchLbs;
  const doughEffBatch =
    sumRecipe(s.doughRecipe) > 0 ? sumRecipe(s.doughRecipe) : s.doughBatchLbs;

  const sauceLbs =
    s.sauceOzPerPizza > 0
      ? (pizzasForIngredients * s.sauceOzPerPizza) / 16 + 30
      : 0;
  const sauceBatches =
    sauceLbs > 0 && sauceEffBarrel > 0
      ? sauceLbs / sauceEffBarrel
      : 0;

  // Applicators whose type name contains "mix" arrive pre-made, so they need
  // no on-site batches (matches web computeSummaryStats).
  const app1IsMix = (s.app1Type ?? "").trim().toLowerCase().includes("mix");
  const app2IsMix = (s.app2Type ?? "").trim().toLowerCase().includes("mix");
  const app3IsMix = (s.app3Type ?? "").trim().toLowerCase().includes("mix");
  const app4IsMix = (s.app4Type ?? "").trim().toLowerCase().includes("mix");

  const app1Lbs =
    s.app1Type && s.app1OzPerPizza > 0
      ? (pizzasForIngredients * s.app1OzPerPizza) / 16 + 20
      : 0;
  const app1Batches =
    !app1IsMix && app1Lbs > 0 && app1EffBatch > 0
      ? app1Lbs / app1EffBatch
      : 0;

  const app2Lbs =
    s.app2Type && s.app2OzPerPizza > 0
      ? (pizzasForIngredients * s.app2OzPerPizza) / 16 + 20
      : 0;
  const app2Batches =
    !app2IsMix && app2Lbs > 0 && app2EffBatch > 0
      ? app2Lbs / app2EffBatch
      : 0;

  const app3Lbs =
    s.app3Type && s.app3OzPerPizza > 0
      ? (pizzasForIngredients * s.app3OzPerPizza) / 16 + 20
      : 0;
  const app3Batches =
    !app3IsMix && app3Lbs > 0 && app3EffBatch > 0
      ? app3Lbs / app3EffBatch
      : 0;

  const app4Lbs =
    s.app4Type && s.app4OzPerPizza > 0
      ? (pizzasForIngredients * s.app4OzPerPizza) / 16 + 20
      : 0;
  const app4Batches =
    !app4IsMix && app4Lbs > 0 && app4EffBatch > 0
      ? app4Lbs / app4EffBatch
      : 0;

  // Pepperoni: lbs = (pizzas * oz/pizza) / 16 + sticks (flat buffer).
  // Default pepperoni types ship pre-made, so they need no batches (matches web).
  const pep1Lbs =
    s.pep1Type && s.pep1OzPerPizza > 0
      ? (pizzasForIngredients * s.pep1OzPerPizza) / 16 + s.pep1Sticks
      : 0;
  const pep1Batches =
    !DEFAULT_PEP_TYPES.includes(s.pep1Type ?? "") && pep1Lbs > 0 && s.pep1BatchLbs > 0
      ? pep1Lbs / s.pep1BatchLbs
      : 0;

  const pep2Lbs =
    s.pep2Type && s.pep2OzPerPizza > 0
      ? (pizzasForIngredients * s.pep2OzPerPizza) / 16 + s.pep2Sticks
      : 0;
  const pep2Batches =
    !DEFAULT_PEP_TYPES.includes(s.pep2Type ?? "") && pep2Lbs > 0 && s.pep2BatchLbs > 0
      ? pep2Lbs / s.pep2BatchLbs
      : 0;

  // Dough
  const doughLbs =
    s.doughballWeightOz > 0
      ? (pizzasLeft * s.doughballWeightOz) / 16
      : 0;
  const doughBatches =
    doughLbs > 0 && doughEffBatch > 0 ? Math.ceil(doughLbs / doughEffBatch) : 0;

  // Time per dough batch cycle: pizzas yielded by one batch / ppm.
  const pizzasPerBatch =
    doughEffBatch > 0 && s.doughballWeightOz > 0
      ? (doughEffBatch * 16) / s.doughballWeightOz
      : 0;
  const timePerBatchSec =
    ppm > 0 && pizzasPerBatch > 0 ? (pizzasPerBatch / ppm) * 60 : 0;

  // Time boundary: a finished run's clock stops at endedAt; otherwise "now".
  const boundaryMs = state.endedAt ?? nowMs;

  // Downtime
  const completedStoppages = state.stoppages.filter((s) => s.endedAt != null);
  const activeStoppage = state.stoppages.find((s) => s.endedAt == null);
  const completedDowntimeSec = completedStoppages.reduce(
    (acc, s) => acc + (s.endedAt! - s.startedAt) / 1000,
    0,
  );
  // An open stoppage only accrues up to the run's boundary (now, or end time).
  const activeDowntimeSec = activeStoppage
    ? Math.max(0, (boundaryMs - activeStoppage.startedAt) / 1000)
    : 0;
  const totalDowntimeSec = completedDowntimeSec + activeDowntimeSec;
  const grossElapsedSec = state.startedAt
    ? Math.max(0, (boundaryMs - state.startedAt) / 1000)
    : 0;
  const netElapsedSec = Math.max(0, grossElapsedSec - totalDowntimeSec);

  return {
    casesLeft,
    casesLeftToRun,
    pizzasLeft,
    ppm,
    minutesRemaining,
    estCompletionMs,
    sauceLbs,
    sauceBatches,
    sauceEffBarrel,
    app1Lbs,
    app1Batches,
    app2Lbs,
    app2Batches,
    app3Lbs,
    app3Batches,
    app4Lbs,
    app4Batches,
    pep1Lbs,
    pep1Batches,
    pep2Lbs,
    pep2Batches,
    doughLbs,
    doughBatches,
    doughEffBatch,
    timePerBatchSec,
    totalDowntimeSec,
    netElapsedSec,
  };
}

// Minutes pizzas have been accruing in the freezer for the current run.
// 0 before start, capped at freezerTime, and frozen at endedAt once finished.
export function liveFreezerMin(state: RunState, nowMs: number): number {
  if (!state.startedAt) return 0;
  const freezerTime = state.settings.freezerTime;
  if (state.endedAt != null) return freezerTime;
  const elapsed = (nowMs - state.startedAt) / 60000;
  return Math.min(elapsed, freezerTime);
}

export type DoughSupplyMode = "dough" | "crusts";

export interface DoughSupply {
  perTray: number;
  perBatch: number;
  casesOnLine: number;
  casesLeftToRun: number;
  totalPizzasLeft: number;
  doughOnHand: number;
  doughDeficit: number;
  batchesNeeded: number;
  traysNeeded: number;
  casesLeftToOpen: number;
  stacksNeededTotal: number;
  buffer: number;
  doughShortCases: number;
}

// Dough/crust supply math — matches the web spreadsheet formulas exactly.
export function computeDoughSupply(
  state: RunState,
  nowMs: number,
  mode: DoughSupplyMode,
): DoughSupply {
  const { settings: v, progress: p } = state;

  const ppm =
    v.crustsPerCycle > 0 && v.cycleSpeed > 0
      ? v.crustsPerCycle * v.cycleSpeed * v.speedAdjustment
      : v.lineSpeedPPM;

  const perTray = mode === "crusts" ? v.crustsPerStack : v.doughballsPerTray;

  // Effective batch yield: derive from recipe when recipe + doughball weight set.
  const doughRecipeLbs = sumRecipe(v.doughRecipe);
  const effectiveDoughBatchYield =
    doughRecipeLbs > 0 && v.doughballWeightOz > 0
      ? (doughRecipeLbs * 16) / v.doughballWeightOz
      : v.doughBatchYield;
  const perBatch = effectiveDoughBatchYield;

  const freezerTime = liveFreezerMin(state, nowMs);
  const casesOnLine =
    ppm > 0 && v.pizzasPerCase > 0
      ? Math.floor((ppm * freezerTime) / v.pizzasPerCase)
      : 0;

  const casesLeftToRun =
    v.casesNeeded -
    p.skidsCompleted * v.casesPerSkid -
    p.casesOnCurrentSkid -
    casesOnLine +
    v.casesPerLayer;

  const totalPizzasLeft = casesLeftToRun * v.pizzasPerCase;
  const doughOnHand =
    p.traysOnLine * perTray + p.batchesReady * effectiveDoughBatchYield;
  const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
  const batchesNeeded =
    effectiveDoughBatchYield > 0 ? doughDeficit / effectiveDoughBatchYield : 0;
  const traysNeeded = perTray > 0 ? doughDeficit / perTray : 0;
  const pizzasNetOfStaged = Math.max(0, totalPizzasLeft - p.traysOnLine * perTray);
  const casesLeftToOpen =
    v.crustsPerCase > 0 ? Math.ceil(pizzasNetOfStaged / v.crustsPerCase) : 0;
  const stacksNeededTotal =
    perTray > 0 ? Math.ceil(pizzasNetOfStaged / perTray) : 0;
  const buffer =
    v.pizzasPerCase > 0
      ? Math.max(0, doughOnHand - totalPizzasLeft) / v.pizzasPerCase
      : 0;
  const doughShortCases =
    v.pizzasPerCase > 0 ? doughDeficit / v.pizzasPerCase : 0;

  return {
    perTray,
    perBatch,
    casesOnLine,
    casesLeftToRun,
    totalPizzasLeft,
    doughOnHand,
    doughDeficit,
    batchesNeeded,
    traysNeeded,
    casesLeftToOpen,
    stacksNeededTotal,
    buffer,
    doughShortCases,
  };
}

// Average PPM across all finished runs in history (excludes pause-type downtime).
// Returns null when there are no qualifying finished runs.
export function historicalBenchmarkPpm(history: HistoryDay[]): {
  ppm: number;
  count: number;
} | null {
  const ppms: number[] = [];
  for (const day of history) {
    for (const run of day.runs) {
      if (!run.startedAt || !run.endedAt) continue;
      const grossSec = (run.endedAt - run.startedAt) / 1000;
      const dtSec = (run.stoppages ?? [])
        .filter((s) => s.endedAt != null)
        .reduce((a, s) => a + (s.endedAt! - s.startedAt) / 1000, 0);
      const netSec = Math.max(0, grossSec - dtSec);
      if (netSec < 60) continue;
      const calc = computeCalc(run, run.endedAt);
      const planned = run.settings.casesNeeded;
      const cases = Math.max(0, planned - calc.casesLeft);
      const ppc = run.settings.pizzasPerCase;
      if (cases > 0 && ppc > 0)
        ppms.push(Math.round((cases * ppc) / (netSec / 60)));
    }
  }
  if (ppms.length === 0) return null;
  return {
    ppm: Math.round(ppms.reduce((a, b) => a + b, 0) / ppms.length),
    count: ppms.length,
  };
}

export const DEFAULT_DIE_TYPES = ["7in", "9in", "11in", "12in", "Argus", "Mystic"];

export interface RunTemplate {
  id: string;
  name: string;
  settings: RunSettings;
  createdAt: number;
}

export interface HistoryDay {
  date: string;
  runs: RunState[];
}

const MAX_TEMPLATES = 20;
const MAX_HISTORY_DAYS = 14;

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

// Saved per-product settings (brand+flavor → settings). Per-run fields like
// progress, casesNeeded, brand/flavor are stripped before saving/applying.
export type RunProfile = Partial<RunSettings>;

// One planned run for a future production day.
export interface ScheduledRun {
  id: string;
  brand: string;
  flavor: string;
  casesNeeded: number;
  dieType: string;
  notes: string;
}

interface AppState {
  runs: RunState[];
  currentIndex: number;
  shiftNotes: string;
  runToTime: string;
  date: string;
  templates: RunTemplate[];
  history: HistoryDay[];
  autoTrack: boolean;
  supervisorPin: string;
  // Manageable master-data lists
  brands: string[];
  brandFlavors: Record<string, string[]>;
  dieTypes: string[];
  pepTypes: string[];
  cheeseIngredients: string[];
  doughIngredients: string[];
  frontlineIngredients: string[];
  stopReasons: string[];
  // Per-product profiles, keyed by `${brand}__${flavor}` (lowercased/trimmed)
  brandProfiles: Record<string, RunProfile>;
  // Named recipe presets, keyed by preset name
  doughRecipePresets: Record<string, RecipeRow[]>;
  cheeseRecipePresets: Record<string, RecipeRow[]>;
  frontlineRecipePresets: Record<string, RecipeRow[]>;
  mixRecipePresets: Record<string, RecipeRow[]>;
  // Planned production keyed by date string (YYYY-MM-DD)
  scheduled: Record<string, ScheduledRun[]>;
  // Live-sync reset guard: a remote day is only accepted when its resetAt is
  // >= this. Bumped on day-rollover so a fresh day isn't overwritten by stale
  // remote state. 0 for first-ever installs so they accept any remote day.
  resetAt: number;
}

export function profileKey(brand: string, flavor: string): string {
  return `${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
}

/** Case-insensitive merge that keeps the existing label when a duplicate appears. */
function mergeInsensitive(existing: string[], additions: string[]): string[] {
  const seen = new Map<string, string>();
  for (const x of existing) seen.set(x.toLowerCase(), x);
  for (const a of additions) {
    const k = a.toLowerCase();
    if (!seen.has(k)) seen.set(k, a);
  }
  return [...seen.values()];
}

/**
 * Additively merge the imported pizza-spec presets into state: new brands,
 * flavors, pepperoni/cheese option lists, and a brand profile per brand+flavor
 * (only when absent, so user edits are never clobbered). Mirrors the web seed.
 */
function applySpecSeed(state: AppState): AppState {
  const brands = mergeInsensitive(state.brands, SPEC_BRANDS).sort();
  const brandFlavors: Record<string, string[]> = { ...state.brandFlavors };
  for (const [b, fl] of Object.entries(SPEC_BRAND_FLAVORS)) {
    brandFlavors[b] = mergeInsensitive(brandFlavors[b] ?? [], fl);
  }
  const brandProfiles: Record<string, RunProfile> = { ...state.brandProfiles };
  for (const [k, v] of Object.entries(SPEC_PROFILES)) {
    if (!brandProfiles[k]) {
      const die = SPEC_DIE_TYPES[k];
      brandProfiles[k] = die ? { ...v, dieType: die } : v;
    }
  }
  return {
    ...state,
    brands,
    brandFlavors,
    pepTypes: mergeInsensitive(state.pepTypes, SPEC_PEP_TYPES),
    cheeseIngredients: mergeInsensitive(
      state.cheeseIngredients,
      SPEC_CHEESE_INGREDIENTS,
    ),
    brandProfiles,
  };
}

/**
 * Backfill the die size onto existing brand/flavor profiles, sourced from the
 * CRUST field of the pizza spec sheets. Only fills a profile when its dieType is
 * empty, so user edits are never clobbered. Also ensures the die-type option
 * list includes any newly seeded sizes (e.g. "9in"). Mirrors the web seed.
 */
function applyDieSeed(state: AppState): AppState {
  const brandProfiles: Record<string, RunProfile> = { ...state.brandProfiles };
  for (const [k, die] of Object.entries(SPEC_DIE_TYPES)) {
    const prof = brandProfiles[k];
    if (!prof) continue;
    const cur = prof.dieType;
    if (typeof cur === "string" && cur.trim()) continue;
    brandProfiles[k] = { ...prof, dieType: die };
  }
  return {
    ...state,
    dieTypes: mergeInsensitive(state.dieTypes, DEFAULT_DIE_TYPES),
    brandProfiles,
  };
}

/**
 * Additively seed the imported dough recipes + brand/flavor ties. Tier 1 adds
 * every dough recipe to the recipe library (presets + ingredient list). Tier 2
 * ties an unambiguous brand+flavor to its dough recipe and doughball weight on
 * the brand profile — only when the profile has no dough recipe yet, so user
 * edits are never clobbered. Yield/per-tray are auto-formulated and not seeded.
 * Mirrors the web seed.
 */
function applyDoughSeed(state: AppState): AppState {
  // ── Tier 1: dough recipe library ──
  const doughRecipePresets: Record<string, RecipeRow[]> = {
    ...state.doughRecipePresets,
  };
  for (const [name, rows] of Object.entries(DOUGH_RECIPES)) {
    if (!doughRecipePresets[name]) {
      doughRecipePresets[name] = rows.map((r) => ({ ...r }));
    }
  }
  const allDoughIngredients = [
    ...new Set(
      Object.values(DOUGH_RECIPES).flatMap((rows) =>
        rows.map((r) => r.ingredient),
      ),
    ),
  ];
  const doughIngredients = mergeInsensitive(
    state.doughIngredients,
    allDoughIngredients,
  );

  // ── Tier 2: unambiguous brand → dough ties on brand profiles ──
  const brandProfiles: Record<string, RunProfile> = { ...state.brandProfiles };
  for (const spec of DOUGH_BRAND_SPECS) {
    const rows = DOUGH_RECIPES[spec.recipe];
    if (!rows) continue;
    const flavors = spec.flavor
      ? [spec.flavor]
      : (state.brandFlavors[spec.brand] ?? []);
    for (const flavor of flavors) {
      const key = profileKey(spec.brand, flavor);
      const prof = brandProfiles[key] ?? {};
      if (Array.isArray(prof.doughRecipe) && prof.doughRecipe.length > 0) {
        continue;
      }
      brandProfiles[key] = {
        ...prof,
        doughRecipeName: spec.recipe,
        doughRecipe: rows.map((r) => ({ ...r })),
        doughballWeightOz: spec.oz,
      };
    }
  }

  return { ...state, doughRecipePresets, doughIngredients, brandProfiles };
}

/**
 * Additively seed the imported sauce recipes + brand/flavor ties. The app stores
 * sauce recipes under the "frontline" recipe system (the UI labels it "Sauce
 * Recipe"). Tier 1 adds every sauce recipe to that library (presets + ingredient
 * list). Tier 2 ties an unambiguous brand+flavor to its sauce recipe on the
 * brand profile — only when the profile has no sauce recipe yet, so user edits
 * are never clobbered. Oz-per-pizza usage is not in the sheets and is not seeded.
 * Mirrors the web seed.
 */
function applySauceSeed(state: AppState): AppState {
  // ── Tier 1: sauce (frontline) recipe library ──
  const frontlineRecipePresets: Record<string, RecipeRow[]> = {
    ...state.frontlineRecipePresets,
  };
  for (const [name, rows] of Object.entries(SAUCE_RECIPES)) {
    if (!frontlineRecipePresets[name]) {
      frontlineRecipePresets[name] = rows.map((r) => ({ ...r }));
    }
  }
  const allSauceIngredients = [
    ...new Set(
      Object.values(SAUCE_RECIPES).flatMap((rows) =>
        rows.map((r) => r.ingredient),
      ),
    ),
  ];
  const frontlineIngredients = mergeInsensitive(
    state.frontlineIngredients,
    allSauceIngredients,
  );

  // ── Tier 2: unambiguous brand → sauce ties on brand profiles ──
  const brandProfiles: Record<string, RunProfile> = { ...state.brandProfiles };
  for (const spec of SAUCE_BRAND_SPECS) {
    const rows = SAUCE_RECIPES[spec.recipe];
    if (!rows) continue;
    const flavors = spec.flavor
      ? [spec.flavor]
      : (state.brandFlavors[spec.brand] ?? []);
    for (const flavor of flavors) {
      const key = profileKey(spec.brand, flavor);
      const prof = brandProfiles[key] ?? {};
      if (Array.isArray(prof.frontlineRecipe) && prof.frontlineRecipe.length > 0) {
        continue;
      }
      brandProfiles[key] = {
        ...prof,
        frontlineRecipeName: spec.recipe,
        frontlineRecipe: rows.map((r) => ({ ...r })),
      };
    }
  }

  return { ...state, frontlineRecipePresets, frontlineIngredients, brandProfiles };
}

/**
 * Additively seed the imported cheese recipes + brand/flavor ties. Tier 1 adds
 * every cheese mix to the cheese recipe library (presets + ingredient list) so
 * each mix is selectable in the App 1-4 cheese dropdowns. Tier 2 ties a
 * brand+flavor to its specific mix on the brand profile, on the cheese
 * applicator slot the sheet specifies (app 1-4) — only when that slot has no
 * cheese recipe yet, so user edits are never clobbered. Batch totals are
 * auto-summed from the recipe and are not seeded. Mirrors the web seed.
 */
function applyCheeseSeed(state: AppState): AppState {
  // ── Tier 1: cheese recipe library ──
  const cheeseRecipePresets: Record<string, RecipeRow[]> = {
    ...state.cheeseRecipePresets,
  };
  for (const [name, rows] of Object.entries(CHEESE_RECIPES)) {
    if (!cheeseRecipePresets[name]) {
      cheeseRecipePresets[name] = rows.map((r) => ({ ...r }));
    }
  }
  const allCheeseIngredients = [
    ...new Set(
      Object.values(CHEESE_RECIPES).flatMap((rows) =>
        rows.map((r) => r.ingredient),
      ),
    ),
  ];
  const cheeseIngredients = mergeInsensitive(
    state.cheeseIngredients,
    allCheeseIngredients,
  );

  // ── Tier 2: brand+flavor → cheese mix ties on brand profiles ──
  const brandProfiles: Record<string, RunProfile> = { ...state.brandProfiles };
  for (const spec of CHEESE_BRAND_SPECS) {
    const rows = CHEESE_RECIPES[spec.recipe];
    if (!rows) continue;
    const slot = spec.app >= 1 && spec.app <= 4 ? spec.app : 1;
    const nameField = `app${slot}CheeseRecipeName` as keyof RunProfile;
    const recipeField = `app${slot}CheeseRecipe` as keyof RunProfile;
    const flavors = spec.flavor
      ? [spec.flavor]
      : (state.brandFlavors[spec.brand] ?? []);
    for (const flavor of flavors) {
      const key = profileKey(spec.brand, flavor);
      const prof = brandProfiles[key] ?? {};
      const existing = prof[recipeField] as RecipeRow[] | undefined;
      if (Array.isArray(existing) && existing.length > 0) continue;
      brandProfiles[key] = {
        ...prof,
        [nameField]: spec.recipe,
        [recipeField]: rows.map((r) => ({ ...r })),
      };
    }
  }

  return { ...state, cheeseRecipePresets, cheeseIngredients, brandProfiles };
}

// Fields that belong to one specific run and must NOT travel via a profile.
const PER_RUN_FIELDS: (keyof RunSettings)[] = [
  "brand",
  "flavor",
  "casesNeeded",
  "notes",
];

export function stripPerRunFields(s: RunSettings): RunProfile {
  const out: RunProfile = { ...s };
  for (const f of PER_RUN_FIELDS) delete out[f];
  return out;
}

// Flat string master-data lists the user can manage.
export type MasterListKey =
  | "brands"
  | "dieTypes"
  | "pepTypes"
  | "cheeseIngredients"
  | "doughIngredients"
  | "frontlineIngredients"
  | "stopReasons";

export type RecipePresetKind = "dough" | "cheese" | "frontline" | "mix";

const PRESET_MAP_KEY: Record<
  RecipePresetKind,
  | "doughRecipePresets"
  | "cheeseRecipePresets"
  | "frontlineRecipePresets"
  | "mixRecipePresets"
> = {
  dough: "doughRecipePresets",
  cheese: "cheeseRecipePresets",
  frontline: "frontlineRecipePresets",
  mix: "mixRecipePresets",
};

interface RunContextValue {
  run: RunState;
  runIndex: number;
  runCount: number;
  allRuns: RunState[];
  calc: RunCalc;
  tick: number;
  activeStoppage: Stoppage | null;
  updateSettings: (partial: Partial<RunSettings>) => void;
  updateProgress: (partial: Partial<RunProgress>) => void;
  startRun: () => void;
  endRun: () => void;
  addStoppage: (type: Stoppage["type"], reason?: string, notes?: string) => void;
  endActiveStoppage: () => void;
  updateActiveStoppage: (
    partial: Partial<Pick<Stoppage, "reason" | "notes">>,
  ) => void;
  addPastStoppage: (
    type: Stoppage["type"],
    startedAt: number,
    endedAt: number,
    reason?: string,
    notes?: string,
  ) => void;
  updateRunMeta: (
    id: string,
    partial: Partial<Pick<RunState, "actualCases" | "wasteLbs">>,
  ) => void;
  applyCarryOver: (excessTrays: number, excessBatches: number) => void;
  addRun: () => void;
  switchRun: (index: number) => void;
  deleteRun: (index: number) => void;
  resetRun: () => void;
  shiftNotes: string;
  setShiftNotes: (notes: string) => void;
  templates: RunTemplate[];
  history: HistoryDay[];
  saveTemplate: (name: string) => void;
  applyTemplate: (id: string) => void;
  deleteTemplate: (id: string) => void;
  autoTrack: boolean;
  setAutoTrack: (on: boolean) => void;
  suppressAutoTrack: () => void;
  // Shift target finish time
  runToTime: string;
  setRunToTime: (t: string) => void;
  // Supervisor PIN
  supervisorPin: string;
  setSupervisorPin: (pin: string) => void;
  // Master data
  brands: string[];
  brandFlavors: Record<string, string[]>;
  dieTypes: string[];
  pepTypes: string[];
  cheeseIngredients: string[];
  doughIngredients: string[];
  frontlineIngredients: string[];
  stopReasons: string[];
  addListItem: (list: MasterListKey, value: string) => void;
  removeListItem: (list: MasterListKey, value: string) => void;
  addFlavor: (brand: string, flavor: string) => void;
  removeFlavor: (brand: string, flavor: string) => void;
  // Profiles
  brandProfiles: Record<string, RunProfile>;
  saveProfile: () => void;
  applyProfile: (brand: string, flavor: string) => boolean;
  hasProfile: (brand: string, flavor: string) => boolean;
  // Recipe presets
  doughRecipePresets: Record<string, RecipeRow[]>;
  cheeseRecipePresets: Record<string, RecipeRow[]>;
  frontlineRecipePresets: Record<string, RecipeRow[]>;
  saveRecipePreset: (kind: RecipePresetKind, name: string, rows: RecipeRow[]) => void;
  deleteRecipePreset: (kind: RecipePresetKind, name: string) => void;
  renameRecipePreset: (
    kind: RecipePresetKind,
    oldName: string,
    newName: string,
  ) => void;
  mixRecipePresets: Record<string, RecipeRow[]>;
  // Rename helpers for master data
  renameListItem: (list: MasterListKey, oldName: string, newName: string) => void;
  renameBrand: (oldName: string, newName: string) => void;
  renameFlavor: (brand: string, oldFlavor: string, newFlavor: string) => void;
  // Scheduling
  scheduled: Record<string, ScheduledRun[]>;
  addScheduledRun: (date: string, run: Omit<ScheduledRun, "id">) => void;
  updateScheduledRun: (
    date: string,
    id: string,
    patch: Partial<Omit<ScheduledRun, "id">>,
  ) => void;
  removeScheduledRun: (date: string, id: string) => void;
  clearScheduledDay: (date: string) => void;
  applyScheduledDay: (date: string) => boolean;
  // Live multi-device sync connection status.
  syncStatus: SyncStatus;
}

const RunContext = createContext<RunContextValue | null>(null);

const INITIAL_STATE: AppState = {
  runs: [makeNewRun()],
  currentIndex: 0,
  shiftNotes: "",
  runToTime: "",
  date: todayStr(),
  templates: [],
  history: [],
  autoTrack: true,
  supervisorPin: DEFAULT_SUPERVISOR_PIN,
  brands: [...MIX_SEED.brands],
  brandFlavors: { ...MIX_SEED.brandFlavors },
  dieTypes: [...DEFAULT_DIE_TYPES],
  pepTypes: [...DEFAULT_PEP_TYPES],
  cheeseIngredients: [...DEFAULT_CHEESE_INGREDIENTS],
  doughIngredients: [...DEFAULT_DOUGH_INGREDIENTS],
  frontlineIngredients: [
    ...new Set([
      ...DEFAULT_FRONTLINE_INGREDIENTS,
      ...MIX_SEED.frontlineIngredients,
    ]),
  ],
  stopReasons: [...DEFAULT_STOP_REASONS],
  brandProfiles: {},
  doughRecipePresets: {},
  cheeseRecipePresets: {},
  frontlineRecipePresets: {},
  mixRecipePresets: {},
  scheduled: {},
  resetAt: 0,
};

// Fill any missing fields (from older persisted blobs) with defaults so the
// rest of the app can assume a complete shape. Additive migration — keeps the
// `run-calc-mobile-v2` key and never drops user data.
function normalizeSettings(s: Partial<RunSettings> | undefined): RunSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    doughRecipe: s?.doughRecipe ?? [],
    app1CheeseRecipe: s?.app1CheeseRecipe ?? [],
    app2CheeseRecipe: s?.app2CheeseRecipe ?? [],
    app3CheeseRecipe: s?.app3CheeseRecipe ?? [],
    app4CheeseRecipe: s?.app4CheeseRecipe ?? [],
    frontlineRecipe: s?.frontlineRecipe ?? [],
  };
}

function normalizeRun(r: RunState): RunState {
  return {
    ...r,
    settings: normalizeSettings(r.settings),
    progress: { ...DEFAULT_PROGRESS, ...r.progress },
  };
}

function normalizeState(parsed: Partial<AppState>): Omit<AppState, "runs" | "history"> {
  return {
    currentIndex: parsed.currentIndex ?? 0,
    shiftNotes: parsed.shiftNotes ?? "",
    runToTime: parsed.runToTime ?? "",
    date: parsed.date ?? todayStr(),
    templates: parsed.templates ?? [],
    autoTrack: parsed.autoTrack ?? true,
    supervisorPin: parsed.supervisorPin ?? DEFAULT_SUPERVISOR_PIN,
    brands: parsed.brands ?? [...MIX_SEED.brands],
    brandFlavors: parsed.brandFlavors ?? { ...MIX_SEED.brandFlavors },
    dieTypes: parsed.dieTypes ?? [...DEFAULT_DIE_TYPES],
    pepTypes: parsed.pepTypes ?? [...DEFAULT_PEP_TYPES],
    cheeseIngredients: parsed.cheeseIngredients ?? [...DEFAULT_CHEESE_INGREDIENTS],
    doughIngredients: parsed.doughIngredients ?? [...DEFAULT_DOUGH_INGREDIENTS],
    frontlineIngredients:
      parsed.frontlineIngredients ?? [
        ...new Set([
          ...DEFAULT_FRONTLINE_INGREDIENTS,
          ...MIX_SEED.frontlineIngredients,
        ]),
      ],
    stopReasons: parsed.stopReasons ?? [...DEFAULT_STOP_REASONS],
    brandProfiles: parsed.brandProfiles ?? {},
    doughRecipePresets: parsed.doughRecipePresets ?? {},
    cheeseRecipePresets: parsed.cheeseRecipePresets ?? {},
    frontlineRecipePresets: parsed.frontlineRecipePresets ?? {},
    mixRecipePresets: parsed.mixRecipePresets ?? {},
    scheduled: parsed.scheduled ?? {},
    resetAt: parsed.resetAt ?? 0,
  };
}

export function RunContextProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoBucketRef = useRef<number>(-1);
  const autoSuppressRef = useRef<number>(0);

  // ── Live-sync state/refs ───────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [bootDone, setBootDone] = useState(false);
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const clientIdRef = useRef<string | null>(null);
  const lastRemoteRawRef = useRef<SyncPayload | null>(null);
  const lastSyncSigRef = useRef<string>("");
  const lastLocalEditRef = useRef<number>(0);
  const pendingRemoteRef = useRef<SyncPayload | null>(null);
  const deferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<SyncStream | null>(null);
  const syncStartedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<AppState>;
          if (parsed.runs && parsed.runs.length > 0) {
            const today = todayStr();
            const base = normalizeState(parsed);
            const history = (parsed.history ?? []).map((h) => ({
              ...h,
              runs: h.runs.map(normalizeRun),
            }));
            if (parsed.date && parsed.date !== today) {
              // Calendar day rolled over: archive the prior day's runs,
              // frozen at the prior day's end so history is immutable.
              const boundaryMs = new Date(`${today}T00:00:00`).getTime();
              const archived: HistoryDay = {
                date: parsed.date,
                runs: parsed.runs.map((r) => closeOutRun(normalizeRun(r), boundaryMs)),
              };
              const next: AppState = {
                ...base,
                runs: [makeNewRun()],
                currentIndex: 0,
                shiftNotes: "",
                date: today,
                resetAt: boundaryMs,
                history: [
                  archived,
                  ...history.filter((h) => h.date !== parsed.date),
                ].slice(0, MAX_HISTORY_DAYS),
              };
              setAppState(next);
              AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } else {
              setAppState({
                ...base,
                runs: parsed.runs.map(normalizeRun),
                history,
              });
            }
          }
        } catch {
          /* corrupt, keep defaults */
        }
      }
    })
      .finally(() => setBootDone(true));
  }, []);

  const persist = useCallback((state: AppState) => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, 400);
  }, []);

  // Persist immediately (bypassing the debounce) — used when applying remote
  // sync updates so they survive a quick reload.
  const persistNow = useCallback((state: AppState) => {
    if (saveRef.current) {
      clearTimeout(saveRef.current);
      saveRef.current = null;
    }
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, []);

  // One-time seed of the imported pizza-spec presets and dough recipes after
  // boot. Both are additive and marker-guarded so user-deleted brands/flavors/
  // profiles never reappear. They run in a SINGLE ordered flow — spec first,
  // then dough — so the dough seed never creates a dough-only profile key that
  // would make the spec seed's "only if absent" guard skip the spec fields.
  useEffect(() => {
    if (!bootDone) return;
    let cancelled = false;
    (async () => {
      const [specDone, doughDone, sauceDone, cheeseDone, dieDone] =
        await Promise.all([
          AsyncStorage.getItem(SPEC_SEED_KEY),
          AsyncStorage.getItem(DOUGH_SEED_KEY),
          AsyncStorage.getItem(SAUCE_SEED_KEY),
          AsyncStorage.getItem(CHEESE_SEED_KEY),
          AsyncStorage.getItem(DIE_SEED_KEY),
        ]);
      if (
        cancelled ||
        (specDone && doughDone && sauceDone && cheeseDone && dieDone)
      )
        return;
      setAppState((prev) => {
        let next = prev;
        if (!specDone) next = applySpecSeed(next);
        if (!doughDone) next = applyDoughSeed(next);
        if (!sauceDone) next = applySauceSeed(next);
        if (!cheeseDone) next = applyCheeseSeed(next);
        if (!dieDone) next = applyDieSeed(next);
        persistNow(next);
        return next;
      });
      if (!specDone) AsyncStorage.setItem(SPEC_SEED_KEY, "1");
      if (!doughDone) AsyncStorage.setItem(DOUGH_SEED_KEY, "1");
      if (!sauceDone) AsyncStorage.setItem(SAUCE_SEED_KEY, "1");
      if (!cheeseDone) AsyncStorage.setItem(CHEESE_SEED_KEY, "1");
      if (!dieDone) AsyncStorage.setItem(DIE_SEED_KEY, "1");
    })();
    return () => {
      cancelled = true;
    };
  }, [bootDone, persistNow]);

  // Build and PUT the current state to the server. The pushed signature is only
  // recorded AFTER a successful write, so a failed push doesn't get marked as
  // synced (which would block the change-watcher from retrying). On failure we
  // mark the stream offline and schedule a retry.
  const schedulePushRef = useRef<() => void>(() => {});
  const doPush = useCallback(() => {
    const base = getApiBaseUrl();
    const clientId = clientIdRef.current;
    if (!base || !clientId) return;
    const payload = appStateToPayload(appStateRef.current, lastRemoteRawRef.current);
    const sig = stableStringify(payload);
    putToday(base, clientId, payload)
      .then(() => {
        lastSyncSigRef.current = sig;
        setSyncStatus((s) => (s === "offline" ? "online" : s));
      })
      .catch(() => {
        setSyncStatus("offline");
        if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
        pushTimerRef.current = setTimeout(() => schedulePushRef.current(), PUSH_RETRY_MS);
      });
  }, []);

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => doPush(), PUSH_DEBOUNCE_MS);
  }, [doPush]);
  schedulePushRef.current = schedulePush;

  // Sync bootstrap: once local state has loaded, establish a clientId, pull
  // today's payload (or seed the server if empty), then subscribe to SSE.
  useEffect(() => {
    if (!bootDone) return;
    const base = getApiBaseUrl();
    if (!base) {
      setSyncStatus("offline");
      return;
    }
    let cancelled = false;

    const commitRemote = (payload: SyncPayload) => {
      setAppState((prev) => {
        const { patch } = applyPayloadToState(payload, prev);
        const next = { ...prev, ...patch };
        lastRemoteRawRef.current = payload;
        lastSyncSigRef.current = stableStringify(appStateToPayload(next, payload));
        persistNow(next);
        return next;
      });
    };

    // Defer applying a remote payload while the user is mid-edit, so a live
    // update doesn't overwrite the field they're typing in. Re-checks until the
    // edit window goes quiet, then applies the latest pending payload.
    const tryApplyPending = () => {
      if (deferTimerRef.current) {
        clearTimeout(deferTimerRef.current);
        deferTimerRef.current = null;
      }
      const since = Date.now() - lastLocalEditRef.current;
      if (since < EDIT_QUIET_MS) {
        deferTimerRef.current = setTimeout(tryApplyPending, EDIT_QUIET_MS - since + 50);
        return;
      }
      const p = pendingRemoteRef.current;
      if (p) {
        pendingRemoteRef.current = null;
        commitRemote(p);
      }
    };

    const onRemote = (payload: SyncPayload) => {
      pendingRemoteRef.current = payload;
      tryApplyPending();
    };

    (async () => {
      const clientId = await getOrCreateClientId();
      if (cancelled) return;
      clientIdRef.current = clientId;
      syncStartedRef.current = true;
      try {
        const data = await fetchToday(base);
        if (cancelled) return;
        if (data) onRemote(data);
        else doPush(); // server empty for today — seed it with our state
      } catch {
        if (!cancelled) setSyncStatus("offline");
      }
      if (cancelled) return;
      streamRef.current = openSyncStream(base, clientId, {
        onOpen: () => setSyncStatus("online"),
        onPayload: (payload, senderId) => {
          if (senderId && senderId === clientIdRef.current) return; // ignore our own echo
          onRemote(payload);
        },
        onError: () => setSyncStatus("connecting"),
      });
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      if (deferTimerRef.current) clearTimeout(deferTimerRef.current);
    };
  }, [bootDone, doPush, persistNow]);

  // Change-watcher: push local edits. The signature compare skips no-op renders
  // and echoes of just-applied remote state (whose signature was pre-recorded).
  useEffect(() => {
    if (!syncStartedRef.current) return;
    const sig = stableStringify(appStateToPayload(appState, lastRemoteRawRef.current));
    if (sig === lastSyncSigRef.current) return;
    lastLocalEditRef.current = Date.now();
    lastSyncSigRef.current = sig;
    schedulePush();
  }, [appState, schedulePush]);

  const currentRun = appState.runs[appState.currentIndex];

  useEffect(() => {
    if (currentRun?.isRunning) {
      timerRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentRun?.isRunning]);

  const updateCurrentRun = useCallback(
    (updater: (prev: RunState) => RunState) => {
      setAppState((prev) => {
        const runs = [...prev.runs];
        runs[prev.currentIndex] = updater(runs[prev.currentIndex]);
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateSettings = useCallback(
    (partial: Partial<RunSettings>) =>
      updateCurrentRun((r) => ({ ...r, settings: { ...r.settings, ...partial } })),
    [updateCurrentRun],
  );

  const updateProgress = useCallback(
    (partial: Partial<RunProgress>) =>
      updateCurrentRun((r) => ({ ...r, progress: { ...r.progress, ...partial } })),
    [updateCurrentRun],
  );

  const startRun = useCallback(
    () =>
      updateCurrentRun((r) => ({
        ...r,
        isRunning: true,
        startedAt: r.startedAt ?? Date.now(),
        endedAt: undefined,
      })),
    [updateCurrentRun],
  );

  const endRun = useCallback(
    () => updateCurrentRun((r) => ({ ...r, isRunning: false, endedAt: Date.now() })),
    [updateCurrentRun],
  );

  const addStoppage = useCallback(
    (type: Stoppage["type"], reason?: string, notes?: string) => {
      const s: Stoppage = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        type,
        startedAt: Date.now(),
        reason,
        notes,
      };
      updateCurrentRun((r) => ({ ...r, stoppages: [...r.stoppages, s] }));
    },
    [updateCurrentRun],
  );

  const endActiveStoppage = useCallback(
    () =>
      updateCurrentRun((r) => ({
        ...r,
        stoppages: r.stoppages.map((s) =>
          s.endedAt == null ? { ...s, endedAt: Date.now() } : s,
        ),
      })),
    [updateCurrentRun],
  );

  // Annotate the in-progress stoppage (reason / notes) while it is running.
  const updateActiveStoppage = useCallback(
    (partial: Partial<Pick<Stoppage, "reason" | "notes">>) =>
      updateCurrentRun((r) => ({
        ...r,
        stoppages: r.stoppages.map((s) =>
          s.endedAt == null ? { ...s, ...partial } : s,
        ),
      })),
    [updateCurrentRun],
  );

  // Log a completed stoppage with explicit start/end times (for past events).
  const addPastStoppage = useCallback(
    (
      type: Stoppage["type"],
      startedAt: number,
      endedAt: number,
      reason?: string,
      notes?: string,
    ) => {
      const s: Stoppage = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        type,
        startedAt,
        endedAt,
        reason,
        notes,
      };
      updateCurrentRun((r) => ({
        ...r,
        stoppages: [...r.stoppages, s].sort((a, b) => a.startedAt - b.startedAt),
      }));
    },
    [updateCurrentRun],
  );

  // Update post-run metadata (actual cases produced + waste lbs) on any run by id.
  const updateRunMeta = useCallback(
    (id: string, partial: Partial<Pick<RunState, "actualCases" | "wasteLbs">>) => {
      setAppState((prev) => {
        const runs = prev.runs.map((r) => (r.id === id ? { ...r, ...partial } : r));
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Carry leftover dough/crusts into the next run: add surplus trays + batches
  // to the following run's staged supply and mark this run's carry-over done.
  const applyCarryOver = useCallback(
    (excessTrays: number, excessBatches: number) => {
      setAppState((prev) => {
        const runs = [...prev.runs];
        const cur = runs[prev.currentIndex];
        if (!cur) return prev;
        runs[prev.currentIndex] = {
          ...cur,
          progress: { ...cur.progress, carryOverDone: true },
        };
        const nextIdx = prev.currentIndex + 1;
        const nextRun = runs[nextIdx];
        if (nextRun) {
          runs[nextIdx] = {
            ...nextRun,
            progress: {
              ...nextRun.progress,
              traysOnLine: nextRun.progress.traysOnLine + excessTrays,
              batchesReady: nextRun.progress.batchesReady + excessBatches,
            },
          };
        }
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addRun = useCallback(() => {
    setAppState((prev) => {
      const newRun = makeNewRun();
      const runs = [...prev.runs, newRun];
      const next = { ...prev, runs, currentIndex: runs.length - 1 };
      persist(next);
      return next;
    });
  }, [persist]);

  const switchRun = useCallback(
    (index: number) => {
      setAppState((prev) => {
        if (index < 0 || index >= prev.runs.length) return prev;
        const next = { ...prev, currentIndex: index };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const deleteRun = useCallback(
    (index: number) => {
      setAppState((prev) => {
        if (prev.runs.length <= 1) return prev;
        const runs = prev.runs.filter((_, i) => i !== index);
        const currentIndex = Math.min(prev.currentIndex, runs.length - 1);
        const next = { ...prev, runs, currentIndex };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const resetRun = useCallback(() => {
    updateCurrentRun(() => makeNewRun());
  }, [updateCurrentRun]);

  const setShiftNotes = useCallback(
    (notes: string) => {
      setAppState((prev) => {
        const next = { ...prev, shiftNotes: notes };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const saveTemplate = useCallback(
    (name: string) => {
      setAppState((prev) => {
        const cur = prev.runs[prev.currentIndex];
        const tpl: RunTemplate = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: name.trim() || `Template ${prev.templates.length + 1}`,
          settings: { ...cur.settings },
          createdAt: Date.now(),
        };
        const next = {
          ...prev,
          templates: [tpl, ...prev.templates].slice(0, MAX_TEMPLATES),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const applyTemplate = useCallback(
    (id: string) => {
      setAppState((prev) => {
        const tpl = prev.templates.find((t) => t.id === id);
        if (!tpl) return prev;
        const runs = [...prev.runs];
        runs[prev.currentIndex] = {
          ...runs[prev.currentIndex],
          settings: { ...tpl.settings },
        };
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      setAppState((prev) => {
        const next = {
          ...prev,
          templates: prev.templates.filter((t) => t.id !== id),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setAutoTrack = useCallback(
    (on: boolean) => {
      setAppState((prev) => {
        const next = { ...prev, autoTrack: on };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const suppressAutoTrack = useCallback(() => {
    autoSuppressRef.current = Date.now() + 10 * 60 * 1000;
  }, []);

  const setRunToTime = useCallback(
    (t: string) => {
      setAppState((prev) => {
        const next = { ...prev, runToTime: t };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setSupervisorPin = useCallback(
    (pin: string) => {
      setAppState((prev) => {
        const next = { ...prev, supervisorPin: pin };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addListItem = useCallback(
    (list: MasterListKey, value: string) => {
      const v = value.trim();
      if (!v) return;
      setAppState((prev) => {
        if (prev[list].includes(v)) return prev;
        const next = { ...prev, [list]: [...prev[list], v] };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeListItem = useCallback(
    (list: MasterListKey, value: string) => {
      setAppState((prev) => {
        const next = { ...prev, [list]: prev[list].filter((x) => x !== value) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addFlavor = useCallback(
    (brand: string, flavor: string) => {
      const b = brand.trim();
      const f = flavor.trim();
      if (!b || !f) return;
      setAppState((prev) => {
        const cur = prev.brandFlavors[b] ?? [];
        if (cur.includes(f)) return prev;
        const brands = prev.brands.includes(b) ? prev.brands : [...prev.brands, b];
        const next = {
          ...prev,
          brands,
          brandFlavors: { ...prev.brandFlavors, [b]: [...cur, f] },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeFlavor = useCallback(
    (brand: string, flavor: string) => {
      setAppState((prev) => {
        const cur = prev.brandFlavors[brand] ?? [];
        const next = {
          ...prev,
          brandFlavors: {
            ...prev.brandFlavors,
            [brand]: cur.filter((x) => x !== flavor),
          },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const saveProfile = useCallback(() => {
    setAppState((prev) => {
      const cur = prev.runs[prev.currentIndex];
      const brand = cur.settings.brand.trim();
      const flavor = cur.settings.flavor.trim();
      if (!brand || !flavor) return prev;
      const key = profileKey(brand, flavor);
      const brands = prev.brands.includes(brand) ? prev.brands : [...prev.brands, brand];
      const curFlavors = prev.brandFlavors[brand] ?? [];
      const brandFlavors = curFlavors.includes(flavor)
        ? prev.brandFlavors
        : { ...prev.brandFlavors, [brand]: [...curFlavors, flavor] };
      const next = {
        ...prev,
        brands,
        brandFlavors,
        brandProfiles: {
          ...prev.brandProfiles,
          [key]: stripPerRunFields(cur.settings),
        },
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const applyProfile = useCallback(
    (brand: string, flavor: string): boolean => {
      const key = profileKey(brand, flavor);
      const profile = appState.brandProfiles[key];
      if (!profile) return false;
      updateCurrentRun((r) => ({
        ...r,
        settings: { ...r.settings, ...profile, brand, flavor },
      }));
      return true;
    },
    [appState.brandProfiles, updateCurrentRun],
  );

  const hasProfile = useCallback(
    (brand: string, flavor: string): boolean =>
      !!appState.brandProfiles[profileKey(brand, flavor)],
    [appState.brandProfiles],
  );

  const saveRecipePreset = useCallback(
    (kind: RecipePresetKind, name: string, rows: RecipeRow[]) => {
      const n = name.trim();
      if (!n || rows.length === 0) return;
      setAppState((prev) => {
        const mapKey = PRESET_MAP_KEY[kind];
        const next = {
          ...prev,
          [mapKey]: {
            ...prev[mapKey],
            [n]: rows.map((r) => ({ ...r })),
          },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const deleteRecipePreset = useCallback(
    (kind: RecipePresetKind, name: string) => {
      setAppState((prev) => {
        const mapKey = PRESET_MAP_KEY[kind];
        const copy = { ...prev[mapKey] };
        delete copy[name];
        const next = { ...prev, [mapKey]: copy };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const renameRecipePreset = useCallback(
    (kind: RecipePresetKind, oldName: string, newName: string) => {
      const n = newName.trim();
      setAppState((prev) => {
        const mapKey = PRESET_MAP_KEY[kind];
        const map = prev[mapKey];
        if (!n || n === oldName || !map[oldName] || map[n]) return prev;
        const copy: Record<string, RecipeRow[]> = {};
        for (const [k, v] of Object.entries(map)) {
          copy[k === oldName ? n : k] = v;
        }
        const next = { ...prev, [mapKey]: copy };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const renameListItem = useCallback(
    (list: MasterListKey, oldName: string, newName: string) => {
      const n = newName.trim();
      setAppState((prev) => {
        if (!n || n === oldName) return prev;
        const arr = prev[list];
        if (!arr.includes(oldName) || arr.includes(n)) return prev;
        const next = {
          ...prev,
          [list]: arr.map((x) => (x === oldName ? n : x)),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const renameBrand = useCallback(
    (oldName: string, newName: string) => {
      const n = newName.trim();
      setAppState((prev) => {
        if (!n || n === oldName) return prev;
        if (!prev.brands.includes(oldName) || prev.brands.includes(n)) return prev;
        const brands = prev.brands.map((b) => (b === oldName ? n : b));
        const brandFlavors = { ...prev.brandFlavors };
        if (brandFlavors[oldName]) {
          brandFlavors[n] = brandFlavors[oldName];
          delete brandFlavors[oldName];
        }
        const flavors = brandFlavors[n] ?? [];
        const brandProfiles = { ...prev.brandProfiles };
        for (const f of flavors) {
          const oldKey = profileKey(oldName, f);
          const newKey = profileKey(n, f);
          if (oldKey !== newKey && brandProfiles[oldKey]) {
            brandProfiles[newKey] = brandProfiles[oldKey];
            delete brandProfiles[oldKey];
          }
        }
        const next = { ...prev, brands, brandFlavors, brandProfiles };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const renameFlavor = useCallback(
    (brand: string, oldFlavor: string, newFlavor: string) => {
      const f = newFlavor.trim();
      setAppState((prev) => {
        if (!f || f === oldFlavor) return prev;
        const cur = prev.brandFlavors[brand] ?? [];
        if (!cur.includes(oldFlavor) || cur.includes(f)) return prev;
        const brandFlavors = {
          ...prev.brandFlavors,
          [brand]: cur.map((x) => (x === oldFlavor ? f : x)),
        };
        const brandProfiles = { ...prev.brandProfiles };
        const oldKey = profileKey(brand, oldFlavor);
        const newKey = profileKey(brand, f);
        if (oldKey !== newKey && brandProfiles[oldKey]) {
          brandProfiles[newKey] = brandProfiles[oldKey];
          delete brandProfiles[oldKey];
        }
        const next = { ...prev, brandFlavors, brandProfiles };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addScheduledRun = useCallback(
    (date: string, run: Omit<ScheduledRun, "id">) => {
      setAppState((prev) => {
        const item: ScheduledRun = {
          ...run,
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        };
        const day = prev.scheduled[date] ?? [];
        const next = {
          ...prev,
          scheduled: { ...prev.scheduled, [date]: [...day, item] },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateScheduledRun = useCallback(
    (date: string, id: string, patch: Partial<Omit<ScheduledRun, "id">>) => {
      setAppState((prev) => {
        const day = prev.scheduled[date] ?? [];
        const next = {
          ...prev,
          scheduled: {
            ...prev.scheduled,
            [date]: day.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeScheduledRun = useCallback(
    (date: string, id: string) => {
      setAppState((prev) => {
        const day = (prev.scheduled[date] ?? []).filter((r) => r.id !== id);
        const scheduled = { ...prev.scheduled };
        if (day.length === 0) delete scheduled[date];
        else scheduled[date] = day;
        const next = { ...prev, scheduled };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clearScheduledDay = useCallback(
    (date: string) => {
      setAppState((prev) => {
        const scheduled = { ...prev.scheduled };
        delete scheduled[date];
        const next = { ...prev, scheduled };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const applyScheduledDay = useCallback(
    (date: string): boolean => {
      let applied = false;
      setAppState((prev) => {
        const day = prev.scheduled[date] ?? [];
        if (day.length === 0) return prev;
        const runs = day.map((s) => {
          const profile = prev.brandProfiles[profileKey(s.brand, s.flavor)] ?? {};
          return makeNewRun({
            ...profile,
            brand: s.brand,
            flavor: s.flavor,
            casesNeeded: s.casesNeeded,
            dieType: s.dieType || (profile.dieType ?? ""),
            notes: s.notes,
          });
        });
        applied = true;
        const next = { ...prev, runs, currentIndex: 0 };
        persist(next);
        return next;
      });
      return applied;
    },
    [persist],
  );

  // Reset the bucket marker whenever the active run changes or its running state
  // flips, so the next auto-track write fires immediately instead of being
  // blocked until the next wall-clock bucket boundary.
  useEffect(() => {
    autoBucketRef.current = -1;
  }, [currentRun?.id, currentRun?.isRunning]);

  // Auto-track: once per 5-minute bucket while running, derive skids completed
  // and cases on the current skid from expected output (net elapsed × ppm).
  // Suppressed for 10 minutes after the user manually edits either stepper, so
  // it never fights a supervisor who is taking over. Tray/batch are not auto-
  // tracked because the mobile model has no per-tray/per-batch consumption rate.
  useEffect(() => {
    if (!appState.autoTrack) return;
    const r = appState.runs[appState.currentIndex];
    if (!r?.isRunning) return;
    if (Date.now() < autoSuppressRef.current) return;
    const c = computeCalc(r, Date.now());
    if (
      c.ppm <= 0 ||
      r.settings.casesPerSkid <= 0 ||
      r.settings.pizzasPerCase <= 0
    )
      return;
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
    if (bucket === autoBucketRef.current) return;
    autoBucketRef.current = bucket;

    const expectedCases = Math.floor(
      ((c.netElapsedSec / 60) * c.ppm) / r.settings.pizzasPerCase,
    );
    const maxSkids =
      r.settings.casesNeeded > 0
        ? Math.floor(r.settings.casesNeeded / r.settings.casesPerSkid)
        : Number.MAX_SAFE_INTEGER;
    const skids = Math.min(
      maxSkids,
      Math.floor(expectedCases / r.settings.casesPerSkid),
    );
    const casesOnSkid = Math.min(
      r.settings.casesPerSkid,
      expectedCases % r.settings.casesPerSkid,
    );
    if (
      skids !== r.progress.skidsCompleted ||
      casesOnSkid !== r.progress.casesOnCurrentSkid
    ) {
      updateProgress({ skidsCompleted: skids, casesOnCurrentSkid: casesOnSkid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const activeStoppage = currentRun?.stoppages.find((s) => s.endedAt == null) ?? null;
  const calc = computeCalc(currentRun ?? makeNewRun(), Date.now());

  return (
    <RunContext.Provider
      value={{
        run: currentRun,
        runIndex: appState.currentIndex,
        runCount: appState.runs.length,
        allRuns: appState.runs,
        calc,
        tick,
        activeStoppage,
        updateSettings,
        updateProgress,
        startRun,
        endRun,
        addStoppage,
        endActiveStoppage,
        updateActiveStoppage,
        addPastStoppage,
        updateRunMeta,
        applyCarryOver,
        addRun,
        switchRun,
        deleteRun,
        resetRun,
        shiftNotes: appState.shiftNotes,
        setShiftNotes,
        templates: appState.templates,
        history: appState.history,
        saveTemplate,
        applyTemplate,
        deleteTemplate,
        autoTrack: appState.autoTrack,
        setAutoTrack,
        suppressAutoTrack,
        runToTime: appState.runToTime,
        setRunToTime,
        supervisorPin: appState.supervisorPin,
        setSupervisorPin,
        brands: appState.brands,
        brandFlavors: appState.brandFlavors,
        dieTypes: appState.dieTypes,
        pepTypes: appState.pepTypes,
        cheeseIngredients: appState.cheeseIngredients,
        doughIngredients: appState.doughIngredients,
        frontlineIngredients: appState.frontlineIngredients,
        stopReasons: appState.stopReasons,
        addListItem,
        removeListItem,
        addFlavor,
        removeFlavor,
        brandProfiles: appState.brandProfiles,
        saveProfile,
        applyProfile,
        hasProfile,
        doughRecipePresets: appState.doughRecipePresets,
        cheeseRecipePresets: appState.cheeseRecipePresets,
        frontlineRecipePresets: appState.frontlineRecipePresets,
        saveRecipePreset,
        deleteRecipePreset,
        renameRecipePreset,
        mixRecipePresets: appState.mixRecipePresets,
        renameListItem,
        renameBrand,
        renameFlavor,
        scheduled: appState.scheduled,
        addScheduledRun,
        updateScheduledRun,
        removeScheduledRun,
        clearScheduledDay,
        applyScheduledDay,
        syncStatus,
      }}
    >
      {children}
    </RunContext.Provider>
  );
}

export function useRun() {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRun must be used within RunContextProvider");
  return ctx;
}
