import * as z from "zod";
import type { IngredientSubstitution, SubstitutionLogEntry } from "@workspace/inventory-math";

export type { IngredientSubstitution, SubstitutionLogEntry };

// A recipe row references a catalog ingredient by stable id (Task #102);
// `ingredient` is kept as a plain-text display-name cache/fallback so legacy
// rows (saved before the catalog existed) and offline rows keep working — see
// @workspace/ingredient-catalog for how `ingredientId` is resolved back to the
// live name.
const recipeRowSchema = z.object({
  ingredient: z.string().default(""),
  ingredientId: z.string().optional(),
  lbs: z.coerce.number().min(0).default(0),
});

export const formSchema = z.object({
  // All numeric fields default to 0 ("not set yet") and MUST match
  // DEFAULT_VALUES below — a blank run starts all-zero, and every default-vs-set
  // guard (isEmptyOverPopulated, backfillFromProfile, profileAutofill blanks)
  // keys off DEFAULT_VALUES. speedAdjustment is the one meaningful numeric
  // default (a 1.0 multiplier). Historical note: these once carried example
  // line numbers (casesNeeded 384, cycleSpeed 7.8, pep batch 25 lbs, …) which
  // made untouched fields indistinguishable from deliberately-set ones.
  casesNeeded: z.coerce.number().min(0).default(0),
  crustsPerCycle: z.coerce.number().min(0).default(0),
  cycleSpeed: z.coerce.number().min(0).default(0),
  speedAdjustment: z.coerce.number().min(0.01).default(1.0),
  approxLineSpeed: z.coerce.number().min(0).default(0),
  // Compatibility-preserved field name. This is the total physical Freeze
  // tunnel line time, not warehouse freezer storage time.
  freezerTime: z.coerce.number().min(0).default(0),
  pizzasPerCase: z.coerce.number().min(0).default(0),
  casesPerSkid: z.coerce.number().min(0).default(0),
  casesPerLayer: z.coerce.number().min(0).default(0),
  doughballsPerTray: z.coerce.number().min(0).default(0),
  crustsPerStack: z.coerce.number().min(0).default(0),
  doughBatchYield: z.coerce.number().min(0).default(0),
  crustsPerCase: z.coerce.number().min(0).default(0),
  skidsCompleted: z.coerce.number().min(0).default(0),
  casesOnCurrentSkid: z.coerce.number().min(0).default(0),
  traysOnLine: z.coerce.number().min(0).default(0),
  batchesReady: z.coerce.number().min(0).default(0),
  // Measured machine times (seconds). Defaults are the factory's typical
  // times (low 330 / high 180 / hopper 70); operators can overwrite them with
  // measured values. A saved/cleared 0 is folded back to the default on read
  // (see MACHINE_TIME_DEFAULTS). Mixer runs low then high speed
  // back-to-back; total spin = low + high. Hopper = one batch → doughballs.
  mixerLowSec: z.coerce.number().min(0).default(330),
  mixerHighSec: z.coerce.number().min(0).default(180),
  hopperSec: z.coerce.number().min(0).default(70),
  carryOverDone: z.boolean().default(false),
  sauceOzPerPizza: z.coerce.number().min(0).default(0),
  sauceBarrelLbs: z.coerce.number().min(0).default(0),
  app1OzPerPizza: z.coerce.number().min(0).default(0),
  app1BatchLbs: z.coerce.number().min(0).default(0),
  app2OzPerPizza: z.coerce.number().min(0).default(0),
  app2BatchLbs: z.coerce.number().min(0).default(0),
  app3OzPerPizza: z.coerce.number().min(0).default(0),
  app3BatchLbs: z.coerce.number().min(0).default(0),
  app4OzPerPizza: z.coerce.number().min(0).default(0),
  app4BatchLbs: z.coerce.number().min(0).default(0),
  pep1Sticks: z.coerce.number().min(0).default(0),
  pep1OzPerPizza: z.coerce.number().min(0).default(0),
  pep1BatchLbs: z.coerce.number().min(0).default(0),
  pep2Sticks: z.coerce.number().min(0).default(0),
  pep2OzPerPizza: z.coerce.number().min(0).default(0),
  pep2BatchLbs: z.coerce.number().min(0).default(0),
  // "Combine" applicator 1 & 2: run one pep type through both physical
  // applicators. Hides applicator 2 in the UI and doubles applicator 1's stick
  // buffer. Default true; spec-import with 2+ pep types sets it false.
  pep1Combined: z.boolean().default(true),
  // Optional ADDITIONAL pep type per applicator (a second pepperoni loaded into
  // the same applicator). Empty type = slot unused.
  pep1SticksB: z.coerce.number().min(0).default(0),
  pep1OzPerPizzaB: z.coerce.number().min(0).default(0),
  pep1BatchLbsB: z.coerce.number().min(0).default(0),
  pep2SticksB: z.coerce.number().min(0).default(0),
  pep2OzPerPizzaB: z.coerce.number().min(0).default(0),
  pep2BatchLbsB: z.coerce.number().min(0).default(0),
  app1Type: z.string().default(""),
  app2Type: z.string().default(""),
  app3Type: z.string().default(""),
  app4Type: z.string().default(""),
  pep1Type: z.string().default(""),
  pep2Type: z.string().default(""),
  pep1TypeB: z.string().default(""),
  pep2TypeB: z.string().default(""),
  dieType: z.string().default(""),
  allergen: z.string().default("none"),
  doughRecipeName: z.string().default(""),
  targetDoughballWeight: z.coerce.number().min(0).default(0),
  doughRecipe: z.array(recipeRowSchema).default([]),
  app1CheeseRecipeName: z.string().default(""),
  app1CheeseRecipe: z.array(recipeRowSchema).default([]),
  app2CheeseRecipeName: z.string().default(""),
  app2CheeseRecipe: z.array(recipeRowSchema).default([]),
  app3CheeseRecipeName: z.string().default(""),
  app3CheeseRecipe: z.array(recipeRowSchema).default([]),
  app4CheeseRecipeName: z.string().default(""),
  app4CheeseRecipe: z.array(recipeRowSchema).default([]),
  frontlineRecipeName: z.string().default(""),
  frontlineRecipe: z.array(recipeRowSchema).default([]),
  cartoned: z.string().default("cartoned"),
  // Only meaningful when cartoned === "labeled": top / bottom / both.
  labelPosition: z.string().default(""),
  cartonsPerCase: z.coerce.number().min(0).default(0),
  // Only meaningful when cartoned === "labeled": labelsPerRoll for a single
  // top/bottom label position, the top/bottom pair when position is "both".
  labelsPerRoll: z.coerce.number().min(0).default(0),
  topLabelsPerRoll: z.coerce.number().min(0).default(0),
  bottomLabelsPerRoll: z.coerce.number().min(0).default(0),
  circles: z.string().default("none"),
  shipper: z.string().default(""),
  skidStacking: z.string().default(""),
  gripSheets: z.string().default("none"),
  slipSheets: z.string().default("no"),
  // Line tunnel stage timings — split the total Freeze tunnel time (freezerTime) into
  // three physically distinct segments.  Default 2.5 min each (the factory
  // standard pre/post dwell).  A one-time boot heal writes 2.5 into any
  // existing profile that still has 0 stored from before this default was set.
  preTunnelMin: z.coerce.number().min(0).default(2.5),
  postTunnelMin: z.coerce.number().min(0).default(2.5),
  // Temporary this-run-only overrides for the Setup numbers. 0/blank = no
  // override (use the Setup value). Never saved into brand/flavor profiles.
  // Compatibility-preserved override field name for the Freeze tunnel time.
  tempFreezerTime: z.coerce.number().min(0).default(0),
  tempCrustsPerCycle: z.coerce.number().min(0).default(0),
  tempCycleSpeed: z.coerce.number().min(0).default(0),
});

