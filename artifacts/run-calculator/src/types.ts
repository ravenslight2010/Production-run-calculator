import * as z from "zod";
import type { IngredientSubstitution, SubstitutionLogEntry } from "@workspace/inventory-math";

export type { IngredientSubstitution, SubstitutionLogEntry };

export const formSchema = z.object({
  casesNeeded: z.coerce.number().min(0).default(384),
  crustsPerCycle: z.coerce.number().min(1).default(5),
  cycleSpeed: z.coerce.number().min(0.1).default(7.8),
  speedAdjustment: z.coerce.number().min(0.01).default(1.0),
  approxLineSpeed: z.coerce.number().min(0).default(39),
  freezerTime: z.coerce.number().min(0).default(15),
  pizzasPerCase: z.coerce.number().min(1).default(12),
  casesPerSkid: z.coerce.number().min(1).default(48),
  casesPerLayer: z.coerce.number().min(1).default(6),
  doughballsPerTray: z.coerce.number().min(1).default(24),
  crustsPerStack: z.coerce.number().min(1).default(24),
  doughBatchYield: z.coerce.number().min(1).default(620),
  crustsPerCase: z.coerce.number().min(1).default(12),
  skidsCompleted: z.coerce.number().min(0).default(5),
  casesOnCurrentSkid: z.coerce.number().min(0).default(6),
  traysOnLine: z.coerce.number().min(0).default(43),
  batchesReady: z.coerce.number().min(0).default(0),
  carryOverDone: z.boolean().default(false),
  sauceOzPerPizza: z.coerce.number().min(0).default(4),
  sauceBarrelLbs: z.coerce.number().min(0.1).default(450),
  app1OzPerPizza: z.coerce.number().min(0).default(0),
  app1BatchLbs: z.coerce.number().min(0.1).default(30),
  app2OzPerPizza: z.coerce.number().min(0).default(4),
  app2BatchLbs: z.coerce.number().min(0.1).default(55),
  app3OzPerPizza: z.coerce.number().min(0).default(0),
  app3BatchLbs: z.coerce.number().min(0.1).default(45),
  app4OzPerPizza: z.coerce.number().min(0).default(4),
  app4BatchLbs: z.coerce.number().min(0.1).default(55),
  pep1Sticks: z.coerce.number().min(0).default(0),
  pep1OzPerPizza: z.coerce.number().min(0).default(0),
  pep1BatchLbs: z.coerce.number().min(0.1).default(25),
  pep2Sticks: z.coerce.number().min(0).default(0),
  pep2OzPerPizza: z.coerce.number().min(0).default(0),
  pep2BatchLbs: z.coerce.number().min(0.1).default(25),
  app1Type: z.string().default(""),
  app2Type: z.string().default(""),
  app3Type: z.string().default(""),
  app4Type: z.string().default(""),
  pep1Type: z.string().default(""),
  pep2Type: z.string().default(""),
  dieType: z.string().default(""),
  allergen: z.string().default("none"),
  doughRecipeName: z.string().default(""),
  targetDoughballWeight: z.coerce.number().min(0).default(0),
  doughRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  app1CheeseRecipeName: z.string().default(""),
  app1CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  app2CheeseRecipeName: z.string().default(""),
  app2CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  app3CheeseRecipeName: z.string().default(""),
  app3CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  app4CheeseRecipeName: z.string().default(""),
  app4CheeseRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  frontlineRecipeName: z.string().default(""),
  frontlineRecipe: z.array(
    z.object({ ingredient: z.string().default(""), lbs: z.coerce.number().min(0).default(0) })
  ).default([]),
  cartoned: z.string().default("yes"),
  cartonsPerCase: z.coerce.number().min(0).default(0),
  circles: z.string().default("none"),
  shipper: z.string().default(""),
  skidStacking: z.string().default(""),
  gripSheets: z.string().default("none"),
  slipSheets: z.string().default("no"),
});

export type FormValues = z.infer<typeof formSchema>;

export type RecipeRow = { ingredient: string; lbs: number };
export type DoughRecipePreset = { rows: RecipeRow[] };

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
  pep1BatchLbs: 25,
  pep2Sticks: 0,
  pep2OzPerPizza: 0,
  pep2BatchLbs: 25,
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
  cartoned: "yes",
  cartonsPerCase: 0,
  circles: "none",
  shipper: "",
  skidStacking: "",
  gripSheets: "none",
  slipSheets: "no",
};

