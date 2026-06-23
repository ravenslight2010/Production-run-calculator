import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Alert,
  AppState as RNAppState,
  type AppStateStatus as RNAppStateStatus,
} from "react-native";
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
import { recipeTargets } from "@workspace/spec-import";
import type { ParsedSpecImport } from "@workspace/spec-import";
import { normalizeAllergen, type Allergen } from "@workspace/allergen";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import {
  computeRunConsumptionLines,
  consumeRunInventory,
  fetchInventory,
  mergeInventory,
  overlaySettings,
  type MergeInventoryLine,
  type IngredientSubstitution,
  type SubstitutionLogEntry,
} from "./inventoryShared";
import { describeSubstitution } from "@workspace/inventory-math";
import { useAuth } from "./auth";
import {
  buildMergeMap,
  mapName,
  mergeList,
  mergeRecipePresetMap,
  mergeSettingsObject,
  type MergeMap,
} from "./mergeIngredients";
import { collectMergeAliases } from "@workspace/merge-suggest";
import { saveMergeAliases, fetchMergedAwayNames, saveMergedAwayNames, deleteMergedAwayNames } from "./mergeSuggest";
import { saveAiCorrections } from "./aiCorrections";

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

// Used by the sandbox "Reset" action: wipe this device's locally-persisted
// day-state so that, after the server re-copies live → sandbox, the app pulls
// the fresh sandbox state from the server on the next launch instead of merging
// stale local edits back in (the live-sync merge is additive/non-clobber, so a
// reset would otherwise have no visible effect on this device). The one-time
// seed markers are left intact so the additive spec/recipe seeds don't re-run.
export async function clearLocalStateForSandboxReset(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

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
  // Packaging (single-select config — see PACKAGING_FIELDS)
  cartoned: string;
  cartonsPerCase: number;
  circles: string;
  shipper: string;
  skidStacking: string;
  gripSheets: string;
  slipSheets: string;
  // Allergen designation for the run's line (food-safety advisory)
  allergen: Allergen;
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
  extraCases: number;
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
  cartoned: "yes",
  cartonsPerCase: 0,
  circles: "none",
  shipper: "",
  skidStacking: "",
  gripSheets: "none",
  slipSheets: "no",
  allergen: "none",
  notes: "",
};

// Single-select packaging configuration fields, mirrored from the web app
// (artifacts/run-calculator/src/types.ts PACKAGING_FIELDS). circles are counted
// per pizza and shippers per case in the warehouse roll-up (grouped by value).
export const PACKAGING_FIELDS = [
  { name: "cartoned", label: "Cartoned", options: ["yes", "no"] },
  { name: "circles", label: "Circles", options: ["none", "microwave", "7in", "11in", "12in"] },
  { name: "shipper", label: "Shipper", options: ["costco", "12in", "11in", "7in", "edwardos"] },
  { name: "skidStacking", label: "Skid Stacking Style", options: ["lucia", "hannaford", "column"] },
  { name: "gripSheets", label: "Grip Sheets", options: ["none", "every other layer", "3rd and 5th"] },
  { name: "slipSheets", label: "Slip Sheets", options: ["yes", "no"] },
] as const;
export type PackagingFieldName = (typeof PACKAGING_FIELDS)[number]["name"];

// ── Master data defaults (manageable lists shared across runs) ──────────────
export const DEFAULT_PEP_TYPES = ["Pepperoni Stick", "Pepperoni Stick - NATURAL"];
// Legacy pep-type names renamed to the detailed standard names above; applied on
// every load so saved selections keep their pre-made (no-batch) calc behavior.
export const PEP_TYPE_RENAMES: Record<string, string> = {
  "Pep - Cured": "Pepperoni Stick",
  "Pep - Natural": "Pepperoni Stick - NATURAL",
};
// Near-duplicate applicator/cheese-ingredient names collapsed onto a single
// canonical spelling. Genuinely different products are intentionally NOT mapped:
// all "FR" (fire roasted) variants, the three Parmesan forms (Grated / Shredded /
// plain), mozzarella fat levels (Part Skim / Skim / Whole) and the Extra Large
// Cut. Mirrors the web map. Applied to the cheese-ingredient list and to app-type
// / recipe ingredient names on every load (idempotent, self-healing across sync).
export const INGREDIENT_RENAMES: Record<string, string> = {
  // App-type / mix names
  "Cheese Burger Cheese Mix": "Cheeseburger Cheese Mix",
  "Red Onion, Diced": "Red Onion Diced",
  "Monterey Jack Cheese": "Monterey Jack",
  "Yellow Cheddar Cheese": "Yellow Cheddar",
  // Word-order / redundant-suffix / plural variants of the same product
  "Mozzarella Part Skim": "Part Skim Mozzarella",
  "Pizella Cheese": "Pizella",
  Jalapeno: "Jalapenos",
  // Cut/prep variants collapsed onto the base ingredient (FR variants kept separate)
  "Diced Chicken": "Chicken",
  "Diced Tomatoes": "Tomatoes",
  // Cheese ingredients
  Cilanto: "Cilantro",
  "COW Romano Cheese": "Cow's Romano",
  Goat: "Goat Cheese",
  "Three Cheese Blend &": "Three Cheese Blend",
  "Chicken w": "Chicken",
  "White Fajita Blend": "White Fajita Mix",
  "Part-Skim Mozz": "Part Skim Mozzarella",
  "P/S Mozz": "Part Skim Mozzarella",
  "Skim Mozz": "Skim Mozzarella",
  // Whole mozzarella consolidation (whole milk == whole); keep Extra Large Cut separate
  "Whole Milk Mozzarella Cheese": "Whole Mozzarella",
  "Whole Milk Mozzarella": "Whole Mozzarella",
  "Whole Mozz": "Whole Mozzarella",
  // Pepper/onion strips: collapse plain + both word-order blanched -> "Blanched X Strips"
  "Green Pepper Strips Blanched": "Blanched Green Pepper Strips",
  "Green Pepper Strips": "Blanched Green Pepper Strips",
  "Red Pepper Strips Blanched": "Blanched Red Pepper Strips",
  "Red Pepper Strips": "Blanched Red Pepper Strips",
  "White Onion Strips Blanched": "Blanched White Onion Strips",
  "White Onion Strips": "Blanched White Onion Strips",
  "Yellow Pepper Strips Blanched": "Blanched Yellow Pepper Strips",
  "Yellow Pepper Strips": "Blanched Yellow Pepper Strips",
  // Red onion
  "Red Onions": "Red Onion Strips",
};
// Pep-type names recategorized as applicators — dropped from the pep-type list
// (still usable as an applicator via the cheese-ingredient list).
const RETIRED_PEP_TYPES = ["Diced Pepperoni"];
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

// Auto-deduct inventory for every open run closed by a day rollover, matching
// endRun. consume is idempotent per runId, so runs already deducted via endRun
// won't double-count.
function consumeOpenRunsForRollover(
  runs: RunState[],
  subs: IngredientSubstitution[] = [],
): void {
  for (const r of runs) {
    if (r.startedAt != null && r.endedAt == null) {
      void consumeRunInventory(
        r.id,
        computeRunConsumptionLines(overlaySettings(r.settings, subs)),
      ).catch(() => {});
    }
  }
}

