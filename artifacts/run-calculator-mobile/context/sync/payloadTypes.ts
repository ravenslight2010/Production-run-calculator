// Mirror of the web app's sync contract (`artifacts/run-calculator/src/types.ts`)
// and the API server's jsonb `daily_sync.data` shape. The server stores this
// untyped, so these types only need to be structurally compatible with what the
// web client reads/writes. Keep field names in sync with the web `FormValues`,
// `RunMeta`, and `SyncPayload` — they are the source of truth for the contract.

import type { IngredientSubstitution, SubstitutionLogEntry } from "@workspace/inventory-math";

export interface WebRecipeRow {
  ingredient: string;
  lbs: number;
}

// Web per-run stoppage. NOTE: this differs from the mobile `Stoppage` shape
// (mobile uses type "jam"|"changeover"|"break"|"other" with optional reason).
// Stoppages must be mapped between the two, never passed through raw.
export interface WebStoppage {
  id: string;
  reason: string;
  startedAt: number;
  endedAt?: number;
  notes?: string;
  type?: "stop" | "pause" | "manual";
}

// Web per-run metadata (the run identity + lifecycle), stored separately from
// its numeric config which lives in `runValues[id]` as a `WebFormValues`.
export interface WebRunMeta {
  id: string;
  brand: string;
  flavor: string;
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  subTab?: "dough" | "crusts";
  notes?: string;
  actualCases?: number;
  wasteLbs?: number;
  gapType?: "switchover" | "break";
  gapNote?: string;
  stoppages?: WebStoppage[];
}

// Web per-run config + live progress. The web app folds progress counters
// (skidsCompleted, casesOnCurrentSkid, traysOnLine, batchesReady, carryOverDone)
// INTO this object, whereas mobile keeps them in `run.progress`.
export interface WebFormValues {
  casesNeeded: number;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  approxLineSpeed: number; // mobile: lineSpeedPPM
  freezerTime: number;
  pizzasPerCase: number;
  casesPerSkid: number;
  casesPerLayer: number;
  doughballsPerTray: number;
  crustsPerStack: number;
  doughBatchYield: number;
  crustsPerCase: number;
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  traysOnLine: number;
  batchesReady: number;
  carryOverDone: boolean;
  sauceOzPerPizza: number;
  sauceBarrelLbs: number;
  app1OzPerPizza: number;
  app1BatchLbs: number;
  app2OzPerPizza: number;
  app2BatchLbs: number;
  app3OzPerPizza: number;
  app3BatchLbs: number;
  app4OzPerPizza: number;
  app4BatchLbs: number;
  pep1Sticks: number;
  pep1OzPerPizza: number;
  pep1BatchLbs: number;
  pep2Sticks: number;
  pep2OzPerPizza: number;
  pep2BatchLbs: number;
  app1Type: string;
  app2Type: string;
  app3Type: string;
  app4Type: string;
  pep1Type: string;
  pep2Type: string;
  dieType: string;
  doughRecipeName: string;
  targetDoughballWeight: number; // mobile: doughballWeightOz
  doughRecipe: WebRecipeRow[];
  app1CheeseRecipeName: string;
  app1CheeseRecipe: WebRecipeRow[];
  app2CheeseRecipeName: string;
  app2CheeseRecipe: WebRecipeRow[];
  app3CheeseRecipeName: string;
  app3CheeseRecipe: WebRecipeRow[];
  app4CheeseRecipeName: string;
  app4CheeseRecipe: WebRecipeRow[];
  frontlineRecipeName: string;
  frontlineRecipe: WebRecipeRow[];
  cartoned: string;
  cartonsPerCase: number;
  circles: string;
  shipper: string;
  skidStacking: string;
  gripSheets: string;
  slipSheets: string;
  allergen: string;
}

export interface SyncDayState {
  runs: WebRunMeta[];
  shiftNotes?: string;
  runToTime?: string;
  resetAt?: number;
  date?: string;
  // Today-only temporary recipe substitutions (overlay; reverts at daily reset).
  substitutions?: IngredientSubstitution[];
  // Read-only timestamped activity log of substitution adds/clears (today-only).
  substitutionLog?: SubstitutionLogEntry[];
}

// The full daily payload. Mobile owns/maps a subset of these fields; any field
// it does not model is preserved verbatim via raw-payload passthrough so neither
// platform clobbers the other's data.
export interface SyncPayload {
  dayState: SyncDayState;
  runValues: Record<string, WebFormValues>;
  brands?: string[];
  brandFlavors?: Record<string, string[]>;
  ingredientTypes?: string[];
  templates?: unknown[];
  history?: unknown[];
  pepTypes?: string[];
  dieTypes?: string[];
  cheeseIngredients?: string[];
  doughIngredients?: string[];
  frontlineIngredients?: string[];
  mixIngredients?: string[];
  doughRecipeNames?: string[];
  doughRecipePresets?: Record<string, unknown>;
  frontlineRecipeNames?: string[];
  frontlineRecipePresets?: Record<string, unknown>;
  cheeseRecipeNames?: string[];
  cheeseRecipePresets?: Record<string, unknown>;
  mixRecipeNames?: string[];
  brandProfiles?: Record<string, unknown>;
  crustProfiles?: Record<string, unknown>;
  // Tombstones: ingredient/die names merged away. Synced so the additive list
  // union can't resurrect a merged-away name from a stale peer/server.
  mergedAway?: string[];
  [key: string]: unknown;
}
