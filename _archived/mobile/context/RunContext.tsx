import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AppState as RNAppState,
  type AppStateStatus as RNAppStateStatus,
} from "react-native";
import { showNote } from "@/utils/notify";
import { MIX_SEED } from "@/data/mixSeed";
import { recipeApplyTargets, mirrorSingleCheeseAcrossApplicators, resolveCheeseApplicatorSlots, specImportRecipeIsMix, specImportNameMatchKey, cleanSpecCheeseRecipeName } from "@workspace/spec-import";
import type { ParsedSpecImport } from "@workspace/spec-import";
import { normalizeAllergen, type Allergen } from "@workspace/allergen";
import {
  PROFILE_CLEANUP_MARKER,
  PROFILE_REBUILD_OVERLAYS,
  PROFILE_REBUILD_DOUGHBALL_OZ,
  splitProfileKey,
  planProfileCleanup,
  brandsToRemoveAfterDeletes,
} from "@workspace/profile-cleanup";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  appStateToPayload,
  applyPayloadToState,
  diffStampRunEdits,
  flavorNamespace,
  formValuesToSettings,
  isBlankRemovableRun,
  runToFormValues,
} from "./sync/mapping";
import {
  fetchResetEpoch,
  fetchToday,
  getApiBaseUrl,
  getOrCreateClientId,
  openSyncStream,
  putToday,
  type SyncStream,
} from "./sync/client";
import type { SyncPayload, WebRunMeta } from "./sync/payloadTypes";
import {
  fetchRunTemplates,
  saveRunTemplates as saveRemoteTemplates,
  deleteRunTemplates as deleteRemoteTemplates,
  type RemoteRunTemplate,
} from "./runTemplatesApi";
import {
  fetchSupervisorPin,
  updateSupervisorPin as updateRemotePin,
} from "./supervisorPinApi";
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
import { moveEntries } from "@workspace/schedule-move";
import { saveMergeAliases, fetchMergedAwayNames, saveMergedAwayNames, deleteMergedAwayNames, type MergeSuggestCategory } from "./mergeSuggest";
import { saveAiCorrections } from "./aiCorrections";
import { fetchMixes, saveMixes } from "./mixes";
import { saveSpecImportAliases } from "./specImportAliases";
import type { SpecImportAlias } from "@workspace/spec-import";
import { useQuery } from "@tanstack/react-query";
import {
  buildIngredientIndex,
  hydrateRecipeRows as hydrateRecipeRowsCatalog,
  type IngredientCategory,
} from "@workspace/ingredient-catalog";
import {
  fetchIngredients,
  saveIngredients,
  deleteIngredients,
  mergeIngredientsRemote,
  findOrBuildIngredient,
} from "./ingredients";

const STORAGE_KEY = "run-calc-mobile-v2";
// Highest data-reset epoch this device has honoured. A manager reset bumps the
// server-side epoch; when this device sees a newer one (on sync connect or via a
// live SSE reset frame) it wipes local state and records the new epoch so the
// reset applies exactly once. Excluded from the wipe so the marker survives it.
const RESET_EPOCH_KEY = "run-calc-mobile-reset-epoch";

// Read the reset epoch this device has honoured (0 if never set / unreadable).
async function getStoredResetEpoch(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RESET_EPOCH_KEY);
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Used by the sandbox "Reset" action: wipe this device's locally-persisted
// day-state so that, after the server re-copies live → sandbox, the app pulls
// the fresh sandbox state from the server on the next launch instead of merging
// stale local edits back in (the live-sync merge is additive/non-clobber, so a
// reset would otherwise have no visible effect on this device).
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
  ingredientId?: string;
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
  // Last-write-wins stamp for this run's lifecycle fields (startedAt, endedAt,
  // isRunning, stoppages, actualCases, wasteLbs). Bumped whenever one of those
  // changes locally; the sync merge (mapping.ts, server, web) keeps the
  // strictly-newer-stamped copy so a just-started run can't be clobbered back
  // to "unstarted" by a stale peer/server copy (web parity).
  metaUpdatedAt?: number;
  // True when this run was AUTO-created as the day's placeholder (app boot,
  // daily rollover) rather than by a user action (New Run / reset run /
  // schedule pull-up). While it stays pristine (blank brand/flavor/notes, never
  // started, all-default settings/progress) it is LOCAL-ONLY: excluded from
  // every sync push and dropped on receive once the shared day has real runs —
  // otherwise every fresh device signing in mid-day adds a blank "Unnamed Run"
  // to every peer's list via the additive union (web parity: RunMeta.seeded).
  // Never travels over the wire; any user input makes the run sync normally.
  seeded?: boolean;
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
  /**
   * Seconds until the staged dough on hand (traysOnLine + batchesReady) is
   * consumed by the line at current PPM. 0 when PPM is unset or no dough is
   * staged. Used to suppress batch-due alerts once the crew's supply runs out.
   */
  doughDepletionSec: number;
  /**
   * Seconds to consume one sauce barrel (batch) at current PPM.
   * Formula: sauceEffBarrel × 16 ÷ sauceOzPerPizza ÷ PPM × 60.
   * 0 when PPM / sauceOzPerPizza / barrel lbs are unset.
   */
  sauceDepletionSec: number;
  /**
   * True when all cases needed for this run are accounted for: cased on the
   * floor OR currently moving through the freezer. Mirrors web calc.pressDone
   * (casesCompleted + casesInFreezer >= casesNeeded). Used to stop dough
   * batch alerts and trigger the next-run prep handoff.
   */
  pressDone: boolean;
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
// Factory-specific defaults intentionally EMPTY since the 2026-07-03 full data
// purge (mirrors web types.ts): fresh installs start with no baked-in data.
export const DEFAULT_PEP_TYPES: string[] = [];
// Legacy pep-type names renamed to the detailed standard names above; applied on
// every load so saved selections keep their pre-made (no-batch) calc behavior.
export const PEP_TYPE_RENAMES: Record<string, string> = {
  "Pep - Cured": "Pepperoni Stick",
  "Pep - Natural": "Pepperoni Stick - NATURAL",
};
// Variant die-type spellings folded to one canonical name (imports created three
// entries for the same physical 11" die). Applied to the die list + saved dieType
// fields on every load. Mirrors the web map.
export const DIE_TYPE_RENAMES: Record<string, string> = {
  "11": '11"',
  '11" dies': '11"',
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
export const DEFAULT_CHEESE_INGREDIENTS: string[] = [];
export const DEFAULT_DOUGH_INGREDIENTS: string[] = [];
export const DEFAULT_FRONTLINE_INGREDIENTS: string[] = [];
export const DEFAULT_STOP_REASONS = [
  "Equipment jam", "Changeover", "Break", "Maintenance",
  "Quality hold", "Staffing", "Waiting on dough",
];
export const DEFAULT_SUPERVISOR_PIN = "1234";

// Max runs per day — MUST match web's types.ts MAX_RUNS (replit.md parity).
export const MAX_RUNS = 30;

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

// True when a run mutation touched its lifecycle metadata (the fields the
// per-run metaUpdatedAt stamp protects). Settings/progress are excluded — they
// converge via the per-run VALUE stamps instead.
function runLifecycleChanged(a: RunState, b: RunState): boolean {
  return (
    a.startedAt !== b.startedAt ||
    a.endedAt !== b.endedAt ||
    a.isRunning !== b.isRunning ||
    a.actualCases !== b.actualCases ||
    a.wasteLbs !== b.wasteLbs ||
    a.stoppages !== b.stoppages &&
      JSON.stringify(a.stoppages) !== JSON.stringify(b.stoppages)
  );
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
  onError?: () => void,
): void {
  for (const r of runs) {
    if (r.startedAt != null && r.endedAt == null) {
      void consumeRunInventory(
        r.id,
        computeRunConsumptionLines(overlaySettings(r.settings, subs)),
      ).catch(() => onError?.());
    }
  }
}

// Shared message for a failed inventory-consume write (web parity wording).
const CONSUME_WRITE_ERR =
  "Couldn't record a finished run's inventory use on the server — stock counts may be out of sync. Check your connection.";

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
    // Auto-created placeholder: local-only while pristine (see `seeded`).
    runs: [{ ...makeNewRun(), seeded: true }],
    currentIndex: 0,
    shiftNotes: "",
    substitutions: [],
    substitutionLog: [],
    stagedItems: {},
    prepPhase: FRESH_PREP,
    date: today,
    resetAt: boundaryMs,
    history: [archived, ...cur.history.filter((h) => h.date !== cur.date)].slice(
      0,
      MAX_HISTORY_DAYS,
    ),
  };
}

/**
 * Suggested dough staging for a run — what the operator would stage right now,
 * derived from the CURRENT deficit (traysNeeded/batchesNeeded), capped to the
 * stepper maxes (74 trays / 3 batches) and to a sane staging quantity
 * (40 trays). Verbatim parity with web useAutoTrack's suggestedDoughStaging.
 */
export function suggestedDoughStaging(
  traysNeeded: number,
  batchesNeeded: number,
): { trays: number | null; batches: number | null } {
  return {
    trays: traysNeeded > 0
      ? Math.min(74, Math.max(1, Math.round(Math.min(40, traysNeeded))))
      : null,
    batches: batchesNeeded > 0
      ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, batchesNeeded))))
      : null,
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
  // Lifecycle-aware cases-in-freezer — mirrors web computeCasesInFreezer.
  // Mobile doesn't shift startedAt on resume (web does via resumeRun); instead
  // we subtract completed-stoppage downtime from gross elapsed. This prevents
  // fictitious tunnel fill during pauses and correctly drains after run end.
  const casesOnLine = (() => {
    const freezerTimeMin = Number(s.freezerTime);
    if (!state.startedAt || ppm <= 0 || s.pizzasPerCase <= 0 || freezerTimeMin <= 0) return 0;

    // Sum of all completed-stoppage durations in ms.
    const completedDownMs = state.stoppages
      .filter(st => st.endedAt != null)
      .reduce((acc, st) => acc + (st.endedAt! - st.startedAt), 0);

    if (!state.endedAt) {
      // Running: freeze elapsed at the open stoppage start (if paused), else use now.
      const activeStop = state.stoppages.find(st => st.endedAt == null);
      const refMs = activeStop ? activeStop.startedAt : nowMs;
      const netElapsedMin = Math.max(0, (refMs - state.startedAt - completedDownMs) / 60000);
      return Math.floor((ppm * Math.min(netElapsedMin, freezerTimeMin)) / s.pizzasPerCase);
    }

    // Ended: derive what was in the tunnel at stop, then drain since end.
    // endRun closes any open stoppage at endedAt, so completedDownMs already
    // accounts for pauses that were active when the run finished.
    const netAtEndMin = Math.max(0, (state.endedAt - state.startedAt - completedDownMs) / 60000);
    const atEndMin = Math.min(netAtEndMin, freezerTimeMin);
    const sinceEndMin = Math.max(0, (nowMs - state.endedAt) / 60000);
    const remainMin = Math.max(0, Math.min(atEndMin, freezerTimeMin - sinceEndMin));
    return Math.floor((ppm * remainMin) / s.pizzasPerCase);
  })();
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

  // Dough on hand in doughballs (trays × doughballs/tray + batches × batch yield)
  const doughOnHandBalls =
    (p.traysOnLine || 0) * s.doughballsPerTray +
    (p.batchesReady || 0) * doughEffBatch;
  const doughDepletionSec = ppm > 0 ? (doughOnHandBalls / ppm) * 60 : 0;

  // True when all cases needed are accounted for: cased on the floor OR
  // currently in the freezer (casesOnLine). Matches web pressDone semantics:
  //   casesCompleted + casesInFreezer >= casesNeeded
  // This means alert suppression and the next-run prep handoff both fire while
  // the last batch is still moving through the freezer — identical to web.
  const pressDone = s.casesNeeded > 0 && casesCompletedTotal + casesOnLine >= s.casesNeeded;

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
    doughDepletionSec,
    sauceDepletionSec:
      ppm > 0 && sauceEffBarrel > 0 && s.sauceOzPerPizza > 0
        ? (sauceEffBarrel * 16 / s.sauceOzPerPizza / ppm) * 60
        : 0,
    pressDone,
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

