import * as z from "zod";

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
  startingTrays: z.coerce.number().min(0).default(0),
  startingBatches: z.coerce.number().min(0).default(0),
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
  startingTrays: 0,
  startingBatches: 0,
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
};

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
};

export type SyncPayload = {
  dayState: { runs: RunMeta[]; shiftNotes?: string; runToTime?: string; resetAt?: number };
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
  brandProfiles?: Record<string, Partial<FormValues>>;
  crustProfiles?: Record<string, Partial<FormValues>>;
};

export type HistoryDay = { date: string; runs: RunMeta[]; runValues: Record<string, FormValues> };
export type RunTemplate = { id: string; name: string; values: FormValues; brand?: string; flavor?: string; createdAt: string };

export const DAY_KEY = "run-calc-day";
export const HISTORY_KEY = "run-calc-history";
export const TEMPLATES_KEY = "run-calc-templates";
export const MAX_HISTORY_DAYS = 14;
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
export const DEFAULT_INGREDIENT_TYPES = [
  "Cheese", "Pepperoni", "Sausage",
  "Mushroom", "Green Pepper", "Onion", "Black Olive", "Ham", "Bacon", "Jalapeño",
];
export const PEP_TYPES_KEY = "run-calc-pep-types";
export const DEFAULT_PEP_TYPES = ["Pep - Cured", "Pep - Natural"];
export const DIE_TYPES_KEY = "run-calc-die-types";
export const DEFAULT_DIE_TYPES = ["7in", "11in", "12in", "Argus", "Mystic"];
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