export type FormValues = z.infer<typeof formSchema>;

// Overlay the temporary Run-tab overrides (tempFreezerTime / tempCrustsPerCycle /
// tempCycleSpeed) onto a values object for CALCULATION and DISPLAY. The
// underlying Setup fields are never mutated — clearing an override (0/blank)
// falls straight back to the permanent Setup number.
export function withTempOverrides<T extends Partial<Record<string, unknown>>>(v: T): T {
  const ft = Number((v as Record<string, unknown>).tempFreezerTime) || 0;
  const cpc = Number((v as Record<string, unknown>).tempCrustsPerCycle) || 0;
  const cs = Number((v as Record<string, unknown>).tempCycleSpeed) || 0;
  if (ft <= 0 && cpc <= 0 && cs <= 0) return v;
  return {
    ...v,
    ...(ft > 0 ? { freezerTime: ft } : {}),
    ...(cpc > 0 ? { crustsPerCycle: cpc } : {}),
    ...(cs > 0 ? { cycleSpeed: cs } : {}),
  };
}

export type RecipeRow = { ingredient: string; ingredientId?: string; lbs: number };
export type DoughRecipePreset = { rows: RecipeRow[]; doughballWeightOz?: number };

export const PRE_POST_TUNNEL_DEFAULT_MIN = 2.5;
export const MACHINE_TIME_DEFAULTS = {
  mixerLowSec: 330,
  mixerHighSec: 180,
  hopperSec: 70,
} as const;