export const DEFAULT_DIE_TYPES: string[] = [];

export interface RunTemplate {
  id: string;
  name: string;
  settings: RunSettings;
  createdAt: number;
}

// Templates are stored server-side in the cross-platform wire shape
// (RemoteRunTemplate: WebFormValues + ISO createdAt). These convert between the
// wire shape and the mobile RunTemplate (RunSettings + epoch createdAt) so the
// rest of the app keeps working in mobile's native shape. Defined below where
// DEFAULT_SETTINGS/DEFAULT_PROGRESS are available.
function mobileTemplateToRemote(tpl: RunTemplate): RemoteRunTemplate {
  const values = runToFormValues({
    id: tpl.id,
    settings: tpl.settings,
    progress: DEFAULT_PROGRESS,
    stoppages: [],
    isRunning: false,
  });
  const remote: RemoteRunTemplate = {
    id: tpl.id,
    name: tpl.name,
    values,
    createdAt: new Date(tpl.createdAt).toISOString(),
  };
  if (tpl.settings.brand) remote.brand = tpl.settings.brand;
  if (tpl.settings.flavor) remote.flavor = tpl.settings.flavor;
  return remote;
}

function remoteTemplateToMobile(rt: RemoteRunTemplate): RunTemplate {
  const meta = {
    id: rt.id,
    brand: rt.brand ?? "",
    flavor: rt.flavor ?? "",
  } as WebRunMeta;
  const ts = Date.parse(rt.createdAt);
  return {
    id: rt.id,
    name: rt.name,
    settings: formValuesToSettings(rt.values, meta, undefined),
    createdAt: Number.isFinite(ts) ? ts : Date.now(),
  };
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

export type PrepPhaseType = {
  /** When "Start Prep" was pressed (ms epoch). Once set, never cleared. */
  prepStartedAt: number | null;
  /** Dough batches completed during prep (increments only, MAX merge). */
  prepBatchesDough: number;
  /** Sauce batches completed during prep (increments only, MAX merge). */
  prepBatchesSauce: number;
  /** True once prep batches have been carried into a started run (sticky). */
  prepCarriedOver: boolean;
  /** Run ID that triggered the late-run handoff reset. Guards against duplicate
   * resets when the operator switches tabs or the component remounts. */
  prepHandoffFromRunId?: string;
};

export const FRESH_PREP: PrepPhaseType = {
  prepStartedAt: null,
  prepBatchesDough: 0,
  prepBatchesSauce: 0,
  prepCarriedOver: false,
};

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
  // Deletion tombstones, namespaced per list (lowercased names). Synced so the
  // additive list union in live-sync can't resurrect a deleted item from a stale
  // peer. Flavors use namespace `flavor:<brandLower>` (web parity).
  deletedItems: Record<string, string[]>;
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
  // Shift prep phase: before production starts. Synced; reset at daily rollover.
  prepPhase?: PrepPhaseType;
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

/**
 * True when a profile object carries real recipe/applicator data (vs. a blank
 * default form). Mirrors web storage.ts profileObjHasRealData — used to refuse
 * saving a blank Setup Profiles form over a populated saved profile.
 */
function profileObjHasRealData(p: RunProfile): boolean {
  const arr = (x: unknown): boolean => Array.isArray(x) && x.length > 0;
  // A dough recipe ALONE does not make a profile "real". Almost every blank/
  // duplicate profile still carries a default dough recipe, so counting dough
  // here let a dough-only form be saved as a permanent brand+flavor profile —
  // which the spec-sheet cleanup (@workspace/profile-cleanup, dough-ignoring)
  // then couldn't recognize as blank, so the empty setups kept reappearing
  // ("ghosts"). Keep the dough exclusion in lockstep with profileHasRecipeData
  // in that lib (the two predicates differ elsewhere, but must agree on dough).
  if (arr(p.frontlineRecipe)) return true;
  for (const k of [
    "app1CheeseRecipe",
    "app2CheeseRecipe",
    "app3CheeseRecipe",
    "app4CheeseRecipe",
  ] as const) {
    if (arr(p[k])) return true;
  }
  for (const k of [
    "app1Type",
    "app2Type",
    "app3Type",
    "app4Type",
    "pep1Type",
    "pep2Type",
    "dieType",
    "frontlineRecipeName",
  ] as const) {
    const val = p[k];
    if (typeof val === "string" && val.trim()) return true;
  }
  return false;
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

// ── Deletion tombstone helpers (web parity) ──────────────────────────────────
// deletedItems is a per-namespace map of lowercased deleted names. A delete adds
// the name to its namespace; a re-add removes it. The live-sync apply strips
// each list's namespace from its additive union so a delete can't be resurrected
// by a stale peer.

function tombstoneDeletedItemNs(
  map: Record<string, string[]> | undefined,
  ns: string,
  name: string,
): Record<string, string[]> {
  const lower = String(name).trim().toLowerCase();
  if (!lower) return map ?? {};
  const out = { ...(map ?? {}) };
  const set = new Set(out[ns] ?? []);
  set.add(lower);
  out[ns] = [...set];
  return out;
}

function clearDeletedItemNs(
  map: Record<string, string[]> | undefined,
  ns: string,
  name: string,
): Record<string, string[]> {
  const lower = String(name).trim().toLowerCase();
  const cur = (map ?? {})[ns];
  if (!cur || cur.length === 0) return map ?? {};
  const out = { ...(map ?? {}) };
  out[ns] = cur.filter((n) => n !== lower);
  return out;
}

// A MasterListKey's namespace in the deletion map is the list key itself (matches
// the web payload keys: brands, dieTypes, pepTypes, cheese/dough/frontline).
function tombstoneDeletedItem(
  map: Record<string, string[]> | undefined,
  list: MasterListKey,
  name: string,
): Record<string, string[]> {
  return tombstoneDeletedItemNs(map, list, name);
}

function clearDeletedItem(
  map: Record<string, string[]> | undefined,
  list: MasterListKey,
  name: string,
): Record<string, string[]> {
  return clearDeletedItemNs(map, list, name);
}

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
  // Remove every blank run (no identity, never started, all-default values)
  // EXCEPT the current one, tombstoning each id so the removal propagates to
  // all peers via sync (web parity: removeBlankRuns).
  deleteBlankRuns: () => void;
  moveRun: (fromIdx: number, toIdx: number) => void;
  reorderRuns: (order: string[]) => { changed: boolean; undo: () => void };
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
  /**
   * True when the current run's press is done AND an unstarted dough run follows
   * in today's schedule. Signals the Dough tab to switch to "prep for next run"
   * mode (mirrors web LiveRunContext.nextRunPrepActive).
   */
  nextRunPrepActive: boolean;
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
  setSupervisorPin: (pin: string) => Promise<void>;
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
  // Standalone brand+flavor profile read/write (Setup Profiles editor) — never
  // touches the current run.
  saveProfileFor: (brand: string, flavor: string, values: RunProfile) => void;
  loadProfileFor: (brand: string, flavor: string) => RunSettings;
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
  mergeIngredients: (sources: string[], target: string, category?: MergeSuggestCategory) => Promise<void>;
  mergeBrands: (sources: string[], target: string) => void;
  mergeFlavors: (brand: string, sources: string[], target: string) => void;
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
  moveScheduledDay: (fromDate: string, toDate: string) => void;
  moveScheduledRun: (fromDate: string, id: string, toDate: string) => void;
  applyScheduledDay: (date: string) => boolean;
  // Shift prep phase state + batch tracking actions.
  prepPhase: PrepPhaseType | undefined;
  startPrep: () => void;
  addPrepBatchDough: () => void;
  addPrepBatchSauce: () => void;
  // Live multi-device sync connection status.
  syncStatus: SyncStatus;
  // Set when an inventory-consume write to the server failed (best-effort write
  // that previously failed silently). Surfaced as a dismissible banner.
  writeError: string | null;
  dismissWriteError: () => void;
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
  // Auto-created placeholder: local-only while pristine (see `seeded`).
  runs: [{ ...makeNewRun(), seeded: true }],
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
  deletedItems: {},
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
  // Fold variant die-type spellings so a saved run/profile still matches the
  // single canonical option in the picker.
  const die = out.dieType;
  if (typeof die === "string" && DIE_TYPE_RENAMES[die]) out.dieType = DIE_TYPE_RENAMES[die];
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

// Each auto-track counter ticks at its own natural production pace, clamped to
// a sane range: never faster than once per 2s (the app clock ticks per second)
// and never slower than once per hour (a stalled/garbage rate must not freeze
// the counter forever). Web useAutoTrack parity.
function clampAutoPeriodMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 60 * 60 * 1000;
  return Math.min(60 * 60 * 1000, Math.max(2000, ms));
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

// Recover die types referenced by saved brand/flavor profiles into the selectable
// master list. An import writes each profile's `dieType` value, but the run form's
// Die Type picker only lists `dieTypes` — with the built-in defaults now empty, a
// data reset can leave the picker blank even though profiles still name a die.
// Union those names back in (case-insensitive, keeping existing spelling) while
// honoring explicit deletions (deletedItems "dieTypes"). Mirrors web's
// healDieTypesFromProfiles (replit.md parity).
function healDieTypesFromProfiles(
  dieTypes: string[] | undefined,
  brandProfiles: Record<string, RunProfile> | undefined,
  deletedItems: Record<string, string[]> | undefined,
): string[] {
  const raw: string[] = [];
  for (const name of dieTypes ?? [...DEFAULT_DIE_TYPES]) {
    const t = (name ?? "").trim();
    if (t) raw.push(t);
  }
  for (const prof of Object.values(brandProfiles ?? {})) {
    const dt = typeof prof?.dieType === "string" ? prof.dieType.trim() : "";
    if (dt) raw.push(dt);
  }
  const deleted = new Set((deletedItems?.["dieTypes"] ?? []).map((d) => d.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    // Fold variant spellings onto the canonical die name before de-duping.
    const renamed = DIE_TYPE_RENAMES[name] ?? name;
    const lower = renamed.toLowerCase();
    if (seen.has(lower) || deleted.has(lower)) continue;
    seen.add(lower);
    out.push(renamed);
  }
  return out.sort((a, b) => a.localeCompare(b));
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
    dieTypes: healDieTypesFromProfiles(parsed.dieTypes, parsed.brandProfiles, parsed.deletedItems),
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
    deletedItems: parsed.deletedItems ?? {},
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
  // Per-counter "next tick due at" wall-clock timestamps (ms) — each counter
  // updates at its own natural production cadence (web useAutoTrack parity).
  // 0 = fire on the next tick (fresh baseline / forced resume).
  const caseNextDueMsRef = useRef<number>(0);
  const trayNextDueMsRef = useRef<number>(0);
  const batchNextDueMsRef = useRef<number>(0);
  // Wall-clock ms of each consumption counter's last tick — drives the
  // incremental tray/batch decrement (consumption for the actual duration).
  const trayLastMsRef = useRef<number>(0);
  const batchLastMsRef = useRef<number>(0);
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
  // One-shot per run: when the operator never entered staged dough (counter is
  // 0 at that counter's first tick), seed it with the suggested staging so the
  // countdown has something to count down from. Without this a crew that never
  // types their dough counts sees trays/batches sit at 0 the whole run.
  const traySeededRef = useRef<boolean>(false);
  const batchSeededRef = useRef<boolean>(false);

  // ── Live-sync state/refs ───────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [writeError, setWriteError] = useState<string | null>(null);
  const dismissWriteError = useCallback(() => setWriteError(null), []);
  const [bootDone, setBootDone] = useState(false);
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const clientIdRef = useRef<string | null>(null);
  const lastRemoteRawRef = useRef<SyncPayload | null>(null);
  const lastSyncSigRef = useRef<string>("");
  const lastLocalEditRef = useRef<number>(0);
  // Per-run edit timestamps (run id -> ms) + last-seen per-run form-value strings.
  // In-memory (platform-adapted vs web's localStorage): protection only matters
  // for live edits in the current session. Lets the apply path reject a stale
  // remote that would clobber a fresher local edit. See web app for parity.
  const runValuesUpdatedAtRef = useRef<Record<string, number>>({});
  const lastRunValsRef = useRef<Record<string, string>>({});
  // Whether lastRunValsRef has been seeded with a baseline yet. The first
  // observed snapshot (initial load) only PRIMES the baseline — it must not
  // stamp edit timestamps, or every loaded/imported run would be mistaken for a
  // fresh local edit. Once primed, any new-or-changed run id is a real edit.
  const editAttribPrimedRef = useRef(false);
  const pendingRemoteRef = useRef<SyncPayload | null>(null);
  const deferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<SyncStream | null>(null);
  const syncStartedRef = useRef(false);

  // Ingredient catalog (Task #102) — factory-wide server master list. The
  // local option lists above stay the immediate source of truth for the UI;
  // this is read to build/resolve catalog entries for the best-effort
  // dual-write calls below (mirrors web's home.tsx wiring, replit.md parity).
  const { data: ingredientCatalogData } = useQuery({
    queryKey: ["ingredients"],
    queryFn: fetchIngredients,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const ingredientCatalog = ingredientCatalogData ?? [];
  const ingredientCatalogRef = useRef(ingredientCatalog);
  ingredientCatalogRef.current = ingredientCatalog;

  const INGREDIENT_LIST_CATEGORY: Partial<Record<MasterListKey, IngredientCategory>> = {
    pepTypes: "pep",
    cheeseIngredients: "cheese",
    doughIngredients: "dough",
    frontlineIngredients: "frontline",
  };

  function saveCatalogEntry(name: string, category: IngredientCategory) {
    const built = findOrBuildIngredient(name, category, ingredientCatalogRef.current);
    return saveIngredients([built]).catch(() => {});
  }
  function renameCatalogEntry(oldName: string, newName: string, category: IngredientCategory) {
    const existing = ingredientCatalogRef.current.find(
      (i) => i.name.trim().toLowerCase() === oldName.trim().toLowerCase(),
    );
    const target = existing
      ? { ...existing, name: newName }
      : findOrBuildIngredient(newName, category, ingredientCatalogRef.current);
    return saveIngredients([target]).catch(() => {});
  }
  function deleteCatalogEntryByName(name: string) {
    const existing = ingredientCatalogRef.current.find(
      (i) => i.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (!existing) return Promise.resolve();
    return deleteIngredients([existing.id]).catch(() => {});
  }
  // Mirrors a confirmed manual ingredient merge (any source names -> one
  // target name) into the server catalog. See web home.tsx for the identical
  // flow/comment.
  async function mergeCatalogEntries(sourceNames: string[], targetName: string): Promise<void> {
    try {
      let target = ingredientCatalogRef.current.find(
        (i) => i.name.trim().toLowerCase() === targetName.trim().toLowerCase(),
      );
      if (!target) {
        const built = findOrBuildIngredient(targetName, "general", ingredientCatalogRef.current);
        const saved = await saveIngredients([built]);
        target = saved.find((i) => i.id === built.id) ?? built;
      }
      const sourceIds = sourceNames
        .map(
          (name) =>
            ingredientCatalogRef.current.find(
              (i) => i.name.trim().toLowerCase() === name.trim().toLowerCase(),
            )?.id,
        )
        .filter((id): id is string => !!id && id !== target!.id);
      if (sourceIds.length > 0) await mergeIngredientsRemote(sourceIds, target.id);
    } catch {
      // Best-effort: the local merge already succeeded; the catalog will
      // self-heal next time these names are touched.
    }
  }

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
  // Highest data-reset epoch this device has honoured (primed on boot below).
  const resetEpochRef = useRef(0);

  useEffect(() => {
    // Load the persisted day-state on boot and prime the honoured reset epoch so
    // pushes can carry it. Data resets are now server-driven (see the sync
    // bootstrap effect): a manager reset bumps a per-scope epoch, and this device
    // wipes local state + reloads onto the clean slate when it sees a newer epoch
    // (on sync connect, and live via an SSE reset frame). Fail-safe: any read
    // error boots with defaults.
    const loadStored = async (): Promise<string | null> => {
      resetEpochRef.current = await getStoredResetEpoch();
      try {
        return await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    };
    loadStored()
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
              consumeOpenRunsForRollover(current.runs, current.substitutions ?? [], () => setWriteError(CONSUME_WRITE_ERR));
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
      consumeOpenRunsForRollover(cur.runs, cur.substitutions ?? [], () => setWriteError(CONSUME_WRITE_ERR));
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

  // One-time spec-sheet reconciliation cleanup (web parity). Deletes duplicate
  // BLANK brand/flavor profiles, rebuilds a handful of profiles that lost their
  // recipe data from the factory spec sheets, and drops any brand whose flavor
  // list empties out. The concrete plan lives in @workspace/profile-cleanup so
  // web and mobile apply exactly the same fix. Guarded by a marker in its own
  // AsyncStorage key and deferred until boot completes; deletions are tombstoned
  // (per-flavor namespace + "brands") so the additive sync union can't resurrect
  // them, and rebuilds clear any stale tombstone so the healed profile sticks.
  useEffect(() => {
    if (!bootDone) return;
    let cancelled = false;
    (async () => {
      try {
        const done = await AsyncStorage.getItem(PROFILE_CLEANUP_MARKER);
        if (done || cancelled) return;
        // Plan from the current profiles (brandProfiles is LOCAL-only, so it is
        // safe to compute the delete/rebuild sets from a snapshot). Everything
        // that is synced (brands / brandFlavors / deletedItems) is re-derived
        // from the latest `prev` inside the functional update below so a remote
        // sync landing concurrently can't be clobbered by this migration.
        const snap = appStateRef.current;
        if (snap.brands.length === 0) return; // defer until brands are loaded

        const getProfile = (key: string): Record<string, unknown> | null => {
          const s = splitProfileKey(key);
          if (!s) return null;
          return (snap.brandProfiles[key] as Record<string, unknown>) ?? null;
        };
        const { deleteKeys, rebuildKeys } = planProfileCleanup(getProfile);
        if (deleteKeys.length === 0 && rebuildKeys.length === 0) {
          await AsyncStorage.setItem(PROFILE_CLEANUP_MARKER, "1");
          return;
        }
        if (cancelled) return;

        setAppState((prev) => {
          const brandProfiles = { ...prev.brandProfiles };
          const brandFlavors: Record<string, string[]> = {};
          for (const [b, fl] of Object.entries(prev.brandFlavors)) brandFlavors[b] = [...fl];
          let deletedItems = prev.deletedItems;

          const brandsToRemove = brandsToRemoveAfterDeletes(prev.brandFlavors, deleteKeys);
          const removeBrandSet = new Set(brandsToRemove.map((b) => b.toLowerCase().trim()));

          // 1) Delete the duplicate blank profiles + tombstone each flavor.
          const delByBrand: Record<string, Set<string>> = {};
          for (const key of deleteKeys) {
            const s = splitProfileKey(key);
            if (!s) continue;
            delete brandProfiles[key];
            deletedItems = tombstoneDeletedItemNs(deletedItems, flavorNamespace(s.brand), s.flavor);
            (delByBrand[s.brand] ??= new Set()).add(s.flavor);
          }

          // 2) Strip the deleted flavors from each brand's flavor list.
          for (const [brandKey, flavors] of Object.entries(brandFlavors)) {
            const del = delByBrand[brandKey.toLowerCase().trim()];
            if (!del) continue;
            brandFlavors[brandKey] = flavors.filter((f) => !del.has(f.toLowerCase().trim()));
          }

          // 3) Remove brands whose flavor list emptied out.
          let brands = prev.brands;
          if (brandsToRemove.length > 0) {
            brands = prev.brands.filter((b) => !removeBrandSet.has(b.toLowerCase().trim()));
            for (const b of brandsToRemove) {
              deletedItems = tombstoneDeletedItemNs(deletedItems, "brands", b);
              const matchKey = Object.keys(brandFlavors).find(
                (k) => k.toLowerCase().trim() === b.toLowerCase().trim(),
              );
              if (matchKey) delete brandFlavors[matchKey];
            }
          }

          // 4) Rebuild the profiles that lost their recipe data.
          for (const key of rebuildKeys) {
            const s = splitProfileKey(key);
            if (!s) continue;
            const overlay = PROFILE_REBUILD_OVERLAYS[key];
            if (!overlay) continue;
            const base = (brandProfiles[key] ?? {}) as RunProfile;
            const merged = { ...base, ...overlay } as RunProfile;
            const dough = PROFILE_REBUILD_DOUGHBALL_OZ[key];
            if (typeof dough === "number") merged.doughballWeightOz = dough;
            brandProfiles[key] = merged;
            deletedItems = clearDeletedItemNs(deletedItems, flavorNamespace(s.brand), s.flavor);
            deletedItems = clearDeletedItemNs(deletedItems, "brands", s.brand);
          }

          const next: AppState = { ...prev, brands, brandFlavors, brandProfiles, deletedItems };
          persist(next);
          return next;
        });
        await AsyncStorage.setItem(PROFILE_CLEANUP_MARKER, "1");
      } catch {
        /* fail-safe: leave data untouched, retry on a later boot */
      }
    })();
    return () => {
      cancelled = true;
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

  // Reflect the server's canonical template list into local state + cache. The
  // server is the source of truth, so this replaces (does not merge) the local
  // list. Skips the setState when nothing changed to avoid a re-render storm.
  const applyRemoteTemplates = useCallback(
    (remote: RemoteRunTemplate[]) => {
      const mapped = remote.map(remoteTemplateToMobile).slice(0, MAX_TEMPLATES);
      setAppState((prev) => {
        if (JSON.stringify(prev.templates) === JSON.stringify(mapped)) return prev;
        const next = { ...prev, templates: mapped };
        persist(next);
        return next;
      });
    },
    [persist],
  );


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
      // Send the real per-run timestamps, but compute the echo/no-op signature
      // WITHOUT them (map-less) so timestamps never perturb it — must match the
      // change-watcher's and commitRemote's sig computation.
      payload = appStateToPayload(appStateRef.current, lastRemoteRawRef.current, runValuesUpdatedAtRef.current);
      sig = stableStringify(appStateToPayload(appStateRef.current, lastRemoteRawRef.current));
    } catch {
      // Runs in a setTimeout, so a throw here is uncaught and would crash the
      // whole app. Sync is best-effort — degrade to offline instead.
      setSyncStatus("offline");
      return;
    }
    putToday(base, clientId, payload, todayStr(), resetEpochRef.current)
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
          const { patch, mergedUpdatedAt, rejectedStale } = applyPayloadToState(
            payload,
            prev,
            runValuesUpdatedAtRef.current,
          );
          runValuesUpdatedAtRef.current = mergedUpdatedAt;
          const next = { ...prev, ...patch };
          lastRemoteRawRef.current = payload;
          // Reseed the edit-attribution baseline to the just-applied state so a
          // remote-adopted value isn't mistaken for a local edit on the next
          // watcher tick (the watcher usually early-returns on the matching sig,
          // but a subsequent unrelated edit must still diff against this state).
          const seededVals: Record<string, string> = {};
          for (const [id, vals] of Object.entries(
            appStateToPayload(next, payload).runValues,
          )) {
            seededVals[id] = stableStringify(vals);
          }
          lastRunValsRef.current = seededVals;
          editAttribPrimedRef.current = true;
          // Map-less sig (no 3rd arg) — must match doPush/change-watcher.
          lastSyncSigRef.current = stableStringify(appStateToPayload(next, payload));
          persistNow(next);
          if (rejectedStale) {
            // We kept a strictly-newer local run value over a stale remote —
            // re-push so peers adopt ours and converge (web parity). Clear the
            // signature gate so the push isn't skipped as a no-op.
            lastSyncSigRef.current = "";
            schedulePushRef.current();
          }
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

    // A manager ran a data reset (server bumped the per-scope epoch). Neutralize
    // this populated device so it can't re-upload its stale state through the
    // additive sync union: wipe local storage, record the new epoch (so it only
    // fires once), and reset in-memory state to a clean slate. Fires from the
    // boot connect (offline-during-reset catch-up) and live via an SSE reset
    // frame. Fail-safe: a storage error still neutralizes the in-memory state.
    const applyServerReset = async (serverEpoch: number): Promise<void> => {
      if (!(serverEpoch > resetEpochRef.current)) return;
      try {
        const keys = await AsyncStorage.getAllKeys();
        const doomed = keys.filter(
          (k) => k.startsWith("run-calc") && k !== RESET_EPOCH_KEY,
        );
        if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
        await AsyncStorage.setItem(RESET_EPOCH_KEY, String(serverEpoch));
      } catch {
        /* fail-safe: still neutralize the in-memory state below */
      }
      resetEpochRef.current = serverEpoch;
      if (cancelled) return;
      const fresh: AppState = {
        ...INITIAL_STATE,
        date: todayStr(),
        runs: [{ ...makeNewRun(), seeded: true }],
      };
      // Clear the sync gates so the wiped state doesn't echo the pre-reset sig.
      // Don't clear runValuesUpdatedAtRef here: the change-watcher funnel owns
      // per-run stamps and re-stamps off the setAppState(fresh) commit below.
      // The fresh run has a brand-new id, so pre-reset stamps can't attach to it,
      // and mapping.ts drops any stray stamp so it never pairs with a live value
      // server-side. Assigning the ref directly would bypass that stamp funnel
      // (see .agents/memory/run-meta-lww.md).
      lastRemoteRawRef.current = null;
      lastSyncSigRef.current = "";
      setAppState(fresh);
      persistNow(fresh);
    };

    (async () => {
      const clientId = await getOrCreateClientId();
      if (cancelled) return;
      clientIdRef.current = clientId;
      syncStartedRef.current = true;
      // Reconcile the data-reset epoch BEFORE pulling today's row, so a device
      // that was offline during a reset wipes its stale state instead of seeding
      // the freshly-cleared server row with it.
      const serverEpoch = await fetchResetEpoch(base);
      if (cancelled) return;
      if (serverEpoch != null) await applyServerReset(serverEpoch);
      if (cancelled) return;
      try {
        const data = await fetchToday(base, todayStr());
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
      streamRef.current = openSyncStream(base, clientId, todayStr(), {
        onOpen: () => setSyncStatus("online"),
        onPayload: (payload, senderId) => {
          if (senderId && senderId === clientIdRef.current) return; // ignore our own echo
          onRemote(payload);
        },
        onReset: (resetEpoch) => {
          // A manager reset the data live — neutralize this device immediately so
          // the next push can't re-seed the freshly-cleared server row.
          void applyServerReset(resetEpoch);
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

  // ── Facility-wide run templates + supervisor PIN (server master-data) ───────
  // These used to be per-device (AsyncStorage only) so they never followed the
  // facility. They are now server-side, fetched here and reconciled into local
  // state (which stays the display/offline cache). Templates: one-time migration
  // seeds the server from local if the server is empty. PIN: NO auto-migration
  // (default "1234" on both sides — pushing would clobber another device's PIN).
  // Mirrors the web home.tsx reconciliation (replit.md parity). Best-effort and
  // fail-safe: a failed fetch leaves the local cache untouched.
  const templatesMigratedRef = useRef(false);
  useEffect(() => {
    if (!bootDone) return;
    if (!getApiBaseUrl()) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await fetchRunTemplates();
        if (cancelled) return;
        const localTemplates = appStateRef.current.templates;
        if (
          !templatesMigratedRef.current &&
          remote.length === 0 &&
          localTemplates.length > 0
        ) {
          templatesMigratedRef.current = true;
          const saved = await saveRemoteTemplates(
            localTemplates.map(mobileTemplateToRemote),
          );
          if (cancelled) return;
          applyRemoteTemplates(saved);
        } else {
          templatesMigratedRef.current = true;
          applyRemoteTemplates(remote);
        }
      } catch {
        // offline / not signed in — keep the local cache.
      }
      if (cancelled) return;
      try {
        const pin = await fetchSupervisorPin();
        // An empty string is a valid facility value ("no PIN / unlocked"), so we
        // only bail on a non-string (offline / not signed in). Applying "" lets a
        // PIN cleared on another device propagate here and unlock the Setup tab.
        if (cancelled || typeof pin !== "string") return;
        setAppState((prev) => {
          if (prev.supervisorPin === pin) return prev;
          const next = { ...prev, supervisorPin: pin };
          persist(next);
          return next;
        });
      } catch {
        // offline / not signed in — keep the local PIN.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone]);

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
    const now = Date.now();
    lastLocalEditRef.current = now;
    // Attribute the change to specific run(s) by diffing each run's form values
    // against the last-seen snapshot, and stamp their edit timestamp. This is the
    // mobile equivalent of the web autosave's per-run markRunValuesUpdated.
    try {
      const built = appStateToPayload(appState, lastRemoteRawRef.current);
      const nextVals: Record<string, string> = {};
      for (const [id, vals] of Object.entries(built.runValues)) {
        nextVals[id] = stableStringify(vals);
      }
      // Serialized shape of an all-default/empty run, so diffStampRunEdits can
      // refuse to stamp a populated→empty transition and clobber real data on
      // the shared day-state row (web parity). runToFormValues ignores the run
      // id, so this is deterministic regardless of makeNewRun's random id.
      const emptyValString = stableStringify(runToFormValues(makeNewRun()));
      const { updatedAt } = diffStampRunEdits(
        nextVals,
        lastRunValsRef.current,
        editAttribPrimedRef.current,
        now,
        runValuesUpdatedAtRef.current,
        emptyValString,
      );
      runValuesUpdatedAtRef.current = updatedAt;
      lastRunValsRef.current = nextVals;
      editAttribPrimedRef.current = true;
    } catch {
      // Best-effort attribution; sync still proceeds without a per-run stamp.
    }
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
        const before = runs[prev.currentIndex];
        let after = updater(before);
        // Diff-stamp the run's lifecycle metadata (web parity with
        // saveDayState's central diff-stamp): when a lifecycle field actually
        // changed, bump metaUpdatedAt so the sync merges (mobile receive,
        // server union, web receive) keep this copy over a stale peer's —
        // e.g. a just-started run surviving an app reload before the push
        // landed. Settings/progress edits are covered by the per-run VALUE
        // stamps and must NOT bump this, or an idle value edit could shadow
        // a peer's genuine lifecycle change.
        if (after !== before && runLifecycleChanged(before, after)) {
          after = { ...after, metaUpdatedAt: Date.now() };
        }
        runs[prev.currentIndex] = after;
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

  // Keep the current run's recipe rows resolved against the live server
  // catalog (Task #102, mirrors web home.tsx): a rename/merge made on ANY
  // device shows up here via ingredientId, without rewriting the recipe row
  // itself. Only the active run is touched — same scope as web, which only
  // hydrates the currently-edited form. Other runs/history/presets are
  // refreshed lazily the next time they become the active run.
  useEffect(() => {
    if (ingredientCatalog.length === 0) return;
    const index = buildIngredientIndex(ingredientCatalog);
    const r = appState.runs[appState.currentIndex];
    if (!r) return;
    // hydrateRecipeRowsCatalog is Array.map-based, so it always returns a NEW
    // array; per-row identity is preserved only when a row needed no change.
    // Compare row-by-row (not array-reference) so this bails out cleanly when
    // the catalog query merely re-resolves (new array, same data) — otherwise
    // every refetch would re-stamp/push the run.
    const hydrate = (rows: RecipeRow[]) => {
      const next = hydrateRecipeRowsCatalog(rows, index);
      const changed = next.some((row, i) => row !== rows[i]);
      return changed ? next : rows;
    };
    const doughRecipe = hydrate(r.settings.doughRecipe);
    const app1CheeseRecipe = hydrate(r.settings.app1CheeseRecipe);
    const app2CheeseRecipe = hydrate(r.settings.app2CheeseRecipe);
    const app3CheeseRecipe = hydrate(r.settings.app3CheeseRecipe);
    const app4CheeseRecipe = hydrate(r.settings.app4CheeseRecipe);
    const frontlineRecipe = hydrate(r.settings.frontlineRecipe);
    if (
      doughRecipe === r.settings.doughRecipe &&
      app1CheeseRecipe === r.settings.app1CheeseRecipe &&
      app2CheeseRecipe === r.settings.app2CheeseRecipe &&
      app3CheeseRecipe === r.settings.app3CheeseRecipe &&
      app4CheeseRecipe === r.settings.app4CheeseRecipe &&
      frontlineRecipe === r.settings.frontlineRecipe
    ) {
      return;
    }
    updateCurrentRun((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        doughRecipe,
        app1CheeseRecipe,
        app2CheeseRecipe,
        app3CheeseRecipe,
        app4CheeseRecipe,
        frontlineRecipe,
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredientCatalog, appState.currentIndex, appState.runs]);

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
            ).catch(() => setWriteError(CONSUME_WRITE_ERR));
          }
        });
        // Carry over prep batches into the starting run (once, guarded by prepCarriedOver).
        const prep = prev.prepPhase ?? FRESH_PREP;
        const carryDough = !prep.prepCarriedOver && prep.prepBatchesDough > 0;
        const runs = prev.runs.map((r, i) => {
          if (i === prev.currentIndex) {
            const base = { ...r, isRunning: true, startedAt: r.startedAt ?? now, endedAt: undefined, metaUpdatedAt: now };
            if (carryDough) {
              return {
                ...base,
                progress: {
                  ...base.progress,
                  batchesReady: (base.progress.batchesReady ?? 0) + prep.prepBatchesDough,
                },
              };
            }
            return base;
          }
          return r.startedAt != null && r.endedAt == null
            ? { ...r, isRunning: false, endedAt: now, metaUpdatedAt: now }
            : r;
        });
        const nextPrepPhase: PrepPhaseType = { ...prep, prepCarriedOver: true };
        const next = { ...prev, runs, prepPhase: nextPrepPhase };
        persist(next);
        return next;
      }),
    [persist],
  );

  const startPrep = useCallback(() => {
    setAppState((prev) => {
      const prep = prev.prepPhase ?? FRESH_PREP;
      if (prep.prepStartedAt !== null) return prev; // already started
      const next = { ...prev, prepPhase: { ...prep, prepStartedAt: Date.now() } };
      persist(next);
      return next;
    });
  }, [persist]);

  const addPrepBatchDough = useCallback(() => {
    setAppState((prev) => {
      const prep = prev.prepPhase ?? FRESH_PREP;
      const next = { ...prev, prepPhase: { ...prep, prepBatchesDough: prep.prepBatchesDough + 1 } };
      persist(next);
      return next;
    });
  }, [persist]);

  const addPrepBatchSauce = useCallback(() => {
    setAppState((prev) => {
      const prep = prev.prepPhase ?? FRESH_PREP;
      const next = { ...prev, prepPhase: { ...prep, prepBatchesSauce: prep.prepBatchesSauce + 1 } };
      persist(next);
      return next;
    });
  }, [persist]);

  const endRun = useCallback(
    () =>
      updateCurrentRun((r) => {
        // Auto-deduct this run's planned usage from inventory (idempotent by
        // run id; no-op for unknown item keys / when sync is disabled). Overlay
        // today's substitutions so the substitute is drawn down, not the short item.
        void consumeRunInventory(
          r.id,
          computeRunConsumptionLines(overlaySettings(r.settings, appStateRef.current.substitutions ?? [])),
        ).catch(() => setWriteError(CONSUME_WRITE_ERR));
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
        const runs = prev.runs.map((r) => {
          if (r.id !== id) return r;
          const after = { ...r, ...partial };
          // actualCases/wasteLbs are lifecycle metadata protected by the
          // per-run LWW stamp — bump it on a real change (this path bypasses
          // updateCurrentRun's central diff-stamp).
          return runLifecycleChanged(r, after)
            ? { ...after, metaUpdatedAt: Date.now() }
            : after;
        });
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Carry leftover dough/crusts into the next run: add surplus trays + batches
  // to the following run's staged supply, DEDUCT them from this run's staged
  // supply (they physically leave this run), and mark this run's carry-over done.
  const applyCarryOver = useCallback(
    (excessTrays: number, excessBatches: number) => {
      setAppState((prev) => {
        const runs = [...prev.runs];
        const cur = runs[prev.currentIndex];
        if (!cur) return prev;
        runs[prev.currentIndex] = {
          ...cur,
          progress: {
            ...cur.progress,
            carryOverDone: true,
            traysOnLine: Math.max(0, cur.progress.traysOnLine - excessTrays),
            batchesReady: Math.max(0, cur.progress.batchesReady - excessBatches),
          },
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
      // Auto-created placeholder: local-only while pristine (see `seeded`).
      runs: [{ ...makeNewRun(), seeded: true }],
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
      // Same day-run cap as web (types.ts MAX_RUNS) — web's addRun refuses past
      // the cap, so mobile must too (replit.md parity).
      if (prev.runs.length >= MAX_RUNS) return prev;
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
        const removed = prev.runs[index];
        const runs = prev.runs.filter((_, i) => i !== index);
        const currentIndex = Math.min(prev.currentIndex, runs.length - 1);
        // Tombstone the removed run id so live-sync's additive run-union can't
        // resurrect it from a peer that still has it (web parity).
        const deletedItems = removed
          ? tombstoneDeletedItemNs(prev.deletedItems, "runs", removed.id)
          : prev.deletedItems;
        const next = { ...prev, runs, currentIndex, deletedItems };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Remove every blank run in one action (cleanup for "Unnamed Run" entries
  // pinned in the shared day by the additive union before the seeded/local-only
  // fix). Each removed id is tombstoned (deletedItems.runs) so the removal
  // propagates to all peers and can't be resurrected. The current run is always
  // excluded — it may be a blank the user is about to fill in, and excluding it
  // guarantees the day never drops to 0 runs. Web parity: removeBlankRuns.
  const deleteBlankRuns = useCallback(() => {
    setAppState((prev) => {
      const blankIds = new Set(
        prev.runs
          .filter((r, i) => i !== prev.currentIndex && isBlankRemovableRun(r))
          .map((r) => r.id),
      );
      if (blankIds.size === 0) return prev;
      const focused = prev.runs[prev.currentIndex];
      const runs = prev.runs.filter((r) => !blankIds.has(r.id));
      if (runs.length === 0) return prev; // never leave the day with 0 runs
      let deletedItems = prev.deletedItems;
      for (const id of blankIds) {
        deletedItems = tombstoneDeletedItemNs(deletedItems, "runs", id);
      }
      const currentIndex = Math.max(0, runs.findIndex((r) => r.id === focused?.id));
      const next = { ...prev, runs, currentIndex, deletedItems };
      persist(next);
      return next;
    });
  }, [persist]);

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

  // Reorder today's runs to follow an AI-suggested sequence (array of run ids)
  // in a SINGLE state update — runs not named in the order keep their relative
  // position and are appended after the ordered ones. Returns whether anything
  // changed plus an undo that restores the exact prior order/focus. Mirrors the
  // web home.tsx applyScheduleOrder (replit.md parity).
  const reorderRuns = useCallback(
    (order: string[]): { changed: boolean; undo: () => void } => {
      const prev = appStateRef.current;
      const prevRuns = prev.runs;
      const prevIndex = prev.currentIndex;
      const rank = new Map(order.map((id, i) => [id, i]));
      const reordered = [...prevRuns].sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return prevRuns.indexOf(a) - prevRuns.indexOf(b);
      });
      const changed = !reordered.every((r, i) => r.id === prevRuns[i]?.id);
      const undo = () => {
        setAppState((cur) => {
          const next = { ...cur, runs: prevRuns, currentIndex: prevIndex };
          persist(next);
          return next;
        });
      };
      if (!changed) return { changed: false, undo };
      setAppState((cur) => {
        const focused = prevRuns[prevIndex];
        const currentIndex = reordered.indexOf(focused);
        const next = { ...cur, runs: reordered, currentIndex };
        persist(next);
        return next;
      });
      return { changed: true, undo };
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
      let toPush: RunTemplate[] | null = null;
      setAppState((prev) => {
        const cur = prev.runs[prev.currentIndex];
        const tpl: RunTemplate = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: name.trim() || `Template ${prev.templates.length + 1}`,
          settings: { ...cur.settings },
          createdAt: Date.now(),
        };
        const templates = [tpl, ...prev.templates].slice(0, MAX_TEMPLATES);
        toPush = templates;
        const next = { ...prev, templates };
        persist(next);
        return next;
      });
      // Write through to the facility-wide server list, then reconcile with the
      // server's canonical response. Best-effort: optimistic local state stands
      // if the push fails (offline).
      if (toPush) {
        saveRemoteTemplates((toPush as RunTemplate[]).map(mobileTemplateToRemote))
          .then(applyRemoteTemplates)
          .catch(() => {});
      }
    },
    [persist, applyRemoteTemplates],
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
      // Delete on the facility-wide server list too, then reconcile.
      deleteRemoteTemplates([id]).then(applyRemoteTemplates).catch(() => {});
    },
    [persist, applyRemoteTemplates],
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
    const until = Date.now() + 1 * 60 * 1000;
    autoSuppressRef.current = until;
    setAutoSuppressUntil(until);
  }, []);

  // Cancel an active manual-override window so auto-track resumes immediately.
  // Mirrors web's "Resume now": clear suppression and force every counter's next
  // tick to fire (without re-baselining the expectedCases delta, so no catch-up
  // jump).
  const resumeAutoTrack = useCallback(() => {
    autoSuppressRef.current = 0;
    setAutoSuppressUntil(0);
    caseNextDueMsRef.current = 0;
    trayNextDueMsRef.current = 0;
    batchNextDueMsRef.current = 0;
  }, []);

  // Keep the override banner's countdown ticking and guarantee it clears at expiry
  // even when no other state changes. Runs only during the (rare, ≤1 min) window.
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

  // The supervisor PIN is a facility-wide server setting. Changing it is
  // manager-gated server-side, so we optimistically apply locally for a snappy
  // UI, push to the server, then reconcile with the server's canonical value. If
  // the push fails (e.g. a non-manager → 403, or offline) we re-fetch the
  // canonical value and rethrow so the caller can surface the reason. An empty
  // PIN is a valid "no gate" value.
  //
  // pinOpRef makes this last-write-wins: each call takes a monotonic token and
  // only the latest in-flight op is allowed to touch state. This prevents a
  // stale/slow request (or its failure handler) from clobbering a newer value —
  // and we never revert to a captured local snapshot (which could be stale vs. a
  // reconciliation poll that landed mid-flight); we re-read the server instead.
  const pinOpRef = useRef(0);
  const setSupervisorPin = useCallback(
    async (pin: string) => {
      const op = ++pinOpRef.current;
      setAppState((prev) => {
        const next = { ...prev, supervisorPin: pin };
        persist(next);
        return next;
      });
      const applyIfLatest = (value: string) => {
        if (pinOpRef.current !== op) return;
        setAppState((prev) => {
          if (prev.supervisorPin === value) return prev;
          const next = { ...prev, supervisorPin: value };
          persist(next);
          return next;
        });
      };
      try {
        const saved = await updateRemotePin(pin);
        applyIfLatest(saved);
      } catch (err) {
        // Don't revert to a captured snapshot (a reconciliation poll may have
        // moved the value); re-read the canonical server value instead. If that
        // also fails (offline), leave the optimistic value for the next poll.
        try {
          const canonical = await fetchSupervisorPin();
          if (typeof canonical === "string") applyIfLatest(canonical);
        } catch {
          // offline — reconciliation effect will heal on reconnect.
        }
        throw err;
      }
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
        // Re-adding clears the deletion tombstone for this list's namespace so the
        // sync union won't strip it back out (web parity).
        const deletedItems = clearDeletedItem(prev.deletedItems, list, v);
        const next = withChangeRecord(
          prev,
          { ...prev, mergedAway, deletedItems, [list]: [...prev[list], v] },
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
      // Ingredient catalog dual-write (Task #102): keep the server catalog in
      // step for the lists whose entries recipe rows reference by id.
      const category = INGREDIENT_LIST_CATEGORY[list];
      if (category) void saveCatalogEntry(v, category);
    },
    [persist],
  );

  const removeListItem = useCallback(
    (list: MasterListKey, value: string) => {
      setAppState((prev) => {
        const base = { ...prev, [list]: prev[list].filter((x) => x !== value) };
        // Tombstone the deletion so the live-sync additive union can't resurrect
        // it from a stale peer (web parity).
        base.deletedItems = tombstoneDeletedItem(prev.deletedItems, list, value);
        // Deleting a brand also deletes every flavor that belonged to it — a
        // flavor only exists in the context of its brand. Tombstone each flavor
        // too, so a later re-add of the brand (which clears the brand tombstone)
        // can't let a stale peer resurrect the old flavors via the additive
        // brandFlavors union (web parity).
        if (list === "brands" && prev.brandFlavors[value]) {
          const ns = flavorNamespace(value);
          for (const f of prev.brandFlavors[value]) {
            base.deletedItems = tombstoneDeletedItemNs(base.deletedItems, ns, f);
          }
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
      // Ingredient catalog dual-write (Task #102).
      const category = INGREDIENT_LIST_CATEGORY[list];
      if (category) void deleteCatalogEntryByName(value);
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
        // Re-adding a flavor (and possibly its brand) clears the deletion
        // tombstones so the sync union won't strip them back out (web parity).
        let deletedItems = clearDeletedItemNs(prev.deletedItems, flavorNamespace(b), f);
        deletedItems = clearDeletedItemNs(deletedItems, "brands", b);
        const next = withChangeRecord(
          prev,
          {
            ...prev,
            brands,
            deletedItems,
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
        // Tombstone the flavor deletion so the sync union can't resurrect it from
        // a stale peer (web parity).
        const deletedItems = tombstoneDeletedItemNs(
          prev.deletedItems,
          flavorNamespace(brand),
          flavor,
        );
        const next = withChangeRecord(
          prev,
          {
            ...prev,
            deletedItems,
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

  // Direct brand+flavor profile read/write that does NOT touch the current
  // run — used by the standalone Setup Profiles editor so a manager can edit
  // any brand/flavor's saved setup without disturbing an in-progress run
  // (web parity: storage.ts loadProfile/saveProfile work the same way,
  // independent of the active run).
  const saveProfileFor = useCallback(
    (brand: string, flavor: string, values: RunProfile): void => {
      const b = brand.trim();
      const f = flavor.trim();
      if (!b || !f) return;
      // Refuse to persist a blank/default form over a real profile — same
      // guard as saveProfile/web storage.ts.
      if (!profileObjHasRealData(values)) return;
      setAppState((prev) => {
        const key = profileKey(b, f);
        const brands = prev.brands.includes(b) ? prev.brands : [...prev.brands, b];
        const curFlavors = prev.brandFlavors[b] ?? [];
        const brandFlavors = curFlavors.includes(f)
          ? prev.brandFlavors
          : { ...prev.brandFlavors, [b]: [...curFlavors, f] };
        const next = {
          ...prev,
          brands,
          brandFlavors,
          brandProfiles: { ...prev.brandProfiles, [key]: { ...values } },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const loadProfileFor = useCallback(
    (brand: string, flavor: string): RunSettings => {
      const profile = appState.brandProfiles[profileKey(brand, flavor)] ?? {};
      return { ...DEFAULT_SETTINGS, ...profile, brand, flavor };
    },
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
        // Fan out: rewrite recipe name references in all saved profiles so that
        // a renamed recipe doesn't leave stale pointers behind (which causes
        // "Recipe Setup Needed" warnings and re-import mismatches).
        // Mix renames update app1Type–app4Type (the applicator type fields where
        // mix names live); dough/sauce/cheese update their dedicated recipe-name
        // fields.
        const brandProfiles = { ...prev.brandProfiles };
        const profileFields =
          kind === "dough"
            ? ["doughRecipeName"]
            : kind === "frontline"
              ? ["frontlineRecipeName"]
              : kind === "mix"
                ? ["app1Type", "app2Type", "app3Type", "app4Type"]
                : ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"];
        for (const key of Object.keys(brandProfiles)) {
          const prof = brandProfiles[key] as Record<string, unknown>;
          let changed = false;
          const nextProf: Record<string, unknown> = { ...prof };
          for (const field of profileFields) {
            if (typeof prof[field] === "string" && (prof[field] as string).trim() === oldName.trim()) {
              nextProf[field] = n;
              changed = true;
            }
          }
          if (changed) brandProfiles[key] = nextProf as RunProfile;
        }
        const next = withChangeRecord(
          prev,
          { ...prev, [mapKey]: copy, brandProfiles },
          "rename",
          `Renamed ${kind} recipe "${oldName}" to "${n}"`,
        );
        persist(next);
        return next;
      });
      // For mix renames: rename the server mix row (so the DB name stays current)
      // and learn a spec-import alias so re-importing the premix workbook maps
      // the old name onto the renamed mix. Best-effort, fire-and-forget.
      if (kind === "mix" && n && n !== oldName) {
        void (async () => {
          let brand: string | undefined;
          try {
            const mixes = await fetchMixes();
            const row = mixes.find(
              (m) => m.name.trim().toLowerCase() === oldName.trim().toLowerCase(),
            );
            brand = row?.brand?.trim() || undefined;
            if (row) await saveMixes([{ ...row, name: n }]);
          } catch {}
          try {
            const aliases: SpecImportAlias[] = [
              { kind: "appType", externalName: oldName.trim(), canonicalName: n, context: null },
              ...(brand ? [{ kind: "appType", externalName: oldName.trim(), canonicalName: n, context: brand } as SpecImportAlias] : []),
            ];
            await saveSpecImportAliases(aliases);
          } catch {}
        })().catch(() => {});
      }
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

        // Every profile key this import writes to — the post-loop cheese-mirror
        // pass revisits each to fill any cheese applicator left blank by a
        // single-blend spec.
        const touchedKeys = new Set<string>();

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
        // Every non-mix cheese-blend name the parse carries — used to detect which
        // of a profile's applicator slots are CHEESE (matched by loose key) so they
        // render the pick-only Cheese card instead of a raw blend name.
        const cheeseCandidateNames = parsed.recipes
          .filter((r) => r.kind === "cheese" && !specImportRecipeIsMix(r, new Set<string>()))
          .map((r) => r.name);
        for (const p of parsed.profiles) {
          const brand = p.brand.trim();
          const flavor = p.flavor.trim();
          if (!brand || !flavor) continue;
          registerBrandFlavor(brand, flavor);
          const key = profileKey(brand, flavor);
          touchedKeys.add(key);
          const prof: RunProfile = { ...(brandProfiles[key] ?? {}) };
          if (p.dieType) {
            prof.dieType = p.dieType;
            newDieTypes.push(p.dieType);
          }
          // Allergen read from the spec sheet (egg/soy or any new allergen the
          // sheet named); already a normalized lower-case token from the parser.
          // Present only when the sheet designated one, so this never clobbers
          // with "none".
          if (p.allergen) prof.allergen = p.allergen;
          if (p.sauceOzPerPizza != null) prof.sauceOzPerPizza = p.sauceOzPerPizza;
          // Case pack read from the sheet (how many pizzas per case). Only present
          // when the sheet stated a positive count, so this never clobbers a default.
          if (p.pizzasPerCase != null && p.pizzasPerCase > 0) prof.pizzasPerCase = p.pizzasPerCase;
          // Sauce barrel size — fallback only; a mixed sauce recipe's row-sum wins
          // over this in the batch math when a recipe is present.
          if (p.sauceBarrelLbs != null && p.sauceBarrelLbs > 0) prof.sauceBarrelLbs = p.sauceBarrelLbs;
          // Detect cheese applicator slots and re-type them to the literal
          // "cheese" (the run form's pick-only Cheese card gates on that exactly);
          // record the blend name so it hydrates from the server pool, and the
          // recipe-tie loop below writes its rows.
          const { applicators: resolvedApps, links: cheeseLinks } = resolveCheeseApplicatorSlots(
            p.applicators.slice(0, 4),
            cheeseCandidateNames,
          );
          resolvedApps.forEach((a, i) => {
            const slot = i + 1;
            const type = a.type.trim();
            if (!type) return;
            (prof as Record<string, unknown>)[`app${slot}Type`] = type;
            (prof as Record<string, unknown>)[`app${slot}OzPerPizza`] = a.ozPerPizza;
            // Batch size — fallback only; a cheese recipe on this slot's row-sum
            // wins over this in the batch math when a recipe is present.
            if (a.batchLbs != null && a.batchLbs > 0) {
              (prof as Record<string, unknown>)[`app${slot}BatchLbs`] = a.batchLbs;
            }
          });
          for (const link of cheeseLinks) {
            (prof as Record<string, unknown>)[`app${link.slot}CheeseRecipeName`] = link.recipeName;
          }
          p.pepperonis.slice(0, 2).forEach((pp, i) => {
            const slot = i + 1;
            const type = pp.type.trim();
            if (!type) return;
            (prof as Record<string, unknown>)[`pep${slot}Type`] = type;
            (prof as Record<string, unknown>)[`pep${slot}Sticks`] = pp.sticks;
            (prof as Record<string, unknown>)[`pep${slot}OzPerPizza`] = pp.ozPerPizza;
            if (pp.batchLbs != null && pp.batchLbs > 0) {
              (prof as Record<string, unknown>)[`pep${slot}BatchLbs`] = pp.batchLbs;
            }
            newPepTypes.push(type);
          });
          brandProfiles[key] = prof;
        }

        // ── Tie recipes onto their profiles ──
        // One recipe can serve many brand/flavor profiles (recipeApplyTargets
        // unions the singular brand/flavor with the targets[] list, then falls
        // back to all same-brand profiles in this import when targets are empty),
        // so it ties to each without being duplicated in the recipe library.
        for (const r of parsed.recipes) {
          const rows = r.rows.map((row) => ({ ingredient: row.ingredient, lbs: row.lbs }));
          for (const { brand, flavor } of recipeApplyTargets(r, parsed.profiles)) {
            registerBrandFlavor(brand, flavor);
            const key = profileKey(brand, flavor);
            touchedKeys.add(key);
            const prof: RunProfile = { ...(brandProfiles[key] ?? {}) };
            if (r.kind === "dough") {
              prof.doughRecipeName = r.name;
              prof.doughRecipe = rows;
              if (r.doughballOz != null) prof.doughballWeightOz = r.doughballOz;
              // Crusts-per-batch yield — fallback only; when the dough rows +
              // doughball weight are present the calc derives the yield instead.
              if (r.doughBatchYield != null && r.doughBatchYield > 0) prof.doughBatchYield = r.doughBatchYield;
            } else if (r.kind === "sauce") {
              prof.frontlineRecipeName = r.name;
              prof.frontlineRecipe = rows;
            } else {
              // Place the cheese blend on the applicator slot(s) it actually
              // belongs to. The profile loop already re-typed real cheese
              // applicators to "cheese" (slots 2 & 4 for a two-cheese product);
              // write this blend's rows to every cheese slot whose name matches
              // (or is still blank). Only fall back to the legacy r.app/slot-1
              // guess when the profile has NO cheese applicator at all.
              const rec = prof as Record<string, unknown>;
              const rKey = specImportNameMatchKey(cleanSpecCheeseRecipeName(r.name));
              const cheeseSlots = [1, 2, 3, 4].filter(
                (n) => String(rec[`app${n}Type`] ?? "").trim().toLowerCase() === "cheese",
              );
              const matched = cheeseSlots.filter((n) => {
                const nm = String(rec[`app${n}CheeseRecipeName`] ?? "").trim();
                return !nm || specImportNameMatchKey(cleanSpecCheeseRecipeName(nm)) === rKey;
              });
              const targetSlots = matched.length
                ? matched
                : cheeseSlots.length
                  ? []
                  : [r.app != null && r.app >= 1 && r.app <= 4 ? r.app : 1];
              const cleanName = cleanSpecCheeseRecipeName(r.name) || r.name;
              for (const slot of targetSlots) {
                rec[`app${slot}CheeseRecipeName`] = cleanName;
                rec[`app${slot}CheeseRecipe`] = rows;
              }
            }
            brandProfiles[key] = prof;
          }
        }

        // ── Mirror a single cheese blend across multiple cheese applicators ──
        // A product can run two "Cheese" applicators on the SAME blend at
        // different per-pizza weights (weight lives on the applicator). The spec
        // then defines the blend once and the tie loop above fills only one slot,
        // leaving the other cheese applicator blank. Fill those blanks from the
        // lone blend (no-op when 2+ distinct blends — user resolves). Mirrors web.
        for (const key of touchedKeys) {
          const prof = brandProfiles[key];
          if (!prof) continue;
          const rec = prof as Record<string, unknown>;
          const slots = [1, 2, 3, 4].map((n) => ({
            type: String(rec[`app${n}Type`] ?? ""),
            cheeseRecipeName: String(rec[`app${n}CheeseRecipeName`] ?? ""),
            cheeseRecipe: (rec[`app${n}CheeseRecipe`] as RecipeRow[] | undefined) ?? [],
          }));
          const mirrored = mirrorSingleCheeseAcrossApplicators(slots);
          if (mirrored === slots) continue;
          const nextProf: RunProfile = { ...prof };
          const nextRec = nextProf as Record<string, unknown>;
          mirrored.forEach((s, i) => {
            nextRec[`app${i + 1}CheeseRecipeName`] = s.cheeseRecipeName;
            nextRec[`app${i + 1}CheeseRecipe`] = s.cheeseRecipe;
          });
          brandProfiles[key] = nextProf;
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
        if (list === "dieTypes") {
          if (!prev.dieTypes.includes(oldName)) return prev;
          // Consolidate onto the new name (which may already exist, so the user
          // can merge a duplicate onto its canonical spelling), and rewrite every
          // place a die value is stored — master list, saved profiles, and live
          // runs — plus tombstone the old name so the profile heal / sync union
          // can't resurrect it as a duplicate. Mirrors web renameDieType.
          const dieTypes = Array.from(
            new Set(prev.dieTypes.map((x) => (x === oldName ? n : x))),
          ).sort((a, b) => a.localeCompare(b));
          const brandProfiles = { ...prev.brandProfiles };
          for (const key of Object.keys(brandProfiles)) {
            const prof = brandProfiles[key];
            if (prof && prof.dieType === oldName) {
              brandProfiles[key] = { ...prof, dieType: n };
            }
          }
          const runs = prev.runs.map((r) =>
            r.settings.dieType === oldName
              ? { ...r, settings: { ...r.settings, dieType: n } }
              : r,
          );
          let deletedItems = tombstoneDeletedItem(prev.deletedItems, "dieTypes", oldName);
          deletedItems = clearDeletedItem(deletedItems, "dieTypes", n);
          const next = withChangeRecord(
            prev,
            { ...prev, dieTypes, brandProfiles, runs, deletedItems },
            "rename",
            `Renamed "${oldName}" to "${n}" in ${LIST_LABELS[list]}`,
          );
          persist(next);
          return next;
        }
        const arr = prev[list];
        if (!arr.includes(oldName) || arr.includes(n)) return prev;
        // Tombstone the old name (+ un-tombstone the new) so a stale peer's
        // additive sync union can't resurrect the old spelling as a duplicate
        // (matches the dieTypes branch above + web parity).
        let deletedItems = tombstoneDeletedItem(prev.deletedItems, list, oldName);
        deletedItems = clearDeletedItem(deletedItems, list, n);
        const next = withChangeRecord(
          prev,
          { ...prev, [list]: arr.map((x) => (x === oldName ? n : x)), deletedItems },
          "rename",
          `Renamed "${oldName}" to "${n}" in ${LIST_LABELS[list]}`,
        );
        persist(next);
        return next;
      });
      // Ingredient catalog dual-write (Task #102).
      const category = INGREDIENT_LIST_CATEGORY[list];
      if (category && n) void renameCatalogEntry(oldName, n, category);
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
        // Tombstone the old brand (+ un-tombstone the new) so a stale peer's
        // additive sync union can't resurrect it as a duplicate (web parity).
        let deletedItems = tombstoneDeletedItemNs(prev.deletedItems, "brands", oldName);
        deletedItems = clearDeletedItemNs(deletedItems, "brands", n);
        const next = withChangeRecord(
          prev,
          { ...prev, brands, brandFlavors, brandProfiles, deletedItems },
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
        // Tombstone the old flavor (+ un-tombstone the new) under this brand's
        // flavor namespace so a stale peer's sync union can't resurrect it (web parity).
        let deletedItems = tombstoneDeletedItemNs(prev.deletedItems, flavorNamespace(brand), oldFlavor);
        deletedItems = clearDeletedItemNs(deletedItems, flavorNamespace(brand), f);
        const next = withChangeRecord(
          prev,
          { ...prev, brandFlavors, brandProfiles, deletedItems },
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
    async (sources: string[], target: string, category?: MergeSuggestCategory) => {
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
        showNote(
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
        await saveMergeAliases(collectMergeAliases(sources, target), category);
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
      // Ingredient catalog dual-write (Task #102): mirror the confirmed merge
      // into the server catalog so it stays authoritative for id-referencing
      // recipe rows. Best-effort — the local merge above already succeeded.
      void mergeCatalogEntries(sources, target);
    },
    [persistNow],
  );

  // Fold one or more source brands into a target brand: union their flavors into
  // the target, drop the source brands (tombstoned so the additive sync union
  // can't resurrect them), and re-point today's runs from a merged-away brand to
  // the target. Brands carry no inventory (nothing to fold) and, matching the web
  // path, per-flavor profiles keyed to a merged-away brand are left as-is rather
  // than re-keyed. persistNow pushes immediately so the tombstones propagate
  // before any incoming pull. Web parity with home.tsx `mergeBrands`.
  const mergeBrands = useCallback(
    (sources: string[], target: string) => {
      const tgt = target.trim();
      if (!tgt) return;
      setAppState((prev) => {
        const srcSet = new Set(
          sources.map((s) => s.trim().toLowerCase()).filter((s) => s && s !== tgt.toLowerCase()),
        );
        if (srcSet.size === 0) return prev;
        const brandFlavors = { ...prev.brandFlavors };
        const targetFlavors = new Set(brandFlavors[tgt] ?? []);
        for (const b of Object.keys(brandFlavors)) {
          if (srcSet.has(b.toLowerCase())) {
            for (const f of brandFlavors[b] ?? []) targetFlavors.add(f);
            delete brandFlavors[b];
          }
        }
        brandFlavors[tgt] = [...targetFlavors].sort((a, b) => a.localeCompare(b));
        let brands = prev.brands.filter((b) => !srcSet.has(b.toLowerCase()));
        if (!brands.some((b) => b.toLowerCase() === tgt.toLowerCase())) brands = [...brands, tgt];
        brands = brands.sort((a, b) => a.localeCompare(b));
        let deletedItems = prev.deletedItems;
        for (const b of prev.brands) {
          if (srcSet.has(b.toLowerCase())) deletedItems = tombstoneDeletedItemNs(deletedItems, "brands", b);
        }
        const runs = prev.runs.map((r) =>
          srcSet.has((r.settings.brand ?? "").toLowerCase())
            ? { ...r, settings: { ...r.settings, brand: tgt } }
            : r,
        );
        const next = withChangeRecord(
          prev,
          { ...prev, brands, brandFlavors, deletedItems, runs },
          "merge",
          `Merged brands ${sources.map((s) => `"${s}"`).join(", ")} into "${tgt}"`,
        );
        persistNow(next);
        return next;
      });
      // Persist the confirmed merge as a learned "brand" alias (best effort):
      // feeds the AI suggester next time and powers "previously merged"
      // suggestions on the Brand/Flavor tab. Non-fatal — the merge itself
      // already succeeded. Web parity.
      void saveMergeAliases(collectMergeAliases(sources, tgt), "brand").catch(() => {});
    },
    [persistNow],
  );

  // Fold one or more source flavors into a target flavor WITHIN a single brand:
  // rewrite that brand's flavor list (sources tombstoned) and re-point today's
  // runs for that brand from a merged-away flavor to the target. Web parity with
  // home.tsx `mergeFlavors`.
  const mergeFlavors = useCallback(
    (brand: string, sources: string[], target: string) => {
      const b = brand.trim();
      const tgt = target.trim();
      if (!b || !tgt) return;
      setAppState((prev) => {
        const current = prev.brandFlavors[b] ?? [];
        const srcSet = new Set(
          sources.map((s) => s.trim().toLowerCase()).filter((s) => s && s !== tgt.toLowerCase()),
        );
        if (srcSet.size === 0) return prev;
        let list = current.filter((f) => !srcSet.has(f.toLowerCase()));
        if (!list.some((f) => f.toLowerCase() === tgt.toLowerCase())) list = [...list, tgt];
        list = list.sort((a, b) => a.localeCompare(b));
        const brandFlavors = { ...prev.brandFlavors, [b]: list };
        let deletedItems = prev.deletedItems;
        const ns = flavorNamespace(b);
        for (const f of current) {
          if (srcSet.has(f.toLowerCase())) deletedItems = tombstoneDeletedItemNs(deletedItems, ns, f);
        }
        const runs = prev.runs.map((r) =>
          r.settings.brand === b && srcSet.has((r.settings.flavor ?? "").toLowerCase())
            ? { ...r, settings: { ...r.settings, flavor: tgt } }
            : r,
        );
        const next = withChangeRecord(
          prev,
          { ...prev, brandFlavors, deletedItems, runs },
          "merge",
          `Merged flavors ${sources.map((s) => `"${s}"`).join(", ")} into "${tgt}" (${b})`,
        );
        persistNow(next);
        return next;
      });
      // Persist the confirmed merge as a learned "flavor" alias scoped to this
      // brand (best effort) — mirrors mergeBrands / web parity.
      void saveMergeAliases(collectMergeAliases(sources, tgt), "flavor", b).catch(() => {});
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

  // Move scheduled runs to another date. Mobile's schedule pool includes today
  // (today's scheduled bucket is distinct from the live `runs` list, which is never
  // touched here) plus future days. Whole-day move (sel "all") or a single run.
  // Append onto the target (no auto-collapse), regenerate colliding ids, drop the
  // source day if it empties. Shares @workspace/schedule-move with web.
  const moveScheduledEntries = useCallback(
    (fromDate: string, sel: "all" | string, toDate: string) => {
      if (!toDate || toDate === fromDate) return;
      setAppState((prev) => {
        const srcDay = prev.scheduled[fromDate] ?? [];
        if (srcDay.length === 0) return prev;
        const ids: string[] | "all" = sel === "all" ? "all" : [sel];
        const { source, target, idMap } = moveEntries(
          srcDay,
          prev.scheduled[toDate] ?? [],
          ids,
          () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        );
        if (idMap.length === 0) return prev;
        const scheduled = { ...prev.scheduled, [toDate]: target };
        if (source.length === 0) delete scheduled[fromDate];
        else scheduled[fromDate] = source;
        const next = { ...prev, scheduled };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const moveScheduledDay = useCallback(
    (fromDate: string, toDate: string) => moveScheduledEntries(fromDate, "all", toDate),
    [moveScheduledEntries],
  );

  const moveScheduledRun = useCallback(
    (fromDate: string, id: string, toDate: string) => moveScheduledEntries(fromDate, id, toDate),
    [moveScheduledEntries],
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

  // Reset the tick bookkeeping whenever the active run changes or its running
  // state flips, so the next auto-track write fires immediately with a clean
  // baseline instead of continuing another run's cadence.
  useEffect(() => {
    caseNextDueMsRef.current = 0;
    trayNextDueMsRef.current = 0;
    batchNextDueMsRef.current = 0;
    trayLastMsRef.current = 0;
    batchLastMsRef.current = 0;
    autoExpectedCasesRef.current = -1;
    traysRemainderRef.current = 0;
    batchesRemainderRef.current = 0;
    traySeededRef.current = false;
    batchSeededRef.current = false;
  }, [currentRun?.id, currentRun?.isRunning, appState.autoTrack]);

  // Auto-track: while running, each counter updates at its own natural
  // production cadence instead of a fixed wall-clock interval (web useAutoTrack
  // parity):
  //  • cases (and skids, derived from the same total): every time-to-run-one-case
  //  • trays: every time-to-consume-one-tray
  //  • batches: every quarter-batch duration (the integer count still drops once
  //    per full batch via the fractional remainder carry)
  // Suppressed for 1 minute after the user manually edits a stepper, so it
  // never fights a supervisor who is taking over.
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

    // While the manual-edit suppression window is open, bookkeeping still
    // advances (so the window expiring never causes a catch-up jump that wipes
    // a manual edit) but nothing is written — a supervisor is taking over.
    const suppressed = nowMs < autoSuppressRef.current;

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

    const next: Partial<RunProgress> = {};

    // ── Cases (and skids, derived from the same total): tick once per case. ──
    // Skids / cases: applied INCREMENTALLY (web parity — see useAutoTrack). Each
    // tick adds the production since the last tick on top of the current
    // (possibly manually-entered) value, so a manual correction becomes the new
    // baseline instead of being overwritten by the absolute estimate. On the
    // first tick after a (re)start/switch the absolute count is seeded only
    // when there is no existing progress, so reloads/switches never double-count.
    if (nowMs >= caseNextDueMsRef.current) {
      const casePeriodMs = clampAutoPeriodMs(
        (r.settings.pizzasPerCase / c.ppm) * 60000,
      );
      const prevExpected = autoExpectedCasesRef.current;
      caseNextDueMsRef.current = nowMs + casePeriodMs;
      // Baseline the incremental delta off the UNCLAMPED output total (web
      // parity) so the count keeps advancing even after the time-based estimate
      // saturates at casesNeeded — e.g. the estimate ran ahead, the operator
      // corrected the count down, then resumed auto-track. Using the clamped
      // value here would pin the delta at 0 and the count would never climb.
      autoExpectedCasesRef.current = outputCasesRaw;

      if (!suppressed) {
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
      }
    }

    // Trays / batches: incremental decrement, each at its own cadence. Stop
    // once all the dough the run needs has been fed onto the line — dough enters
    // at the front (no tunnel offset), so feeding finishes when the front-of-line
    // case count reaches casesNeeded. Mirrors web mode-aware per-unit sources.
    const doughFeedComplete =
      r.settings.casesNeeded > 0 && feedCasesRaw >= r.settings.casesNeeded;
    const supply = computeDoughSupply(r, nowMs, r.progress.subTab);
    const perTray = supply.perTray;
    const perBatch =
      r.progress.subTab === "crusts"
        ? r.settings.crustsPerCase
        : supply.perBatch;

    // ── Trays: tick once per time-to-consume-one-tray. ──
    if (perTray > 0 && nowMs >= trayNextDueMsRef.current) {
      const trayPeriodMs = clampAutoPeriodMs((perTray / c.ppm) * 60000);
      const prevMs = trayLastMsRef.current;
      // Consumption for the actual duration since this counter's last tick
      // (capped to 2 periods to avoid huge jumps); assume one full period on
      // the first tick.
      const durationMin =
        prevMs > 0
          ? Math.min((trayPeriodMs * 2) / 60000, (nowMs - prevMs) / 60000)
          : trayPeriodMs / 60000;
      trayNextDueMsRef.current = nowMs + trayPeriodMs;
      trayLastMsRef.current = nowMs;
      if (!suppressed && !doughFeedComplete) {
        // First tray tick of a run where the operator never entered staged
        // dough (counter still 0): seed the suggested staging so the countdown
        // has something to count down from — otherwise a crew that never types
        // their dough counts sees trays sit at 0 the whole run. One-shot per
        // run; a counter with a value (manual or seeded) depletes normally
        // below. Web useAutoTrack parity.
        let traySeededThisTick = false;
        if (!traySeededRef.current) {
          traySeededRef.current = true;
          const seed = suggestedDoughStaging(
            supply.traysNeeded,
            supply.batchesNeeded,
          ).trays;
          if (r.progress.traysOnLine === 0 && seed !== null) {
            next.traysOnLine = seed;
            traySeededThisTick = true;
          }
        }
        if (!traySeededThisTick) {
          const traysExact =
            (durationMin * c.ppm) / perTray + traysRemainderRef.current;
          const traysConsumed = Math.floor(traysExact);
          traysRemainderRef.current = traysExact - traysConsumed;
          if (traysConsumed > 0) {
            const nextTrays = Math.max(0, r.progress.traysOnLine - traysConsumed);
            if (nextTrays !== r.progress.traysOnLine) next.traysOnLine = nextTrays;
          }
        }
      }
    }

    // ── Batches: tick once per quarter-batch duration. ──
    if (perBatch > 0 && nowMs >= batchNextDueMsRef.current) {
      const batchPeriodMs = clampAutoPeriodMs((perBatch / c.ppm / 4) * 60000);
      const prevMs = batchLastMsRef.current;
      const durationMin =
        prevMs > 0
          ? Math.min((batchPeriodMs * 2) / 60000, (nowMs - prevMs) / 60000)
          : batchPeriodMs / 60000;
      batchNextDueMsRef.current = nowMs + batchPeriodMs;
      batchLastMsRef.current = nowMs;
      if (!suppressed && !doughFeedComplete) {
        // Same one-shot seed as trays: an untouched 0 counter gets the
        // suggested staging on its first tick so it has stock to count down.
        let batchSeededThisTick = false;
        if (!batchSeededRef.current) {
          batchSeededRef.current = true;
          const seed = suggestedDoughStaging(
            supply.traysNeeded,
            supply.batchesNeeded,
          ).batches;
          if (r.progress.batchesReady === 0 && seed !== null) {
            next.batchesReady = seed;
            batchSeededThisTick = true;
          }
        }
        if (!batchSeededThisTick) {
          const batchesExact =
            (durationMin * c.ppm) / perBatch + batchesRemainderRef.current;
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
    }

    if (Object.keys(next).length > 0) {
      updateProgress(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const activeStoppage = currentRun?.stoppages?.find((s) => s.endedAt == null) ?? null;
  const calc = computeCalc(currentRun ?? makeNewRun(), Date.now(), appState.substitutions ?? []);

  // True when the current run's press is done AND an unstarted dough run
  // follows in today's schedule (mirrors web LiveRunContext.nextRunPrepActive).
  const nextRunMobile = appState.runs[appState.currentIndex + 1];
  const nextRunPrepActive =
    currentRun?.isRunning === true &&
    !currentRun?.endedAt &&
    calc.pressDone &&
    !!nextRunMobile &&
    !nextRunMobile.startedAt &&
    (nextRunMobile.progress.subTab ?? "dough") !== "crusts";

  // Depletion handoff: reset prepPhase exactly once per run when
  // nextRunPrepActive first becomes true. Lives in the provider (not a tab
  // component) so it fires regardless of which screen is visible.
  // The durable guard `prepHandoffFromRunId === runId` prevents double-reset
  // across remounts (mirrors web LiveRunHandoffGuard).
  useEffect(() => {
    if (!nextRunPrepActive) return;
    const runId = currentRun?.id ?? "";
    if (!runId) return;
    setAppState(prev => {
      const prevPrep = prev.prepPhase ?? FRESH_PREP;
      if (prevPrep.prepHandoffFromRunId === runId) return prev; // already done
      const next: AppState = {
        ...prev,
        prepPhase: {
          prepStartedAt: Date.now(),
          prepBatchesDough: 0,
          prepBatchesSauce: 0,
          prepCarriedOver: false,
          prepHandoffFromRunId: runId,
        },
      };
      persist(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextRunPrepActive, currentRun?.id]);

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
        deleteBlankRuns,
        moveRun,
        reorderRuns,
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
        nextRunPrepActive,
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
        saveProfileFor,
        loadProfileFor,
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
        mergeBrands,
        mergeFlavors,
        changeHistory: appState.changeHistory,
        undoMasterDataChange,
        scheduled: appState.scheduled,
        addScheduledRun,
        importScheduledRuns,
        updateScheduledRun,
        removeScheduledRun,
        clearScheduledDay,
        moveScheduledDay,
        moveScheduledRun,
        applyScheduledDay,
        prepPhase: appState.prepPhase,
        startPrep,
        addPrepBatchDough,
        addPrepBatchSauce,
        syncStatus,
        writeError,
        dismissWriteError,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appState, currentRun, syncStatus, writeError],
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