// Build the fresh next-day state from the current (already-normalized) state:
// archive the prior day's runs frozen at local midnight, start a single empty
// run, and stamp resetAt (the new server-side session boundary). Shared by the
// cold-start mount path and the live (interval / foreground) rollover check so
// both stay in lockstep.
function buildNextDayState(cur: AppState, today: string): AppState {
  const boundaryMs = new Date(`${today}T00:00:00`).getTime();
  const archived: HistoryDay = {
    date: cur.date,
    runs: cur.runs.map((r) => closeOutRun(normalizeRun(r), boundaryMs)),
  };
  return {
    ...cur,
    runs: [makeNewRun()],
    currentIndex: 0,
    shiftNotes: "",
    substitutions: [],
    substitutionLog: [],
    stagedItems: {},
    date: today,
    resetAt: boundaryMs,
    history: [archived, ...cur.history.filter((h) => h.date !== cur.date)].slice(
      0,
      MAX_HISTORY_DAYS,
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

export function computeCalc(
  state: RunState,
  nowMs: number,
  subs: IngredientSubstitution[] = [],
): RunCalc {
  // Overlay today's temporary substitutions onto the recipes/types so material
  // totals reflect the swap/add/remove. Pure clone (reverts when subs cleared).
  // Default [] keeps the 2-arg call sites (history, parity test) unaffected.
  const s = subs.length > 0 ? overlaySettings(state.settings, subs) : state.settings;
  const { progress: p } = state;

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

  // Extra cases produced beyond the run target (only positive once the order is
  // met and the line keeps running). Mirrors web computeCalc.extraCases.
  const casesCompletedTotal =
    p.skidsCompleted * s.casesPerSkid + p.casesOnCurrentSkid;
  const extraCases = Math.max(0, casesCompletedTotal - s.casesNeeded);

  return {
    casesLeft,
    casesLeftToRun,
    extraCases,
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
  // True when this scheduled run was created by a multi-sheet schedule import.
  // Re-importing the planner replaces imported runs on a given date (preserving
  // manual runs). Absent ⇒ manually added run.
  imported?: boolean;
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
  // Floor Mode (big-number idle monitor) can be turned off entirely for users
  // who don't want it (manual launch + idle auto-activate both gated on this).
  floorModeEnabled: boolean;
  supervisorPin: string;
  // Manageable master-data lists
  brands: string[];
  brandFlavors: Record<string, string[]>;
  dieTypes: string[];
  pepTypes: string[];
  cheeseIngredients: string[];
  doughIngredients: string[];
  frontlineIngredients: string[];
  // Tombstones: ingredient/die names merged away. Synced so the additive list
  // union in live-sync can't resurrect a merged-away name from a stale peer.
  mergedAway: string[];
  // Today-only temporary recipe substitutions (overlay; reverts at daily reset).
  substitutions: IngredientSubstitution[];
  // Read-only timestamped trail of substitution add/clear actions (audit log
  // for shift handoffs); synced alongside substitutions, cleared at daily reset.
  substitutionLog: SubstitutionLogEntry[];
  // Warehouse staging checklist: which per-run need rows have been pulled/staged.
  // Keyed by `${runId}::${label}__${unit}` (only checked rows stored as true).
  // Synced in day-state, NOT master data; cleared at the daily reset.
  stagedItems: Record<string, boolean>;
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
  // Local-only undo trail of master-data edits (merges, adds, removes, renames).
  // Each entry holds a full pre-edit snapshot so the change can be rolled back.
  // Deliberately EXCLUDED from the sync payload (mapping.ts never reads it) — it's
  // a per-device trail, and snapshots would blow the sync size limit (web parity).
  changeHistory: MasterDataChange[];
}

export type MasterDataChangeType = "merge" | "add" | "remove" | "rename";

export type MasterDataChange = {
  id: string;
  ts: number;
  type: MasterDataChangeType;
  description: string;
  /** Full pre-edit AppState snapshot (minus changeHistory itself). */
  before: Omit<AppState, "changeHistory">;
};

const MAX_CHANGE_HISTORY = 20;

const LIST_LABELS: Record<MasterListKey, string> = {
  brands: "Brands",
  dieTypes: "Die Types",
  pepTypes: "Pep Types",
  cheeseIngredients: "Cheese Ingredients",
  doughIngredients: "Dough Ingredients",
  frontlineIngredients: "Sauce Ingredients",
  stopReasons: "Stop Reasons",
};

// The pre-edit snapshot is the whole AppState minus the change-history itself
// (so snapshots never nest). Restoring it reverts master-data lists, profiles,
// recipe presets, runs, templates and history together — the only universally-
// correct undo, since a merge/rename rewrites per-run values too (web parity).
function snapshotForHistory(state: AppState): Omit<AppState, "changeHistory"> {
  const { changeHistory: _omit, ...rest } = state;
  return rest;
}

// Append a change-history entry to `next`, snapshotting `prev` BEFORE the edit.
// If the edit was a no-op (master-data is unchanged ignoring changeHistory),
// nothing is recorded — list mutations bail on duplicates/invalid input, and a
// useless undo entry would just clutter the trail. Pure + fail-safe.
function withChangeRecord(
  prev: AppState,
  next: AppState,
  type: MasterDataChangeType,
  description: string,
): AppState {
  const before = snapshotForHistory(prev);
  const after = snapshotForHistory(next);
  if (JSON.stringify(before) === JSON.stringify(after)) return next;
  const entry: MasterDataChange = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    ts: Date.now(),
    type,
    description,
    before,
  };
  const changeHistory = [entry, ...(next.changeHistory ?? [])].slice(
    0,
    MAX_CHANGE_HISTORY,
  );
  return { ...next, changeHistory };
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

// The master lists that participate in ingredient/die merges. Only these carry
// merged-away tombstones, so only adds to these may clear the durable
// factory-wide tombstone on re-add. brands/stopReasons are excluded (web parity:
// web only clears tombstones from its mergeable add* handlers).
const MERGEABLE_LIST_KEYS = new Set<MasterListKey>([
  "dieTypes",
  "pepTypes",
  "cheeseIngredients",
  "doughIngredients",
  "frontlineIngredients",
]);

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

// A revertible snapshot of just the run list + focused index, used by the voice
// Undo path to restore the exact prior state of a structural change.
export interface RunsSnapshot {
  runs: RunState[];
  currentIndex: number;
}

interface RunContextValue {
  run: RunState;
  runIndex: number;
  runCount: number;
  allRuns: RunState[];
  updateSettings: (partial: Partial<RunSettings>) => void;
  updateProgress: (partial: Partial<RunProgress>) => void;
  // Persist skid/case progress for a SPECIFIC (possibly non-active) run by id.
  // Used by the Packaging "Finishing — Freezer Draining" panel to log product
  // still exiting the freezer for a just-ended run while a new run is active.
  updateProgressForRun: (runId: string, partial: Partial<RunProgress>) => void;
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
  // Close out the whole day and reset to a fresh next day (manual trigger of the
  // automatic midnight rollover). Irreversible — used by the voice rollover cmd.
  rolloverDay: () => void;
  addRun: () => void;
  switchRun: (index: number) => void;
  deleteRun: (index: number) => void;
  moveRun: (fromIdx: number, toIdx: number) => void;
  updateRunSettingsById: (runId: string, partial: Partial<RunSettings>) => void;
  // Capture / restore the full run list + focused index so a structural change
  // (finish run, remove run, start/end stoppage) can be cleanly reverted to its
  // exact prior state — including a removed run's ORIGINAL position. Mirrors the
  // web voice handlers' setDayState(prevDs) snapshot-restore so the mobile Undo
  // safety net reaches parity. The two ops these don't change (master data,
  // schedule, etc.) are deliberately left untouched.
  captureRunsSnapshot: () => RunsSnapshot;
  restoreRunsSnapshot: (snap: RunsSnapshot) => void;
  resetRun: () => void;
  shiftNotes: string;
  setShiftNotes: (notes: string) => void;
  // Today-only temporary recipe substitutions (overlay; reverts at daily reset).
  substitutions: IngredientSubstitution[];
  // Read-only audit trail of substitution add/clear actions for shift handoffs.
  substitutionLog: SubstitutionLogEntry[];
  addSubstitution: (sub: IngredientSubstitution) => void;
  removeSubstitution: (id: string) => void;
  clearSubstitutions: () => void;
  // Warehouse staging checklist: which per-run need rows are pulled/staged.
  // Keyed by `${runId}::${label}__${unit}`; cleared at the daily reset.
  stagedItems: Record<string, boolean>;
  toggleStagedItem: (runId: string, rowKey: string) => void;
  templates: RunTemplate[];
  history: HistoryDay[];
  saveTemplate: (name: string) => void;
  applyTemplate: (id: string) => void;
  deleteTemplate: (id: string) => void;
  autoTrack: boolean;
  setAutoTrack: (on: boolean) => void;
  floorModeEnabled: boolean;
  setFloorModeEnabled: (on: boolean) => void;
  suppressAutoTrack: () => void;
  resumeAutoTrack: () => void;
  autoSuppressUntil: number;
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
  // Apply a canonicalized Excel spec-sheet import (overwrite existing, add new).
  applySpecImport: (parsed: ParsedSpecImport) => void;
  // Rename helpers for master data
  renameListItem: (list: MasterListKey, oldName: string, newName: string) => void;
  renameBrand: (oldName: string, newName: string) => void;
  renameFlavor: (brand: string, oldFlavor: string, newFlavor: string) => void;
  // Merge ingredient names into one canonical target across all surfaces.
  mergeIngredients: (sources: string[], target: string) => Promise<void>;
  // Local-only master-data edit history + per-entry undo (rolls back to point).
  changeHistory: MasterDataChange[];
  undoMasterDataChange: (id: string) => void;
  // Scheduling
  scheduled: Record<string, ScheduledRun[]>;
  addScheduledRun: (date: string, run: Omit<ScheduledRun, "id">) => void;
  importScheduledRuns: (
    byDate: { date: string; runs: Omit<ScheduledRun, "id">[] }[],
  ) => void;
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

// Per-second "clock" values are split into their own context so that the 1s
// tick only re-renders screens that show live, time-based data (the Run
// screen, Stoppages, and Summary). Screens whose numbers depend on settings/
// progress (Sauce, Dough, Frontline, Packaging) read `run` from RunContext and
// compute their own calc snapshot, so they no longer re-render every second.
interface RunClockValue {
  calc: RunCalc;
  tick: number;
  activeStoppage: Stoppage | null;
}

const RunClockContext = createContext<RunClockValue | null>(null);

const INITIAL_STATE: AppState = {
  runs: [makeNewRun()],
  currentIndex: 0,
  shiftNotes: "",
  runToTime: "",
  date: todayStr(),
  templates: [],
  history: [],
  autoTrack: true,
  floorModeEnabled: true,
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
  mergedAway: [],
  substitutions: [],
  substitutionLog: [],
  stagedItems: {},
  stopReasons: [...DEFAULT_STOP_REASONS],
  brandProfiles: {},
  doughRecipePresets: {},
  cheeseRecipePresets: {},
  frontlineRecipePresets: {},
  mixRecipePresets: {},
  scheduled: {},
  resetAt: 0,
  changeHistory: [],
};

// Fill any missing fields (from older persisted blobs) with defaults so the
// rest of the app can assume a complete shape. Additive migration — keeps the
// `run-calc-mobile-v2` key and never drops user data.
// Rename legacy pep-type names → detailed standard names on a settings object.
// Idempotent and self-healing across loads + sync.
export function renamePepSettings<T extends Partial<RunSettings>>(s: T): T {
  const out = { ...s } as Record<string, unknown>;
  for (const k of ["pep1Type", "pep2Type"] as const) {
    const val = out[k];
    if (typeof val === "string" && PEP_TYPE_RENAMES[val]) out[k] = PEP_TYPE_RENAMES[val];
  }
  return out as T;
}

// Rename + drop retired names from a pep-type list and ensure defaults are present.
export function renamePepList(list: string[] | undefined): string[] {
  const base = list ?? [...DEFAULT_PEP_TYPES];
  const cleaned = base
    .map((t) => PEP_TYPE_RENAMES[t] ?? t)
    .filter((t) => !RETIRED_PEP_TYPES.includes(t));
  return [...new Set([...DEFAULT_PEP_TYPES, ...cleaned])].sort((a, b) => a.localeCompare(b));
}

const RECIPE_FIELDS = [
  "doughRecipe",
  "app1CheeseRecipe",
  "app2CheeseRecipe",
  "app3CheeseRecipe",
  "app4CheeseRecipe",
  "frontlineRecipe",
] as const;

// Rename near-duplicate applicator (app*Type) and recipe-ingredient names to
// their canonical spelling on a settings object. Idempotent and self-healing.
export function renameIngredientSettings<T extends Partial<RunSettings>>(s: T): T {
  const out = { ...s } as Record<string, unknown>;
  for (const k of ["app1Type", "app2Type", "app3Type", "app4Type"] as const) {
    const val = out[k];
    if (typeof val === "string" && INGREDIENT_RENAMES[val]) out[k] = INGREDIENT_RENAMES[val];
  }
  for (const k of RECIPE_FIELDS) {
    const arr = out[k];
    if (!Array.isArray(arr)) continue;
    out[k] = arr.map((row) =>
      row && typeof row === "object" && typeof (row as RecipeRow).ingredient === "string"
        ? { ...row, ingredient: INGREDIENT_RENAMES[(row as RecipeRow).ingredient] ?? (row as RecipeRow).ingredient }
        : row,
    );
  }
  return out as T;
}

// Rename near-duplicate cheese-ingredient names and drop the resulting
// duplicates (case-insensitive), preserving order.
export function renameIngredientList(list: string[] | undefined): string[] {
  const base = list ?? [...DEFAULT_CHEESE_INGREDIENTS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of base) {
    const renamed = INGREDIENT_RENAMES[t] ?? t;
    const key = renamed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(renamed);
    }
  }
  return out;
}

function normalizeSettings(s: Partial<RunSettings> | undefined): RunSettings {
  return renameIngredientSettings(
    renamePepSettings({
      ...DEFAULT_SETTINGS,
      ...(s ?? {}),
      allergen: normalizeAllergen(s?.allergen),
      doughRecipe: s?.doughRecipe ?? [],
      app1CheeseRecipe: s?.app1CheeseRecipe ?? [],
      app2CheeseRecipe: s?.app2CheeseRecipe ?? [],
      app3CheeseRecipe: s?.app3CheeseRecipe ?? [],
      app4CheeseRecipe: s?.app4CheeseRecipe ?? [],
      frontlineRecipe: s?.frontlineRecipe ?? [],
    }),
  );
}

function normalizeRun(r: RunState): RunState {
  return {
    ...r,
    settings: normalizeSettings(r.settings),
    progress: { ...DEFAULT_PROGRESS, ...r.progress },
    // A run that lost its stoppages array (older/partial persisted state or a
    // malformed remote payload) would crash every `.stoppages.map/filter/find`
    // call — including the un-catchable async sync serializer. Guarantee it here.
    stoppages: Array.isArray(r.stoppages) ? r.stoppages : [],
  };
}

function normalizeState(parsed: Partial<AppState>): Omit<AppState, "runs" | "history"> {
  return {
    currentIndex: parsed.currentIndex ?? 0,
    shiftNotes: parsed.shiftNotes ?? "",
    runToTime: parsed.runToTime ?? "",
    date: parsed.date ?? todayStr(),
    templates: (parsed.templates ?? []).map((t) =>
      t.settings
        ? { ...t, settings: renameIngredientSettings(renamePepSettings(t.settings)) }
        : t
    ),
    autoTrack: parsed.autoTrack ?? true,
    floorModeEnabled: parsed.floorModeEnabled ?? true,
    supervisorPin: parsed.supervisorPin ?? DEFAULT_SUPERVISOR_PIN,
    brands: parsed.brands ?? [...MIX_SEED.brands],
    brandFlavors: parsed.brandFlavors ?? { ...MIX_SEED.brandFlavors },
    dieTypes: parsed.dieTypes ?? [...DEFAULT_DIE_TYPES],
    pepTypes: renamePepList(parsed.pepTypes),
    cheeseIngredients: renameIngredientList(parsed.cheeseIngredients),
    doughIngredients: parsed.doughIngredients ?? [...DEFAULT_DOUGH_INGREDIENTS],
    frontlineIngredients:
      parsed.frontlineIngredients ?? [
        ...new Set([
          ...DEFAULT_FRONTLINE_INGREDIENTS,
          ...MIX_SEED.frontlineIngredients,
        ]),
      ],
    mergedAway: parsed.mergedAway ?? [],
    substitutions: parsed.substitutions ?? [],
    substitutionLog: parsed.substitutionLog ?? [],
    stagedItems: parsed.stagedItems ?? {},
    stopReasons: parsed.stopReasons ?? [...DEFAULT_STOP_REASONS],
    brandProfiles: Object.fromEntries(
      Object.entries(parsed.brandProfiles ?? {}).map(([k, v]) => [
        k,
        renameIngredientSettings(renamePepSettings(v)),
      ])
    ),
    doughRecipePresets: parsed.doughRecipePresets ?? {},
    cheeseRecipePresets: parsed.cheeseRecipePresets ?? {},
    frontlineRecipePresets: parsed.frontlineRecipePresets ?? {},
    mixRecipePresets: parsed.mixRecipePresets ?? {},
    scheduled: parsed.scheduled ?? {},
    resetAt: parsed.resetAt ?? 0,
    changeHistory: Array.isArray(parsed.changeHistory) ? parsed.changeHistory : [],
  };
}

export function RunContextProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoBucketRef = useRef<number>(-1);
  // Wall-clock ms of the last auto-track bucket write — drives the incremental
  // tray/batch decrement (duration since the last bucket).
  const autoBucketTimeMsRef = useRef<number>(0);
  const autoSuppressRef = useRef<number>(0);
  // Reactive mirror of autoSuppressRef so UI can show the "manual override active"
  // banner + a Resume now control. The ref stays the source of truth for the
  // auto-track effect (avoids stale-closure reads); this state just drives render.
  const [autoSuppressUntil, setAutoSuppressUntil] = useState(0);
  // Bumped on a short interval ONLY while a suppression window is active, so the
  // banner countdown stays fresh and the banner auto-clears at expiry on screens
  // that intentionally do not re-render every second.
  const [, setSuppressTick] = useState(0);
  // expectedCases at the last auto-track bucket — baseline for the incremental
  // skids/cases delta. -1 = "not baselined yet" (first bucket after mount/reset).
  const autoExpectedCasesRef = useRef<number>(-1);
  // Fractional tray/batch consumption carried between buckets so sub-unit
  // depletion per bucket accumulates instead of being lost to Math.floor (which
  // would freeze slow-depleting dough — especially batches — at its start value).
  const traysRemainderRef = useRef<number>(0);
  const batchesRemainderRef = useRef<number>(0);

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

  // Auth hooks read through refs so the boot/sync effects (which run with stable
  // deps) always see the latest callbacks without re-subscribing.
  const { forceSignedOut, revalidate, me } = useAuth();
  const forceSignedOutRef = useRef(forceSignedOut);
  forceSignedOutRef.current = forceSignedOut;
  // Username for the substitution activity log, read through a ref so the
  // stable add/clear callbacks always see the current signer without re-binding.
  const meUsernameRef = useRef<string | undefined>(me?.name ?? undefined);
  meUsernameRef.current = me?.name ?? undefined;
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

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
              const current: AppState = {
                ...base,
                runs: parsed.runs.map(normalizeRun),
                history,
              };
              consumeOpenRunsForRollover(current.runs, current.substitutions ?? []);
              const next = buildNextDayState(current, today);
              setAppState(next);
              AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              // The new day's resetAt (pushed to the server by the sync stream
              // below) becomes the session boundary, so the daily reset signs
              // everyone out. Drop to the login screen now instead of waiting for
              // the next 401 — forceSignedOut keeps the token so the rollover's
              // own push can still authenticate and set the boundary.
              forceSignedOutRef.current();
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

  // Live day-rollover detection (web parity). The mount effect above only catches
  // a rollover on a cold start; a tablet left open — or merely backgrounded —
  // across midnight would otherwise never reset (prior day's run lingers and no
  // new resetAt is pushed, so the server never fences the stale session). Mirror
  // web's setInterval + visibilitychange by re-checking every minute and whenever
  // the app returns to the foreground.
  useEffect(() => {
    if (!bootDone) return;
    function checkDateRollover() {
      const cur = appStateRef.current;
      const today = todayStr();
      if (!cur.date || cur.date === today) return;
      consumeOpenRunsForRollover(cur.runs, cur.substitutions ?? []);
      const next = buildNextDayState(cur, today);
      setAppState(next);
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // The new resetAt is pushed by the change-watcher below, becoming the
      // server-side session boundary, so the daily reset signs everyone out.
      // Drop to the login screen now; forceSignedOut keeps the token so the
      // rollover's own push can still authenticate and set the boundary.
      forceSignedOutRef.current();
    }
    const interval = setInterval(checkDateRollover, 60_000);
    const sub = RNAppState.addEventListener(
      "change",
      (status: RNAppStateStatus) => {
        if (status === "active") checkDateRollover();
      },
    );
    checkDateRollover();
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [bootDone]);

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
    // Never push a stale-dated day into today's sync row (web parity). If the
    // app sits open across midnight, appState still holds yesterday's runs until
    // the rollover fires; pushing them to /api/sync/today (server resolves
    // "today" by its own clock) would leak yesterday's runs into today's row and
    // defeat the daily reset. Skip until the rollover swaps in the fresh day.
    if (appStateRef.current.date && appStateRef.current.date !== todayStr()) return;
    let payload: SyncPayload;
    let sig: string;
    try {
      payload = appStateToPayload(appStateRef.current, lastRemoteRawRef.current);
      sig = stableStringify(payload);
    } catch {
      // Runs in a setTimeout, so a throw here is uncaught and would crash the
      // whole app. Sync is best-effort — degrade to offline instead.
      setSyncStatus("offline");
      return;
    }
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
        try {
          const { patch } = applyPayloadToState(payload, prev);
          const next = { ...prev, ...patch };
          lastRemoteRawRef.current = payload;
          lastSyncSigRef.current = stableStringify(appStateToPayload(next, payload));
          persistNow(next);
          return next;
        } catch {
          // A malformed remote payload (arriving via the SSE callback) must not
          // crash the app — keep local state and stay usable.
          return prev;
        }
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

      // ── Durable merged-away tombstone (once on sync init) ──
      // The per-day sync blob can't carry a merge across a day boundary: a new
      // day's row starts empty and whichever device seeds it wins. So on init we
      // fetch the factory-wide durable tombstone, union it into local mergedAway,
      // and strip those names from every master list. Makes a merge stick across
      // days and across a device that was offline during the merge. Best-effort
      // and fail-safe (this runs in an async path the ErrorBoundary can't catch).
      try {
        const remoteNames = await fetchMergedAwayNames();
        if (!cancelled && remoteNames.length > 0) {
          setAppState((prev) => {
            const mergedAway = [...new Set([...(prev.mergedAway ?? []), ...remoteNames])];
            const tomb = new Set(mergedAway.map((n) => String(n).trim().toLowerCase()));
            const drop = (xs: string[]) => xs.filter((x) => !tomb.has(x.trim().toLowerCase()));
            const next: AppState = {
              ...prev,
              mergedAway,
              pepTypes: drop(prev.pepTypes ?? []),
              dieTypes: drop(prev.dieTypes ?? []),
              cheeseIngredients: drop(prev.cheeseIngredients ?? []),
              doughIngredients: drop(prev.doughIngredients ?? []),
              frontlineIngredients: drop(prev.frontlineIngredients ?? []),
            };
            persistNow(next);
            return next;
          });
        }
      } catch {
        // offline / server error — local + sync tombstones still apply.
      }
      if (cancelled) return;
      streamRef.current = openSyncStream(base, clientId, {
        onOpen: () => setSyncStatus("online"),
        onPayload: (payload, senderId) => {
          if (senderId && senderId === clientIdRef.current) return; // ignore our own echo
          onRemote(payload);
        },
        onError: () => {
          setSyncStatus("connecting");
          // The SSE polyfill can't surface the HTTP status, so a drop may be the
          // daily reset signing us out. Re-check /me; if the session is gone we
          // land on login.
          void revalidateRef.current();
        },
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
    let sig: string;
    try {
      sig = stableStringify(appStateToPayload(appState, lastRemoteRawRef.current));
    } catch {
      return;
    }
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

  // Write progress to a run identified by id (mirrors updateRunSettingsById).
  // Lets the Packaging draining panel log skids/cases for the just-ended run
  // without switching the active run. Persists + syncs through the same path.
  const updateProgressForRun = useCallback(
    (runId: string, partial: Partial<RunProgress>) => {
      setAppState((prev) => {
        const idx = prev.runs.findIndex((r) => r.id === runId);
        if (idx < 0) return prev;
        const runs = [...prev.runs];
        runs[idx] = { ...runs[idx], progress: { ...runs[idx].progress, ...partial } };
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const startRun = useCallback(
    () =>
      setAppState((prev) => {
        const now = Date.now();
        // Starting a run stops any other run that is currently running. Finalize
        // each like an explicit endRun: deduct its own inventory (idempotent per
        // runId, from its own settings) before clearing its running flag.
        prev.runs.forEach((r, i) => {
          if (i !== prev.currentIndex && r.startedAt != null && r.endedAt == null) {
            void consumeRunInventory(
              r.id,
              computeRunConsumptionLines(overlaySettings(r.settings, prev.substitutions ?? [])),
            ).catch(() => {});
          }
        });
        const runs = prev.runs.map((r, i) =>
          i === prev.currentIndex
            ? { ...r, isRunning: true, startedAt: r.startedAt ?? now, endedAt: undefined }
            : r.startedAt != null && r.endedAt == null
              ? { ...r, isRunning: false, endedAt: now }
              : r,
        );
        const next = { ...prev, runs };
        persist(next);
        return next;
      }),
    [persist],
  );

  const endRun = useCallback(
    () =>
      updateCurrentRun((r) => {
        // Auto-deduct this run's planned usage from inventory (idempotent by
        // run id; no-op for unknown item keys / when sync is disabled). Overlay
        // today's substitutions so the substitute is drawn down, not the short item.
        void consumeRunInventory(
          r.id,
          computeRunConsumptionLines(overlaySettings(r.settings, appStateRef.current.substitutions ?? [])),
        ).catch(() => {});
        return { ...r, isRunning: false, endedAt: Date.now() };
      }),
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

  // Manually trigger the same day close-out the automatic midnight rollover
  // performs: auto-deduct inventory for open runs, freeze them at now, archive
  // the day to history, reset to a fresh day, and push the new resetAt session
  // boundary (which signs other devices out). Irreversible by design — exposed
  // to voice as a manager-only command. Mirrors web's voice rollover handler.
  const rolloverDay = useCallback(() => {
    const cur = appStateRef.current;
    consumeOpenRunsForRollover(cur.runs, cur.substitutions ?? []);
    const now = Date.now();
    const archived: HistoryDay = {
      date: cur.date,
      runs: cur.runs.map((r) => closeOutRun(normalizeRun(r), now)),
    };
    const next: AppState = {
      ...cur,
      runs: [makeNewRun()],
      currentIndex: 0,
      shiftNotes: "",
      substitutions: [],
      substitutionLog: [],
      stagedItems: {},
      date: todayStr(),
      resetAt: now,
      history: [archived, ...cur.history.filter((h) => h.date !== cur.date)].slice(
        0,
        MAX_HISTORY_DAYS,
      ),
    };
    setAppState(next);
    persistNow(next);
    forceSignedOutRef.current();
  }, [persistNow]);

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

  // Reorder runs, keeping currentIndex pointed at the same run after the move.
  // Mirrors the web moveRun so AI "reorder run" actions apply at parity.
  const moveRun = useCallback(
    (fromIdx: number, toIdx: number) => {
      setAppState((prev) => {
        if (
          fromIdx < 0 ||
          fromIdx >= prev.runs.length ||
          toIdx < 0 ||
          toIdx >= prev.runs.length
        )
          return prev;
        const runs = [...prev.runs];
        const focused = runs[prev.currentIndex];
        const [moved] = runs.splice(fromIdx, 1);
        runs.splice(toIdx, 0, moved);
        const currentIndex = runs.indexOf(focused);
        const next = { ...prev, runs, currentIndex };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Update a specific run's settings by id (not just the focused run), so AI
  // "set run target" actions can apply to any of today's runs at parity.
  const updateRunSettingsById = useCallback(
    (runId: string, partial: Partial<RunSettings>) => {
      setAppState((prev) => {
        const idx = prev.runs.findIndex((r) => r.id === runId);
        if (idx < 0) return prev;
        const runs = [...prev.runs];
        runs[idx] = { ...runs[idx], settings: { ...runs[idx].settings, ...partial } };
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Snapshot just the run list + focused index (the only state the voice
  // structural commands touch). Reads the live ref, so within a multi-action
  // utterance this captures the START-of-command state — exact parity with the
  // web handlers, whose dayStateRef also lags mid-loop.
  const captureRunsSnapshot = useCallback(
    (): RunsSnapshot => ({
      runs: appStateRef.current.runs,
      currentIndex: appStateRef.current.currentIndex,
    }),
    [],
  );

  // Restore a previously captured run snapshot. Putting the exact prior `runs`
  // array back restores a removed run at its ORIGINAL position (no drift) and
  // un-does finish-run / start-/end-stoppage content changes. Inventory that a
  // finish already consumed stays consumed (idempotent) — same as web's undo.
  const restoreRunsSnapshot = useCallback(
    (snap: RunsSnapshot) => {
      setAppState((prev) => {
        const next = { ...prev, runs: snap.runs, currentIndex: snap.currentIndex };
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

  // Build a timestamped audit-trail entry for the substitution activity log.
  const makeSubLogEntry = useCallback(
    (kind: SubstitutionLogEntry["kind"], description: string): SubstitutionLogEntry => {
      const user = meUsernameRef.current;
      return {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ts: Date.now(),
        kind,
        description,
        ...(user ? { user } : {}),
      };
    },
    [],
  );

  // Temporary substitutions: one active overlay per affected ingredient, so
  // adding for the same ingredient replaces the prior one (case-insensitive).
  const addSubstitution = useCallback(
    (sub: IngredientSubstitution) => {
      setAppState((prev) => {
        const target = sub.ingredient.trim().toLowerCase();
        const others = (prev.substitutions ?? []).filter(
          (s) => s.ingredient.trim().toLowerCase() !== target,
        );
        const next = {
          ...prev,
          substitutions: [...others, sub],
          substitutionLog: [
            ...(prev.substitutionLog ?? []),
            makeSubLogEntry("added", describeSubstitution(sub)),
          ],
        };
        persist(next);
        return next;
      });
    },
    [persist, makeSubLogEntry],
  );

  const removeSubstitution = useCallback(
    (id: string) => {
      setAppState((prev) => {
        const removed = (prev.substitutions ?? []).find((s) => s.id === id);
        const next = {
          ...prev,
          substitutions: (prev.substitutions ?? []).filter((s) => s.id !== id),
          substitutionLog: removed
            ? [
                ...(prev.substitutionLog ?? []),
                makeSubLogEntry("cleared", describeSubstitution(removed)),
              ]
            : (prev.substitutionLog ?? []),
        };
        persist(next);
        return next;
      });
    },
    [persist, makeSubLogEntry],
  );

  const clearSubstitutions = useCallback(() => {
    setAppState((prev) => {
      const existing = prev.substitutions ?? [];
      const log =
        existing.length === 0
          ? (prev.substitutionLog ?? [])
          : [
              ...(prev.substitutionLog ?? []),
              makeSubLogEntry(
                "cleared",
                existing.length === 1
                  ? describeSubstitution(existing[0])
                  : `All substitutions (${existing.length})`,
              ),
            ];
      const next = { ...prev, substitutions: [], substitutionLog: log };
      persist(next);
      return next;
    });
  }, [persist, makeSubLogEntry]);

  // Warehouse staging checklist: tick a per-run need row off as pulled/staged.
  // Lives in synced day-state (NOT master data) and clears at the daily reset.
  // Only checked rows are stored (true); unchecking deletes the key. Keyed by
  // `${runId}::${label}__${unit}` so it lines up with web and survives re-renders.
  const toggleStagedItem = useCallback(
    (runId: string, rowKey: string) => {
      const key = `${runId}::${rowKey}`;
      setAppState((prev) => {
        const items = { ...(prev.stagedItems ?? {}) };
        if (items[key]) delete items[key];
        else items[key] = true;
        const next = { ...prev, stagedItems: items };
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

  const setFloorModeEnabled = useCallback(
    (on: boolean) => {
      setAppState((prev) => {
        const next = { ...prev, floorModeEnabled: on };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const suppressAutoTrack = useCallback(() => {
    const until = Date.now() + 10 * 60 * 1000;
    autoSuppressRef.current = until;
    setAutoSuppressUntil(until);
  }, []);

  // Cancel an active manual-override window so auto-track resumes immediately.
  // Mirrors web's "Resume now": clear suppression and force the next tick to fire
  // a bucket (without re-baselining the expectedCases delta, so no catch-up jump).
  const resumeAutoTrack = useCallback(() => {
    autoSuppressRef.current = 0;
    setAutoSuppressUntil(0);
    autoBucketRef.current = -1;
  }, []);

  // Keep the override banner's countdown ticking and guarantee it clears at expiry
  // even when no other state changes. Runs only during the (rare, ≤10 min) window.
  useEffect(() => {
    if (autoSuppressUntil <= Date.now()) return;
    const id = setInterval(() => {
      if (Date.now() >= autoSuppressUntil) {
        autoSuppressRef.current = 0;
        setAutoSuppressUntil(0);
      } else {
        setSuppressTick((t) => t + 1);
      }
    }, 20000);
    return () => clearInterval(id);
  }, [autoSuppressUntil]);

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
        // Re-adding a name resurrects it: drop it from the tombstone so the sync
        // union won't strip it back out (web parity). Gate this on the mergeable
        // lists only — brands/stopReasons never carry tombstones, so adding one
        // of those must NOT clear an ingredient tombstone that merely shares the
        // same text (matches the durable DELETE gating below + web, where only
        // the mergeable add* handlers clear the tombstone).
        const lower = v.trim().toLowerCase();
        const mergedAway = MERGEABLE_LIST_KEYS.has(list)
          ? (prev.mergedAway ?? []).filter((n) => n.trim().toLowerCase() !== lower)
          : (prev.mergedAway ?? []);
        const next = withChangeRecord(
          prev,
          { ...prev, mergedAway, [list]: [...prev[list], v] },
          "add",
          `Added "${v}" to ${LIST_LABELS[list]}`,
        );
        persist(next);
        return next;
      });
      // Re-adding a name must resurrect it across devices/days: drop it from the
      // DURABLE factory-wide tombstone too, otherwise the load-time/sync prune
      // would strip it back out on the next device. Best-effort. Only the
      // mergeable ingredient/die lists participate in merges — brands and
      // stopReasons never carry tombstones, so don't touch the durable set for
      // them (matches web, where only the mergeable add* handlers clear it).
      if (MERGEABLE_LIST_KEYS.has(list)) {
        void deleteMergedAwayNames([v]).catch(() => {});
      }
    },
    [persist],
  );

  const removeListItem = useCallback(
    (list: MasterListKey, value: string) => {
      setAppState((prev) => {
        const base = { ...prev, [list]: prev[list].filter((x) => x !== value) };
        // Deleting a brand also deletes every flavor that belonged to it — a
        // flavor only exists in the context of its brand.
        if (list === "brands" && prev.brandFlavors[value]) {
          const brandFlavors = { ...prev.brandFlavors };
          delete brandFlavors[value];
          base.brandFlavors = brandFlavors;
        }
        const next = withChangeRecord(
          prev,
          base,
          "remove",
          `Removed "${value}" from ${LIST_LABELS[list]}`,
        );
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
        const next = withChangeRecord(
          prev,
          {
            ...prev,
            brands,
            brandFlavors: { ...prev.brandFlavors, [b]: [...cur, f] },
          },
          "add",
          `Added flavor "${f}" to ${b}`,
        );
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
        const next = withChangeRecord(
          prev,
          {
            ...prev,
            brandFlavors: {
              ...prev.brandFlavors,
              [brand]: cur.filter((x) => x !== flavor),
            },
          },
          "remove",
          `Removed flavor "${flavor}" from ${brand}`,
        );
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
        const next = withChangeRecord(
          prev,
          { ...prev, [mapKey]: copy },
          "remove",
          `Deleted ${kind} recipe "${name}"`,
        );
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
        const next = withChangeRecord(
          prev,
          { ...prev, [mapKey]: copy },
          "rename",
          `Renamed ${kind} recipe "${oldName}" to "${n}"`,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Apply an (already-canonicalized) Excel spec-sheet import. Overwrite semantics
  // (per product): brand/flavor profiles and dough/sauce/cheese recipes of the
  // same name are overwritten; brand-new ones are added; option lists merge
  // additively so every new brand/flavor/type/ingredient becomes selectable.
  // Mirrors the web applySpecImport in artifacts/run-calculator/src/storage.ts
  // (replit.md parity). Fail-safe: a malformed entry is skipped, never aborts.
  const applySpecImport = useCallback(
    (parsed: ParsedSpecImport) => {
      setAppState((prev) => {
        const doughRecipePresets: Record<string, RecipeRow[]> = { ...prev.doughRecipePresets };
        const frontlineRecipePresets: Record<string, RecipeRow[]> = { ...prev.frontlineRecipePresets };
        const cheeseRecipePresets: Record<string, RecipeRow[]> = { ...prev.cheeseRecipePresets };
        const brandProfiles: Record<string, RunProfile> = { ...prev.brandProfiles };
        let brands = [...prev.brands];
        const brandFlavors: Record<string, string[]> = { ...prev.brandFlavors };
        const newDoughIng: string[] = [];
        const newSauceIng: string[] = [];
        const newCheeseIng: string[] = [];
        const newPepTypes: string[] = [];
        const newDieTypes: string[] = [];

        const registerBrandFlavor = (brand: string, flavor: string) => {
          if (!brand || !flavor) return;
          if (!brands.some((b) => b.toLowerCase() === brand.toLowerCase())) {
            brands = [...brands, brand];
          }
          const list = brandFlavors[brand] ?? [];
          if (!list.some((f) => f.toLowerCase() === flavor.toLowerCase())) {
            brandFlavors[brand] = [...list, flavor];
          }
        };

        // ── Recipe libraries (overwrite by name) ──
        for (const r of parsed.recipes) {
          const name = r.name.trim();
          if (!name || r.rows.length === 0) continue;
          const rows = r.rows.map((row) => ({ ingredient: row.ingredient, lbs: row.lbs }));
          if (r.kind === "dough") {
            doughRecipePresets[name] = rows;
            newDoughIng.push(...rows.map((x) => x.ingredient));
          } else if (r.kind === "sauce") {
            frontlineRecipePresets[name] = rows;
            newSauceIng.push(...rows.map((x) => x.ingredient));
          } else {
            cheeseRecipePresets[name] = rows;
            newCheeseIng.push(...rows.map((x) => x.ingredient));
          }
        }

        // ── Profiles (overwrite spec fields, preserve unrelated fields) ──
        for (const p of parsed.profiles) {
          const brand = p.brand.trim();
          const flavor = p.flavor.trim();
          if (!brand || !flavor) continue;
          registerBrandFlavor(brand, flavor);
          const key = profileKey(brand, flavor);
          const prof: RunProfile = { ...(brandProfiles[key] ?? {}) };
          if (p.dieType) {
            prof.dieType = p.dieType;
            newDieTypes.push(p.dieType);
          }
          if (p.sauceOzPerPizza != null) prof.sauceOzPerPizza = p.sauceOzPerPizza;
          p.applicators.slice(0, 4).forEach((a, i) => {
            const slot = i + 1;
            const type = a.type.trim();
            if (!type) return;
            (prof as Record<string, unknown>)[`app${slot}Type`] = type;
            (prof as Record<string, unknown>)[`app${slot}OzPerPizza`] = a.ozPerPizza;
          });
          p.pepperonis.slice(0, 2).forEach((pp, i) => {
            const slot = i + 1;
            const type = pp.type.trim();
            if (!type) return;
            (prof as Record<string, unknown>)[`pep${slot}Type`] = type;
            (prof as Record<string, unknown>)[`pep${slot}Sticks`] = pp.sticks;
            (prof as Record<string, unknown>)[`pep${slot}OzPerPizza`] = pp.ozPerPizza;
            newPepTypes.push(type);
          });
          brandProfiles[key] = prof;
        }

        // ── Tie recipes onto their profiles ──
        // One recipe can serve many brand/flavor profiles (recipeTargets unions
        // the singular brand/flavor with the targets[] list), so it ties to each
        // without being duplicated in the recipe library.
        for (const r of parsed.recipes) {
          const rows = r.rows.map((row) => ({ ingredient: row.ingredient, lbs: row.lbs }));
          for (const { brand, flavor } of recipeTargets(r)) {
            registerBrandFlavor(brand, flavor);
            const key = profileKey(brand, flavor);
            const prof: RunProfile = { ...(brandProfiles[key] ?? {}) };
            if (r.kind === "dough") {
              prof.doughRecipeName = r.name;
              prof.doughRecipe = rows;
              if (r.doughballOz != null) prof.doughballWeightOz = r.doughballOz;
            } else if (r.kind === "sauce") {
              prof.frontlineRecipeName = r.name;
              prof.frontlineRecipe = rows;
            } else {
              const slot = r.app != null && r.app >= 1 && r.app <= 4 ? r.app : 1;
              (prof as Record<string, unknown>)[`app${slot}CheeseRecipeName`] = r.name;
              (prof as Record<string, unknown>)[`app${slot}CheeseRecipe`] = rows;
            }
            brandProfiles[key] = prof;
          }
        }

        const next: AppState = {
          ...prev,
          brands: brands.sort((a, b) => a.localeCompare(b)),
          brandFlavors,
          brandProfiles,
          doughRecipePresets,
          frontlineRecipePresets,
          cheeseRecipePresets,
          doughIngredients: mergeInsensitive(prev.doughIngredients, newDoughIng),
          frontlineIngredients: mergeInsensitive(prev.frontlineIngredients, newSauceIng),
          cheeseIngredients: mergeInsensitive(prev.cheeseIngredients, newCheeseIng),
          pepTypes: mergeInsensitive(prev.pepTypes, newPepTypes),
          dieTypes: mergeInsensitive(prev.dieTypes, newDieTypes),
        };
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
        const next = withChangeRecord(
          prev,
          { ...prev, [list]: arr.map((x) => (x === oldName ? n : x)) },
          "rename",
          `Renamed "${oldName}" to "${n}" in ${LIST_LABELS[list]}`,
        );
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
        const next = withChangeRecord(
          prev,
          { ...prev, brands, brandFlavors, brandProfiles },
          "rename",
          `Renamed brand "${oldName}" to "${n}"`,
        );
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
        const next = withChangeRecord(
          prev,
          { ...prev, brandFlavors, brandProfiles },
          "rename",
          `Renamed flavor "${oldFlavor}" to "${f}" in ${brand}`,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Merge one or more source ingredient names into a single target across EVERY
  // value surface: master-data lists (deduped), every run's settings, templates,
  // history run settings, brand profiles, and all recipe presets. Recipe rows are
  // renamed but never combined, so totals are preserved. Inventory stock is folded
  // into the target server-side first; if that fails we abort before touching
  // local state so the two stores can't drift apart. Mirrors the web flow in
  // `run-calculator/src/pages/home.tsx`.
  const mergeIngredients = useCallback(
    async (sources: string[], target: string) => {
      const map: MergeMap = buildMergeMap(sources, target);
      if (Object.keys(map).length === 0) return;

      // Fold inventory stock first (server). If we can't read or fold inventory,
      // abort BEFORE touching local state so the two stores can't drift apart.
      let inv: Awaited<ReturnType<typeof fetchInventory>>;
      try {
        inv = await fetchInventory();
      } catch {
        throw new Error(
          "Couldn't verify inventory state — merge cancelled. Check your connection and try again.",
        );
      }
      const lines: MergeInventoryLine[] = [];
      for (const item of inv) {
        if (item.category !== "ingredient") continue;
        const toName = mapName(item.name, map);
        if (toName === item.name) continue;
        lines.push({
          fromKey: item.key,
          toKey: `ingredient:${toName}:${item.unit}`,
          toName,
          category: item.category,
          unit: item.unit,
        });
      }
      // Surface any inventory folds the server skipped (e.g. an item deleted
      // between the fetch above and the merge). All lines here come from tracked
      // inventory, so a skip is unexpected and worth flagging to the user.
      const skipped =
        lines.length > 0 ? (await mergeInventory(lines)).results.filter((r) => r.status === "skipped") : [];
      if (skipped.length > 0) {
        const summary = skipped
          .map((s) => `• ${s.fromKey} → ${s.toKey} (${s.reason ?? "unknown"})`)
          .join("\n");
        Alert.alert(
          "Some stock wasn't folded",
          `These inventory items weren't folded into the target:\n\n${summary}\n\n` +
            "Ingredient names were still merged everywhere else. Check these items' stock in Inventory.",
        );
      }

      // The shared helper is constrained to `Record<string, unknown>` (it is
      // mirrored verbatim with the web copy, which operates on parsed JSON). Our
      // settings are typed interfaces without an index signature, so cast across
      // the boundary.
      const mergeSettings = (s: RunSettings): RunSettings =>
        mergeSettingsObject(s as unknown as Record<string, unknown>, map) as unknown as RunSettings;
      const mergeProfile = (p: RunProfile): RunProfile =>
        mergeSettingsObject(p as unknown as Record<string, unknown>, map) as unknown as RunProfile;
      // Record the merged-away source names as tombstones so live-sync's additive
      // list-union can't bring them back from a stale peer/server. Never tombstone
      // a target (a source that maps to itself isn't a real source). Web parity.
      const tombTargets = new Set(Object.values(map).map((t) => t.trim().toLowerCase()));
      const tombSources = Object.keys(map).filter(
        (s) => !tombTargets.has(s.trim().toLowerCase()),
      );
      setAppState((prev) => {
        const next: AppState = {
          ...prev,
          mergedAway: [...new Set([...(prev.mergedAway ?? []), ...tombSources])],
          runs: prev.runs.map((r) => ({ ...r, settings: mergeSettings(r.settings) })),
          templates: prev.templates.map((t) =>
            t.settings ? { ...t, settings: mergeSettings(t.settings) } : t,
          ),
          history: prev.history.map((day) => ({
            ...day,
            runs: (day.runs ?? []).map((r) =>
              r.settings ? { ...r, settings: mergeSettings(r.settings) } : r,
            ),
          })),
          brandProfiles: Object.fromEntries(
            Object.entries(prev.brandProfiles).map(([k, v]) => [k, mergeProfile(v)]),
          ),
          pepTypes: mergeList(prev.pepTypes, map),
          cheeseIngredients: mergeList(prev.cheeseIngredients, map),
          doughIngredients: mergeList(prev.doughIngredients, map),
          frontlineIngredients: mergeList(prev.frontlineIngredients, map),
          dieTypes: mergeList(prev.dieTypes, map),
          doughRecipePresets: mergeRecipePresetMap(prev.doughRecipePresets, map),
          cheeseRecipePresets: mergeRecipePresetMap(prev.cheeseRecipePresets, map),
          frontlineRecipePresets: mergeRecipePresetMap(prev.frontlineRecipePresets, map),
          mixRecipePresets: mergeRecipePresetMap(prev.mixRecipePresets, map),
        };
        const recorded = withChangeRecord(
          prev,
          next,
          "merge",
          `Merged ${sources.join(", ")} into ${target}`,
        );
        persistNow(recorded);
        return recorded;
      });

      // Persist the merged-away source names to the DURABLE factory-wide
      // tombstone (best effort). Unlike the per-day sync blob, this survives a
      // day boundary and reaches a device that was offline during the merge, so
      // the merged names never resurface. Web parity.
      void saveMergedAwayNames(tombSources).catch(() => {});

      // Persist the confirmed merge as factory-wide learned aliases (best
      // effort): feeds the AI suggester next time and powers "previously
      // merged" suggestions. Non-fatal — the merge itself already succeeded.
      try {
        await saveMergeAliases(collectMergeAliases(sources, target));
      } catch {
        // ignore: learning is additive, the merge stands either way.
      }
      // Also record each confirmed source→target as a factory-wide correction
      // (ingredient domain) so every other name-resolving AI helper honors it.
      void saveAiCorrections(
        sources
          .filter((src) => src.trim() && src.trim().toLowerCase() !== target.trim().toLowerCase())
          .map((src) => ({ domain: "ingredient", fromText: src, toText: target })),
      );
    },
    [persistNow],
  );

  // Roll back to the point just before the given entry: restore that entry's
  // pre-edit snapshot and discard it plus every newer entry (the list is newest-
  // first, so we keep only entries older than the undone one). No-op when the
  // entry is gone. The persisted restore re-triggers the sync push effect, so a
  // merge undo propagates and un-resurrects merged-away names (web parity).
  // Inventory stock that a merge folded server-side is NOT un-folded — callers
  // warn about this. Fail-safe: never throws on the React/async path.
  const undoMasterDataChange = useCallback(
    (id: string) => {
      setAppState((prev) => {
        const list = prev.changeHistory ?? [];
        const idx = list.findIndex((e) => e.id === id);
        if (idx === -1) return prev;
        const restored: AppState = {
          ...list[idx].before,
          changeHistory: list.slice(idx + 1),
        };
        persistNow(restored);
        return restored;
      });
    },
    [persistNow],
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

  // Multi-sheet schedule planner import: write many days at once. Per the user's
  // choice, a re-import OVERRIDES the prior import for each date — previously
  // imported runs are dropped and replaced — while manually added runs are kept.
  // Only dates present in `byDate` are touched. Mirrors web commitMultiDayImport.
  const importScheduledRuns = useCallback(
    (byDate: { date: string; runs: Omit<ScheduledRun, "id">[] }[]) => {
      setAppState((prev) => {
        const scheduled = { ...prev.scheduled };
        for (const day of byDate) {
          const existing = prev.scheduled[day.date] ?? [];
          const kept = existing.filter((r) => !r.imported);
          const added: ScheduledRun[] = day.runs.map((r) => ({
            ...r,
            imported: true,
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          }));
          scheduled[day.date] = [...kept, ...added];
        }
        const next = { ...prev, scheduled };
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
    autoBucketTimeMsRef.current = 0;
    autoExpectedCasesRef.current = -1;
    traysRemainderRef.current = 0;
    batchesRemainderRef.current = 0;
  }, [currentRun?.id, currentRun?.isRunning, appState.autoTrack]);

  // Auto-track: once per 5-minute bucket while running, derive skids completed
  // and cases on the current skid from expected output (net elapsed × ppm), and
  // incrementally decrement dough trays / batches by what the line consumed in
  // the bucket (web parity). Suppressed for 10 minutes after the user manually
  // edits a stepper, so it never fights a supervisor who is taking over.
  useEffect(() => {
    if (!appState.autoTrack) return;
    const r = appState.runs[appState.currentIndex];
    if (!r?.isRunning) return;
    const nowMs = Date.now();
    const c = computeCalc(r, nowMs, appState.substitutions ?? []);
    if (
      c.ppm <= 0 ||
      r.settings.casesPerSkid <= 0 ||
      r.settings.pizzasPerCase <= 0
    )
      return;
    const bucket = Math.floor(nowMs / (5 * 60 * 1000));
    if (bucket === autoBucketRef.current) return;

    // Duration since the last bucket write (capped to 10 min to avoid huge
    // jumps); assume a 5-min bucket on the first write of a run.
    const prevMs = autoBucketTimeMsRef.current;
    const bucketDurationMin =
      prevMs > 0 ? Math.min(10, (nowMs - prevMs) / 60000) : 5;

    // Two case counts, mirroring web useAutoTrack:
    //  • feed count (front-of-line, no tunnel offset) gates dough-feed completion.
    //  • output count (after the freezer tunnel) drives skids/cases, since a case
    //    isn't "completed" until it exits the tunnel.
    // Clamp the output count to the run's total need so skids/cases freeze at
    // their final state once production is complete instead of cycling past it.
    const elapsedMin = c.netElapsedSec / 60;
    const freezerMin = Number(r.settings.freezerTime) || 0;
    const elapsedMinAfterTunnel = Math.max(0, elapsedMin - freezerMin);
    const feedCasesRaw = Math.floor(
      (elapsedMin * c.ppm) / r.settings.pizzasPerCase,
    );
    const outputCasesRaw = Math.floor(
      (elapsedMinAfterTunnel * c.ppm) / r.settings.pizzasPerCase,
    );
    const expectedCases =
      r.settings.casesNeeded > 0
        ? Math.min(r.settings.casesNeeded, outputCasesRaw)
        : outputCasesRaw;

    const prevExpected = autoExpectedCasesRef.current;
    // Advance bookkeeping even while suppressed so the suppression window
    // expiring never causes a catch-up jump that wipes a manual edit.
    autoBucketRef.current = bucket;
    autoBucketTimeMsRef.current = nowMs;
    // Baseline the incremental delta off the UNCLAMPED output total (web parity)
    // so the count keeps advancing even after the time-based estimate saturates at
    // casesNeeded — e.g. the estimate ran ahead, the operator corrected the count
    // down, then resumed auto-track. Using the clamped value here would pin the
    // delta at 0 and the count would never climb again.
    autoExpectedCasesRef.current = outputCasesRaw;

    // While the manual-edit suppression window is open, keep baselines current
    // but do not write — a supervisor is taking over.
    if (nowMs < autoSuppressRef.current) return;

    const next: Partial<RunProgress> = {};

    // Skids / cases: applied INCREMENTALLY (web parity — see useAutoTrack). Each
    // bucket adds the production since the last bucket on top of the current
    // (possibly manually-entered) value, so a manual correction becomes the new
    // baseline instead of being overwritten by the absolute estimate. On the
    // first bucket after a (re)start/switch the absolute count is seeded only
    // when there is no existing progress, so reloads/switches never double-count.
    const cps = r.settings.casesPerSkid;
    const curTotal =
      r.progress.skidsCompleted * cps + r.progress.casesOnCurrentSkid;
    let newTotal = curTotal;
    if (prevExpected < 0) {
      if (curTotal === 0 && expectedCases > 0) {
        newTotal =
          r.settings.casesNeeded > 0
            ? Math.min(r.settings.casesNeeded, expectedCases)
            : expectedCases;
      }
    } else {
      const deltaCases = Math.max(0, outputCasesRaw - prevExpected);
      if (deltaCases > 0) {
        const target = curTotal + deltaCases;
        newTotal =
          r.settings.casesNeeded > 0
            ? Math.min(target, Math.max(curTotal, r.settings.casesNeeded))
            : target;
      }
    }
    if (newTotal !== curTotal) {
      const skids = Math.floor(newTotal / cps);
      const casesOnSkid = newTotal % cps;
      if (skids !== r.progress.skidsCompleted) next.skidsCompleted = skids;
      if (casesOnSkid !== r.progress.casesOnCurrentSkid)
        next.casesOnCurrentSkid = casesOnSkid;
    }

    // Trays / batches: incremental decrement for this bucket's duration. Stop
    // once all the dough the run needs has been fed onto the line — dough enters
    // at the front (no tunnel offset), so feeding finishes when the front-of-line
    // case count reaches casesNeeded. Mirrors web mode-aware per-unit sources.
    const doughFeedComplete =
      r.settings.casesNeeded > 0 && feedCasesRaw >= r.settings.casesNeeded;
    if (!doughFeedComplete) {
      const supply = computeDoughSupply(r, nowMs, r.progress.subTab);
      const perTray = supply.perTray;
      const perBatch =
        r.progress.subTab === "crusts"
          ? r.settings.crustsPerCase
          : supply.perBatch;
      if (perTray > 0) {
        const traysExact =
          (bucketDurationMin * c.ppm) / perTray + traysRemainderRef.current;
        const traysConsumed = Math.floor(traysExact);
        traysRemainderRef.current = traysExact - traysConsumed;
        if (traysConsumed > 0) {
          const nextTrays = Math.max(0, r.progress.traysOnLine - traysConsumed);
          if (nextTrays !== r.progress.traysOnLine) next.traysOnLine = nextTrays;
        }
      }
      if (perBatch > 0) {
        const batchesExact =
          (bucketDurationMin * c.ppm) / perBatch + batchesRemainderRef.current;
        const batchesConsumed = Math.floor(batchesExact);
        batchesRemainderRef.current = batchesExact - batchesConsumed;
        if (batchesConsumed > 0) {
          const nextBatches = Math.max(
            0,
            r.progress.batchesReady - batchesConsumed,
          );
          if (nextBatches !== r.progress.batchesReady)
            next.batchesReady = nextBatches;
        }
      }
    }

    if (Object.keys(next).length > 0) {
      updateProgress(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const activeStoppage = currentRun?.stoppages?.find((s) => s.endedAt == null) ?? null;
  const calc = computeCalc(currentRun ?? makeNewRun(), Date.now(), appState.substitutions ?? []);

  // The main context value excludes the per-second clock fields and is memoized
  // so its identity stays stable across ticks. Every callback below is
  // useCallback-stable, so only appState / currentRun / syncStatus drive a
  // rebuild — consumers reading useRun() no longer re-render once per second.
  const value = useMemo<RunContextValue>(
    () => ({
        run: currentRun,
        runIndex: appState.currentIndex,
        runCount: appState.runs.length,
        allRuns: appState.runs,
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
        rolloverDay,
        addRun,
        switchRun,
        deleteRun,
        moveRun,
        updateRunSettingsById,
        updateProgressForRun,
        captureRunsSnapshot,
        restoreRunsSnapshot,
        resetRun,
        shiftNotes: appState.shiftNotes,
        setShiftNotes,
        substitutions: appState.substitutions,
        substitutionLog: appState.substitutionLog,
        addSubstitution,
        removeSubstitution,
        clearSubstitutions,
        stagedItems: appState.stagedItems,
        toggleStagedItem,
        templates: appState.templates,
        history: appState.history,
        saveTemplate,
        applyTemplate,
        deleteTemplate,
        autoTrack: appState.autoTrack,
        setAutoTrack,
        floorModeEnabled: appState.floorModeEnabled,
        setFloorModeEnabled,
        suppressAutoTrack,
        resumeAutoTrack,
        autoSuppressUntil,
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
        applySpecImport,
        mixRecipePresets: appState.mixRecipePresets,
        renameListItem,
        renameBrand,
        renameFlavor,
        mergeIngredients,
        changeHistory: appState.changeHistory,
        undoMasterDataChange,
        scheduled: appState.scheduled,
        addScheduledRun,
        importScheduledRuns,
        updateScheduledRun,
        removeScheduledRun,
        clearScheduledDay,
        applyScheduledDay,
        syncStatus,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appState, currentRun, syncStatus],
  );

  return (
    <RunContext.Provider value={value}>
      <RunClockContext.Provider value={{ calc, tick, activeStoppage }}>
        {children}
      </RunClockContext.Provider>
    </RunContext.Provider>
  );
}

export function useRun() {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRun must be used within RunContextProvider");
  return ctx;
}

// Subscribe to the per-second clock (live calc snapshot, tick, active stoppage).
// Only use this in screens that must update once per second; everything else
// should read useRun() so it does not re-render on every tick.
export function useRunClock() {
  const ctx = useContext(RunClockContext);
  if (!ctx) throw new Error("useRunClock must be used within RunContextProvider");
  return ctx;
}