export const DEFAULT_VALUES: FormValues = {
  casesNeeded: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  approxLineSpeed: 0,
  freezerTime: 0,
  pizzasPerCase: 0,
  casesPerSkid: 0,
  casesPerLayer: 0,
  doughballsPerTray: 0,
  crustsPerStack: 0,
  doughBatchYield: 0,
  crustsPerCase: 0,
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  mixerLowSec: MACHINE_TIME_DEFAULTS.mixerLowSec,
  mixerHighSec: MACHINE_TIME_DEFAULTS.mixerHighSec,
  hopperSec: MACHINE_TIME_DEFAULTS.hopperSec,
  carryOverDone: false,
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  app1OzPerPizza: 0,
  app1BatchLbs: 0,
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Sticks: 0,
  pep1OzPerPizza: 0,
  pep1BatchLbs: 0,
  pep2Sticks: 0,
  pep2OzPerPizza: 0,
  pep2BatchLbs: 0,
  pep1Combined: true,
  pep1TypeB: "",
  pep2TypeB: "",
  pep1SticksB: 0,
  pep1OzPerPizzaB: 0,
  pep1BatchLbsB: 0,
  pep2SticksB: 0,
  pep2OzPerPizzaB: 0,
  pep2BatchLbsB: 0,
  app1Type: "",
  app2Type: "",
  app3Type: "",
  app4Type: "",
  pep1Type: "",
  pep2Type: "",
  dieType: "",
  allergen: "none",
  doughRecipeName: "",
  targetDoughballWeight: 0,
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
  cartoned: "cartoned",
  labelPosition: "",
  cartonsPerCase: 0,
  labelsPerRoll: 0,
  topLabelsPerRoll: 0,
  bottomLabelsPerRoll: 0,
  circles: "none",
  shipper: "",
  skidStacking: "",
  gripSheets: "none",
  slipSheets: "no",
  preTunnelMin: PRE_POST_TUNNEL_DEFAULT_MIN,
  postTunnelMin: PRE_POST_TUNNEL_DEFAULT_MIN,
  tempFreezerTime: 0,
  tempCrustsPerCycle: 0,
  tempCycleSpeed: 0,
};

// Single-select packaging configuration fields, shown in Setup → Packaging
// Settings and surfaced in the Packaging tab. circles are counted per pizza and
// shippers per case in the warehouse needs roll-up (grouped by selected value).
export const PACKAGING_FIELDS = [
  { name: "cartoned", label: "Packaging Type", options: ["cartoned", "labeled", "n-a"] },
  { name: "circles", label: "Circles", options: ["none", "microwave", "7in", "11in", "12in"] },
  { name: "shipper", label: "Shipper", options: ["costco", "12in", "11in", "7in", "edwardos"] },
  { name: "skidStacking", label: "Skid Stacking Style", options: ["lucia", "hannaford", "column"] },
  { name: "gripSheets", label: "Grip Sheets", options: ["none", "every other layer", "3rd and 5th"] },
  { name: "slipSheets", label: "Slip Sheets", options: ["yes", "no"] },
] as const;
export type PackagingFieldName = (typeof PACKAGING_FIELDS)[number]["name"];