// Single-select packaging configuration fields, shown in Setup → Packaging
// Settings and surfaced in the Packaging tab. circles are counted per pizza and
// shippers per case in the warehouse needs roll-up (grouped by selected value).
export const PACKAGING_FIELDS = [
  { name: "cartoned", label: "Cartoned", options: ["yes", "no"] },
  { name: "circles", label: "Circles", options: ["none", "microwave", "7in", "11in", "12in"] },
  { name: "shipper", label: "Shipper", options: ["costco", "12in", "11in", "7in", "edwardos"] },
  { name: "skidStacking", label: "Skid Stacking Style", options: ["lucia", "hannaford", "column"] },
  { name: "gripSheets", label: "Grip Sheets", options: ["none", "every other layer", "3rd and 5th"] },
  { name: "slipSheets", label: "Slip Sheets", options: ["yes", "no"] },
] as const;
export type PackagingFieldName = (typeof PACKAGING_FIELDS)[number]["name"];

export const CRUST_FIELDS = [
  "crustsPerCycle", "cycleSpeed", "speedAdjustment", "doughballsPerTray",
  "approxLineSpeed", "crustsPerStack", "crustsPerCase",
] as const;
export type CrustField = (typeof CRUST_FIELDS)[number];

export const PROGRESS_FIELDS = [
  "skidsCompleted", "casesOnCurrentSkid", "traysOnLine", "batchesReady",
] as const;

export type Stoppage = {
  id: string;
  reason: string;
  startedAt: number;
  endedAt?: number;
  notes?: string;
  type?: "stop" | "pause" | "manual";
};

export type RunMeta = {
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
  stoppages?: Stoppage[];
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
};

export type SyncPayload = {
  dayState: { runs: RunMeta[]; shiftNotes?: string; runToTime?: string; resetAt?: number; date?: string; substitutions?: IngredientSubstitution[]; substitutionLog?: SubstitutionLogEntry[] };
  runValues: Record<string, FormValues>;
  brands?: string[];
  brandFlavors?: Record<string, string[]>;
  ingredientTypes?: string[];
  templates?: RunTemplate[];
  history?: HistoryDay[];
  pepTypes?: string[];
  dieTypes?: string[];
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

export type MasterDataChangeType = "merge" | "add" | "remove" | "rename";

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

export const INGREDIENT_TYPES_KEY = "run-calc-ingredient-types";
// Merge tombstones: names removed by an ingredient merge. Kept so live-sync's
// additive union can't bring a merged-away name back from a stale peer/server.
export const MERGED_AWAY_KEY = "run-calc-merged-away";
export const DEFAULT_INGREDIENT_TYPES = [
  "Cheese", "Pepperoni", "Sausage",
  "Mushroom", "Green Pepper", "Onion", "Black Olive", "Ham", "Bacon", "Jalapeño",
];
export const PEP_TYPES_KEY = "run-calc-pep-types";
export const DEFAULT_PEP_TYPES = ["Pepperoni Stick", "Pepperoni Stick - NATURAL"];
// Legacy pep-type names that were renamed to the detailed standard names above.
// Applied on read + via one-time migration so saved selections keep their pre-made
// (no-batch) calc behavior and the deduped list shows only the detailed names.
export const PEP_TYPE_RENAMES: Record<string, string> = {
  "Pep - Cured": "Pepperoni Stick",
  "Pep - Natural": "Pepperoni Stick - NATURAL",
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
export const DIE_TYPES_KEY = "run-calc-die-types";
export const DEFAULT_DIE_TYPES = ["7in", "9in", "11in", "12in", "Argus", "Mystic"];
export const CHEESE_INGREDIENTS_KEY = "run-calc-cheese-ingredients";
export const DEFAULT_CHEESE_INGREDIENTS = [
  "Mozzarella", "Cheddar", "Provolone", "Swiss", "Monterey Jack", "Parmesan",
];
export const MIX_INGREDIENTS_KEY = "run-calc-mix-ingredients";
export const DEFAULT_MIX_INGREDIENTS: string[] = [];
export const DOUGH_INGREDIENTS_KEY = "run-calc-dough-ingredients";
export const DEFAULT_DOUGH_INGREDIENTS = ["Flour", "Water", "Salt", "Yeast", "Oil", "Sugar"];
export const DOUGH_RECIPE_NAMES_KEY = "run-calc-dough-recipe-names";
export const DEFAULT_DOUGH_RECIPE_NAMES: string[] = [];
export const DOUGH_RECIPE_PRESETS_KEY = "run-calc-dough-recipe-presets";
export const FRONTLINE_INGREDIENTS_KEY = "run-calc-frontline-ingredients";
export const DEFAULT_FRONTLINE_INGREDIENTS = ["Flour", "Water", "Salt", "Sugar", "Oil", "Yeast"];
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