// Packaging-type choices with their capitalized display labels. Replaces the old
// yes/no toggle. Legacy stored `yes`/`no` are migrated on load (see storage
// normalizePackagingFields): yes → cartoned, no → labeled.
export const PACKAGING_TYPE_OPTIONS = [
  { value: "cartoned", label: "Cartoned" },
  { value: "labeled", label: "Labeled" },
  { value: "n-a", label: "N/A" },
] as const;

// Label-position sub-choice, shown only when Packaging Type is Labeled.
export const LABEL_POSITION_OPTIONS = [
  { value: "top", label: "Top Label" },
  { value: "bottom", label: "Bottom Label" },
  { value: "both", label: "Both" },
] as const;

/** Display label for a stored labelPosition value ("" when unset/unknown). */
export function labelPositionLabel(val: string | undefined): string {
  const v = (val ?? "").trim().toLowerCase();
  return LABEL_POSITION_OPTIONS.find((o) => o.value === v)?.label ?? "";
}

/**
 * True when a run's Packaging Type counts as cartoned for the warehouse roll-up.
 * Accepts the new "cartoned" value AND legacy stored "yes" so old data (and the
 * mobile app, which still stores "yes") keeps working unchanged. "labeled" /
 * "n-a" / legacy "no" all contribute nothing.
 */
export function isCartonedValue(val: string | undefined): boolean {
  const v = (val ?? "").trim().toLowerCase();
  return v === "cartoned" || v === "yes";
}

export const CRUST_FIELDS = [
  "crustsPerCycle", "cycleSpeed", "speedAdjustment", "doughballsPerTray",
  "approxLineSpeed", "crustsPerStack", "crustsPerCase",
] as const;
export type CrustField = (typeof CRUST_FIELDS)[number];

export const PROGRESS_FIELDS = [
  "skidsCompleted", "casesOnCurrentSkid", "traysOnLine", "batchesReady",
] as const;

// Physical dough staging is arranged as three tray sections. These values are
// advisory only: traysOnLine remains one aggregate persisted counter because
// existing runs do not record which section holds each tray.
export const DOUGH_TRAY_SECTION_CAPACITY = 20;
export const DOUGH_TRAY_SECTION_COUNT = 3;
export const DOUGH_TRAY_ADVISORY_TOTAL =
  DOUGH_TRAY_SECTION_CAPACITY * DOUGH_TRAY_SECTION_COUNT;

export type Stoppage = {
  id: string;
  reason: string;
  startedAt: number;
  endedAt?: number;
  notes?: string;
  type?: "stop" | "pause" | "manual";
  /**
   * Pause-time line policy. A missing value is deliberately treated as `true`
   * so legacy/open records retain the safe "stop tunnel" behavior on reload.
   */
  stopTunnel?: boolean;
};

export type RunMeta = {
  id: string;
  brand: string;
  flavor: string;
  startedAt?: number;
  pausedAt?: number;
  /**
   * Identity of the currently-open pause stoppage. It prevents a resume or
   * policy decision from touching a different pause record created in the same
   * millisecond, and is cleared together with pausedAt on resume.
   */
  pausedStoppageId?: string;
  endedAt?: number;
  subTab?: "dough" | "crusts";
  notes?: string;
  actualCases?: number;
  wasteLbs?: number;
  gapType?: "switchover" | "break";
  gapNote?: string;
  stoppages?: Stoppage[];
  // True when this run was created by a multi-sheet schedule import. Re-importing
  // the schedule replaces imported runs on a given date (preserving manual runs
  // and any imported run already started/ended). Absent ⇒ manual run.
  imported?: boolean;
  // Last-write-wins stamp for the run's lifecycle/metadata (startedAt, pausedAt,
  // endedAt, stoppages, notes, …). Bumped by saveDayState whenever this run's
  // meta actually changed locally. Every merge point (web receive, mobile
  // receive, server run-list union) keeps the strictly-newer-stamped run object,
  // so a just-started run can't be clobbered back to "unstarted" by a stale
  // peer/server copy (e.g. a refresh moments after pressing Start, before the
  // push landed). Absent stamps fall back to the old remote-wins behavior.
  metaUpdatedAt?: number;
  // True when this run was AUTO-created as the day's placeholder (fresh device
  // sign-in, daily rollover) rather than by a user action (New Run / import /
  // schedule pull-up). While such a run is still pristine (blank brand/flavor/
  // notes, never started, all-default values) it is LOCAL-ONLY: it is excluded
  // from every sync push and dropped on receive once the shared day has real
  // runs — otherwise every fresh device that signs in mid-day adds a blank
  // "Unnamed Run" to everyone's list via the additive union. The flag is
  // stripped at the push boundary, so it never travels over the wire; the
  // moment the run gains any data it stops being pristine and syncs normally.
  seeded?: boolean;
};

// Shift prep phase: covers the window before production starts (e.g. 6–7 AM).
// Synced in day-state so all tablets see live prep progress.
export type PrepPhase = {
  // When "Start Prep" was pressed (ms epoch). Once set, never cleared.
  prepStartedAt: number | null;
  // Dough batches completed during prep (increments only).
  prepBatchesDough: number;
  // Sauce batches completed during prep (increments only).
  prepBatchesSauce: number;
  // True once prep batches have been carried into the run's batchesReady /
  // sauceMade. Prevents double-apply on subsequent syncs or re-renders.
  prepCarriedOver: boolean;
  // Run ID that triggered the late-run handoff reset (when pressDone fires with
  // a next run waiting). Used to ensure the reset fires exactly once per run
  // regardless of which tab is active or whether the component remounts.
  prepHandoffFromRunId?: string;
};

export type DayState = {
  runs: RunMeta[];
  currentIndex: number;
  date?: string;
  shiftNotes?: string;
  runToTime?: string;
  resetAt?: number;
  // Temporary ingredient substitutions overlaid on ALL of today's runs (swap /
  // add / remove). Lives in synced day-state, NOT master data; auto-reverts at
  // the daily reset (freshDayState) or when manually cleared.
  substitutions?: IngredientSubstitution[];
  // Read-only timestamped trail of substitution add/clear actions for shift
  // handoffs and end-of-day review. Synced alongside substitutions; cleared at
  // the daily reset. Never feeds the calc — purely an audit log.
  substitutionLog?: SubstitutionLogEntry[];
  // Warehouse staging checklist: which per-run need rows have been pulled/staged.
  // Keyed by `${runId}::${label}__${unit}` (only checked items stored as true).
  // Lives in synced day-state, NOT master data; cleared at the daily reset.
  stagedItems?: Record<string, boolean>;
  // Shift prep phase (before production start). Synced so all tablets track
  // the same prep progress. Reset with the daily reset.
  prepPhase?: PrepPhase;
};

export type SyncPayload = {
  // Versioned wire contract. Complete snapshots are required for recovery and
  // first adoption. Partial snapshots may omit unchanged runValues; the server
  // preserves omitted values through its per-run LWW merge.
  syncVersion?: 1;
  completeness?: "complete" | "partial";
  baseSnapshotId?: string;
  dayState: { runs: RunMeta[]; shiftNotes?: string; runToTime?: string; resetAt?: number; date?: string; substitutions?: IngredientSubstitution[]; substitutionLog?: SubstitutionLogEntry[]; stagedItems?: Record<string, boolean>; prepPhase?: PrepPhase };
  runValues: Record<string, FormValues>;
  // Per-run monotonic edit timestamp (run id -> ms). Lets the apply path reject a
  // stale remote that would clobber a fresher local edit (the "click away and my
  // change vanished" lost-update). Only used to BLOCK overwriting strictly-newer
  // local values; absent/equal entries fall back to the prior accept behavior.
  runValuesUpdatedAt?: Record<string, number>;
  // Cases on skid + completed skids form one independently merged progress
  // register. Manual corrections advance correctionGeneration; automatic
  // tracking may only advance the generation it has already adopted.
  packagingProgress?: Record<string, PackagingProgress>;
  autoTrackCoordination?: {
    version: 1;
    runs: Record<string, Partial<Record<
      "case" | "tray-consume" | "tray-produce" | "batch-consume" | "batch-produce" | "hopper",
      {
        generation: string;
        sequence: number;
        nextDueAt: number;
        acceptedEventId?: string;
            acceptedRunValuesUpdatedAt?: number;
        updatedAt: number;
      }
    >>>;
  };
  brands?: string[];
  brandFlavors?: Record<string, string[]>;
  ingredientTypes?: string[];
  templates?: RunTemplate[];
  history?: HistoryDay[];
  pepTypes?: string[];
  dieTypes?: string[];
  circles?: string[];
  shipper?: string[];
  skidStacking?: string[];
  gripSheets?: string[];
  cheeseIngredients?: string[];
  doughIngredients?: string[];
  frontlineIngredients?: string[];
  mixIngredients?: string[];
  doughRecipeNames?: string[];
  doughRecipePresets?: Record<string, DoughRecipePreset>;
  frontlineRecipeNames?: string[];
  frontlineRecipePresets?: Record<string, RecipeRow[]>;
  cheeseRecipeNames?: string[];
  cheeseRecipePresets?: Record<string, RecipeRow[]>;
  mixRecipeNames?: string[];
  brandProfiles?: Record<string, Partial<FormValues>>;
  crustProfiles?: Record<string, Partial<FormValues>>;
  // Tombstones: ingredient/die names that were merged away. Synced so the
  // additive list-union below can't resurrect a merged-away name on any client.
  mergedAway?: string[];
  // Per-list deletion tombstones: names a user deleted from a master list,
  // keyed by list namespace (e.g. "brands", "pepTypes", or "flavor:<brandLower>"
  // for per-brand flavors). Synced so the additive list-union can't resurrect a
  // deleted item from a stale peer. Namespaced (unlike mergedAway) so deleting a
  // flavor "Pepperoni" never strips a pep-type "Pepperoni".
  deletedItems?: Record<string, string[]>;
  // Per-name delete/un-delete stamps (namespace → lowercased name → epoch ms).
  // The deletedItems union above means a deliberate RE-ADD (e.g. a spec import
  // registering a flavor the user once deleted) is resurrected as "deleted" by
  // the next sync pull. These stamps arbitrate: a name in deletedItems is only
  // treated as deleted when its delete stamp is >= its un-delete stamp (legacy
  // tombstones with no stamp count as 0, so any explicit un-delete wins, and a
  // later re-delete wins again). Merged per-name by MAX on both push and receive.
  deletedStamps?: Record<string, Record<string, number>>;
  undeletedStamps?: Record<string, Record<string, number>>;
};

export type PackagingProgress = {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  correctionGeneration: number;
  updatedAt: number;
  manualOverrideUntil: number;
};

export type HistoryDay = { date: string; runs: RunMeta[]; runValues: Record<string, FormValues> };
export type RunTemplate = { id: string; name: string; values: FormValues; brand?: string; flavor?: string; createdAt: string };

export const DAY_KEY = "run-calc-day";
export const HISTORY_KEY = "run-calc-history";
export const TEMPLATES_KEY = "run-calc-templates";
export const MAX_HISTORY_DAYS = 14;

// ── Master-data change history (local-only, NOT synced) ─────────────────────
// A capped log of recent edits to the manageable lists (merges, adds, removes,
// renames). Each entry snapshots the full local master-data state BEFORE the
// edit so it can be rolled back. Deliberately excluded from the sync payload —
// it's a per-device undo trail, and snapshots would blow the sync size limit.
export const CHANGE_HISTORY_KEY = "run-calc-change-history";
export const MAX_CHANGE_HISTORY = 20;

export type MasterDataChangeType = "merge" | "add" | "remove" | "rename" | "move";

export type MasterDataChange = {
  id: string;
  ts: number;
  type: MasterDataChangeType;
  description: string;
  /** Full local master-data snapshot taken BEFORE the edit (key → JSON value). */
  before: Record<string, string>;
};
export const MAX_TEMPLATES = 20;
export const MAX_RUNS = 30;

export const BRANDS_KEY = "run-calc-brands";
export const FLAVORS_KEY = "run-calc-flavors";
export const BRAND_FLAVORS_KEY = "run-calc-brand-flavors";
export const STOP_REASONS_KEY = "run-calc-stop-reasons";
export const SUPERVISOR_PIN_KEY = "run-calc-supervisor-pin";

export const DEFAULT_STOP_REASONS = [
  "Equipment jam", "Changeover", "Break", "Maintenance",
  "Quality hold", "Staffing", "Waiting on dough",
];
export const DEFAULT_SUPERVISOR_PIN = "1234";

// Factory-wide shift timing constants (stored as HH:MM strings in factory KV).
export const SHIFT_START_TIME_KEY = "run-calc-shift-start-time";
export const PRODUCTION_START_TIME_KEY = "run-calc-production-start-time";
export const DEFAULT_SHIFT_START_TIME = "06:00";
export const DEFAULT_PRODUCTION_START_TIME = "07:00";

export const INGREDIENT_TYPES_KEY = "run-calc-ingredient-types";
// Merge tombstones: names removed by an ingredient merge. Kept so live-sync's
// additive union can't bring a merged-away name back from a stale peer/server.
export const MERGED_AWAY_KEY = "run-calc-merged-away";
// Per-list deletion tombstones (see SyncPayload.deletedItems). Persisted + synced
// so a user-deleted master-list item can't be resurrected by live-sync's union.
export const DELETED_ITEMS_KEY = "run-calc-deleted-items";
// Per-name delete/un-delete stamps (see SyncPayload.deletedStamps). Persisted +
// synced so a deliberate re-add of a once-deleted name survives the tombstone
// union instead of being stripped right back out by the next sync pull.
export const DELETED_STAMPS_KEY = "run-calc-deleted-stamps";
export const UNDELETED_STAMPS_KEY = "run-calc-undeleted-stamps";
// Factory-specific defaults intentionally EMPTY since the 2026-07-03 full data
// purge: the user re-imports their own spec sheets, so a fresh install starts
// with no baked-in brands/ingredients/types. Generic app plumbing (stop
// reasons, packaging fields) keeps its defaults.
export const DEFAULT_INGREDIENT_TYPES: string[] = [];
export const PEP_TYPES_KEY = "run-calc-pep-types";
export const DEFAULT_PEP_TYPES: string[] = [];
// Legacy pep-type names that were renamed to the detailed standard names above.
// Applied on read + via one-time migration so saved selections keep their pre-made
// (no-batch) calc behavior and the deduped list shows only the detailed names.
export const PEP_TYPE_RENAMES: Record<string, string> = {
  "Pep - Cured": "Pepperoni Stick",
  "Pep - Natural": "Pepperoni Stick - NATURAL",
  // 2026-07-20: the Lowe's spec parse reduced "Pepperoni Stick - NATURAL
  // (Hormel - 24878)" to a bare qualifier; fold every observed variant back
  // onto the canonical name (prompt now forbids bare qualifiers).
  Natural: "Pepperoni Stick - NATURAL",
  NATURAL: "Pepperoni Stick - NATURAL",
  "NATURAL (Hormel - 24878)": "Pepperoni Stick - NATURAL",
};
// Near-duplicate applicator/cheese-ingredient names (typos, spacing, redundant
// suffixes, abbreviations, and word-order/blanched variants) collapsed onto a
// single canonical spelling. Genuinely different products are intentionally NOT
// mapped: all "FR" (fire roasted) variants, the three Parmesan forms (Grated /
// Shredded / plain), mozzarella fat levels (Part Skim / Skim / Whole) and the
// Extra Large Cut. Applied to saved lists (one-time) and to app-type / recipe
// ingredient names on read (idempotent, self-healing across sync).
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
// Pep-type names that were recategorized as applicator types and must be dropped
// from the pep-type list (still usable as an applicator type / cheese ingredient).
export const RETIRED_PEP_TYPES = ["Diced Pepperoni"];
// Variant die-type spellings folded to one canonical name. Imports created three
// separate entries for the same physical 11" die; map them so the picker lists a
// single option. Applied to the master list + saved dieType fields on every load.
export const DIE_TYPE_RENAMES: Record<string, string> = {
  "11": '11"',
  '11" dies': '11"',
  '12': '12"',
  '12" dies': '12"',
};
// Case-insensitive rename lookup: sheets write '11" Dies' / '11" dies' / '11"'
// for the same physical die; the map keys are lowercase, so always fold case
// before looking up. Returns the canonical name (or the input unchanged).
export function canonicalDieTypeName(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return t;
  return DIE_TYPE_RENAMES[t.toLowerCase()] ?? DIE_TYPE_RENAMES[t] ?? t;
}

export const DIE_TYPES_KEY = "run-calc-die-types";
export const DEFAULT_DIE_TYPES: string[] = [];
// User-editable packaging option lists (seeded once, then fully user-owned —
// add/remove with deletion tombstones, synced like die types). The defaults are
// the options that already worked before these lists became editable.
export const CIRCLES_KEY = "run-calc-circles";
export const DEFAULT_CIRCLES: string[] = ["none", "microwave", "7in", "11in", "12in"];
export const SHIPPER_KEY = "run-calc-shippers";
export const DEFAULT_SHIPPERS: string[] = ["costco", "12in", "11in", "7in", "edwardos"];
export const SKID_STACKING_KEY = "run-calc-skid-stacking";
export const DEFAULT_SKID_STACKING: string[] = ["lucia", "hannaford", "column"];
export const GRIP_SHEETS_KEY = "run-calc-grip-sheets";
export const DEFAULT_GRIP_SHEETS: string[] = ["none", "every other layer", "3rd and 5th"];
export const CHEESE_INGREDIENTS_KEY = "run-calc-cheese-ingredients";
export const DEFAULT_CHEESE_INGREDIENTS: string[] = [];
export const MIX_INGREDIENTS_KEY = "run-calc-mix-ingredients";
export const DEFAULT_MIX_INGREDIENTS: string[] = [];
export const DOUGH_INGREDIENTS_KEY = "run-calc-dough-ingredients";
export const DEFAULT_DOUGH_INGREDIENTS: string[] = [];
export const DOUGH_RECIPE_NAMES_KEY = "run-calc-dough-recipe-names";
export const DEFAULT_DOUGH_RECIPE_NAMES: string[] = [];
export const DOUGH_RECIPE_PRESETS_KEY = "run-calc-dough-recipe-presets";
export const FRONTLINE_INGREDIENTS_KEY = "run-calc-frontline-ingredients";
export const DEFAULT_FRONTLINE_INGREDIENTS: string[] = [];
export const FRONTLINE_RECIPE_NAMES_KEY = "run-calc-frontline-recipe-names";
export const DEFAULT_FRONTLINE_RECIPE_NAMES: string[] = [];
export const FRONTLINE_RECIPE_PRESETS_KEY = "run-calc-frontline-recipe-presets";
export const CHEESE_RECIPE_NAMES_KEY = "run-calc-cheese-recipe-names";
export const CHEESE_RECIPE_PRESETS_KEY = "run-calc-cheese-recipe-presets";
export const MIX_RECIPE_NAMES_KEY = "run-calc-mix-recipe-names";

export const RUN_KEY = (id: string) => `run-calc-run-${id}`;
export const PROFILE_KEY = (brand: string, flavor: string) =>
  `run-calc-profile-${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
export const CRUST_PROFILE_KEY = (brand: string, flavor: string) =>
  `run-calc-crust-profile-${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
