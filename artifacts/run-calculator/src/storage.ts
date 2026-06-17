import {
  DEFAULT_VALUES,
  CRUST_FIELDS,
  PROGRESS_FIELDS,
  RUN_KEY,
  PROFILE_KEY,
  CRUST_PROFILE_KEY,
  DAY_KEY,
  HISTORY_KEY,
  TEMPLATES_KEY,
  BRAND_FLAVORS_KEY,
  BRANDS_KEY,
  FLAVORS_KEY,
  DOUGH_RECIPE_PRESETS_KEY,
  DOUGH_RECIPE_NAMES_KEY,
  DEFAULT_DOUGH_RECIPE_NAMES,
  DOUGH_INGREDIENTS_KEY,
  DEFAULT_DOUGH_INGREDIENTS,
  FRONTLINE_RECIPE_PRESETS_KEY,
  FRONTLINE_RECIPE_NAMES_KEY,
  DEFAULT_FRONTLINE_RECIPE_NAMES,
  FRONTLINE_INGREDIENTS_KEY,
  DEFAULT_FRONTLINE_INGREDIENTS,
  MIX_INGREDIENTS_KEY,
  DEFAULT_MIX_INGREDIENTS,
  CHEESE_RECIPE_PRESETS_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  MIX_RECIPE_NAMES_KEY,
  INGREDIENT_TYPES_KEY,
  DEFAULT_INGREDIENT_TYPES,
  PEP_TYPES_KEY,
  DEFAULT_PEP_TYPES,
  PEP_TYPE_RENAMES,
  RETIRED_PEP_TYPES,
  CHEESE_INGREDIENTS_KEY,
  DEFAULT_CHEESE_INGREDIENTS,
  DIE_TYPES_KEY,
  DEFAULT_DIE_TYPES,
  MAX_HISTORY_DAYS,
  type FormValues,
  type DayState,
  type RunMeta,
  type HistoryDay,
  type RunTemplate,
  type DoughRecipePreset,
  type RecipeRow,
  type CrustField,
} from "./types";
import { MIX_SEED } from "./mixSeed";
import {
  SPEC_BRANDS,
  SPEC_BRAND_FLAVORS,
  SPEC_APP_TYPES,
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
} from "./specSeed";
import { genId, todayStr } from "./utils";

export function loadList(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as string[];
  } catch {}
  return fallback;
}

export function saveList(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

export function loadBrandFlavors(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(BRAND_FLAVORS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
    const oldFlavors = loadList(FLAVORS_KEY, []);
    if (oldFlavors.length > 0) {
      const brands = loadList(BRANDS_KEY, []);
      const seeded: Record<string, string[]> = {};
      brands.forEach(b => { seeded[b] = [...oldFlavors]; });
      return seeded;
    }
  } catch {}
  return {};
}

export function saveBrandFlavors(bf: Record<string, string[]>): void {
  try { localStorage.setItem(BRAND_FLAVORS_KEY, JSON.stringify(bf)); } catch {}
}

// Fields that are run-specific and must never carry over via a brand/flavor profile
const PER_RUN_FIELDS: (keyof FormValues)[] = ["casesNeeded", "carryOverDone"];

// Rename legacy pep-type names ("Pep - Cured"/"Pep - Natural") to the detailed
// standard names on read, so saved profiles/runs keep their pre-made calc behavior
// and never show a stale name. Idempotent and self-healing across sync.
function normalizePepFields<T extends Record<string, unknown>>(o: T): T {
  for (const k of ["pep1Type", "pep2Type"] as const) {
    const val = o[k];
    if (typeof val === "string" && PEP_TYPE_RENAMES[val]) {
      (o as Record<string, unknown>)[k] = PEP_TYPE_RENAMES[val];
    }
  }
  return o;
}

export function loadProfile(brand: string, flavor: string): FormValues | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return null;
    const doughVals: Partial<FormValues> = JSON.parse(raw);
    let crustVals: Partial<FormValues> = {};
    try {
      const crustRaw = localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor));
      if (crustRaw) crustVals = JSON.parse(crustRaw);
    } catch {}
    const result = { ...DEFAULT_VALUES, ...doughVals, ...crustVals };
    // Strip per-run fields even if they were saved in an old profile
    PER_RUN_FIELDS.forEach((f) => { (result as Record<string, unknown>)[f] = DEFAULT_VALUES[f]; });
    return normalizePepFields(result as unknown as Record<string, unknown>) as unknown as FormValues;
  } catch {}
  return null;
}

/**
 * True when a profile object carries real recipe/applicator data (vs. a blank
 * default form). Used to (a) avoid letting a blank/default form clobber a
 * populated profile, and (b) decide whether a seeded profile may be repaired.
 */
function profileObjHasRealData(p: Record<string, unknown>): boolean {
  const arr = (x: unknown) => Array.isArray(x) && x.length > 0;
  if (arr(p.doughRecipe) || arr(p.frontlineRecipe)) return true;
  for (const k of ["app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe"]) {
    if (arr(p[k])) return true;
  }
  for (const k of [
    "app1Type", "app2Type", "app3Type", "app4Type",
    "pep1Type", "pep2Type", "dieType",
    "doughRecipeName", "frontlineRecipeName",
  ]) {
    const val = p[k];
    if (typeof val === "string" && val.trim()) return true;
  }
  return false;
}

/** True when the stored profile for brand+flavor has real recipe/applicator data. */
export function profileHasRealData(brand: string, flavor: string): boolean {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return false;
    return profileObjHasRealData(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return false;
  }
}

export function saveProfile(brand: string, flavor: string, values: FormValues): void {
  if (!brand && !flavor) return;
  // Never persist a blank/default form as a brand+flavor profile. A profile only
  // holds recipe/topping/template data; an all-empty form is always the result of
  // an autosave (or run switch / sync reset) firing before the profile has loaded
  // into the form. Writing it would zero out the seeded dough/sauce/cheese/toppings
  // for the selected brand+flavor — and unlike the previous guard, this refuses the
  // write even when the existing profile briefly looks empty (race during heal).
  if (!profileObjHasRealData(values as unknown as Record<string, unknown>)) return;
  const doughVals = { ...values } as Record<string, unknown>;
  CRUST_FIELDS.forEach((f) => delete doughVals[f]);
  PROGRESS_FIELDS.forEach((f) => delete doughVals[f]);
  PER_RUN_FIELDS.forEach((f) => delete doughVals[f]);
  try { localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(doughVals)); } catch {}
  const crustVals: Partial<Record<CrustField, unknown>> = {};
  CRUST_FIELDS.forEach((f) => { crustVals[f] = values[f]; });
  try { localStorage.setItem(CRUST_PROFILE_KEY(brand, flavor), JSON.stringify(crustVals)); } catch {}
}

export function freshDayState(): DayState {
  return { runs: [{ id: genId(), brand: "", flavor: "" }], currentIndex: 0, date: todayStr() };
}

export function loadDayState(): DayState {
  try {
    const raw = localStorage.getItem(DAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DayState;
      if (!parsed.date || parsed.date !== todayStr()) return freshDayState();
      const runs = parsed.runs.map((r: any) => ({
        ...r,
        brand: r.brand ?? (r.label ?? ""),
        flavor: r.flavor ?? "",
      }));
      return { ...parsed, runs, date: parsed.date ?? todayStr() };
    }
  } catch {}
  return freshDayState();
}

export function saveDayState(ds: DayState): void {
  try { localStorage.setItem(DAY_KEY, JSON.stringify({ ...ds, date: todayStr() })); } catch {}
}

export function loadHistory(): HistoryDay[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const history = JSON.parse(raw) as HistoryDay[];
      for (const day of history) {
        for (const vals of Object.values(day.runValues ?? {})) {
          normalizePepFields(vals as unknown as Record<string, unknown>);
        }
      }
      return history;
    }
  } catch {}
  return [];
}

export function archiveDayToHistory(ds: DayState, date: string): void {
  try {
    const history = loadHistory().filter(h => h.date !== date);
    const runValues: Record<string, FormValues> = {};
    for (const run of ds.runs) {
      const raw = localStorage.getItem(RUN_KEY(run.id));
      if (raw) runValues[run.id] = JSON.parse(raw);
    }
    const entry: HistoryDay = { date, runs: ds.runs, runValues };
    const trimmed = [entry, ...history].slice(0, MAX_HISTORY_DAYS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function loadRunValues(id: string): FormValues {
  try {
    const raw = localStorage.getItem(RUN_KEY(id));
    if (raw) return normalizePepFields({ ...DEFAULT_VALUES, ...JSON.parse(raw) } as unknown as Record<string, unknown>) as unknown as FormValues;
  } catch {}
  return DEFAULT_VALUES;
}

export function saveRunValues(id: string, values: FormValues): void {
  try { localStorage.setItem(RUN_KEY(id), JSON.stringify(values)); } catch {}
}

export function loadTemplates(): RunTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw) {
      const templates = JSON.parse(raw) as RunTemplate[];
      for (const t of templates) {
        if (t.values) normalizePepFields(t.values as unknown as Record<string, unknown>);
      }
      return templates;
    }
  } catch {}
  return [];
}

export function saveTemplates(t: RunTemplate[]): void {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t)); } catch {}
}

export function loadDoughRecipePresets(): Record<string, DoughRecipePreset> {
  try { return JSON.parse(localStorage.getItem(DOUGH_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, DoughRecipePreset>; } catch { return {}; }
}
export function saveDoughRecipePresets(p: Record<string, DoughRecipePreset>): void {
  try { localStorage.setItem(DOUGH_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
}

export function loadFrontlineRecipePresets(): Record<string, RecipeRow[]> {
  try { return JSON.parse(localStorage.getItem(FRONTLINE_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, RecipeRow[]>; } catch { return {}; }
}
export function saveFrontlineRecipePresets(p: Record<string, RecipeRow[]>): void {
  try { localStorage.setItem(FRONTLINE_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
}

export function loadCheeseRecipePresets(): Record<string, RecipeRow[]> {
  try { return JSON.parse(localStorage.getItem(CHEESE_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, RecipeRow[]>; } catch { return {}; }
}
export function saveCheeseRecipePresets(p: Record<string, RecipeRow[]>): void {
  try { localStorage.setItem(CHEESE_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
}

const MIX_SEED_KEY = "run-calc-mix-seed-v13";
const MIX_SEED_V14_KEY = "run-calc-mix-seed-v14";
const MIX_SEED_V15_KEY = "run-calc-mix-seed-v15";

export const SEED_MIX_RECIPE_NAMES = new Set(MIX_SEED.mixRecipeNames);

export const STALE_BRANDS = [
  "Bobos","Lowes","Lucias","Morming Melts",
  "Lucia's / Craft","Lucia's / Morning Melts","Lucia's / Pinsa",
];

const STALE_LUCIA_FLAVORS = [
  "Morning Melts Americano","Morming Melts Italiano","Morning Melts Mexicano","Morning Melts Parisian",
  "Pinsa Margherita","Pinsa Spinach","Pinsa Tikka Masala",
  "SOB","Caribbean","Bratwurst","Bacon Cheeseburger","Alfredo Spinach","Red Hot","Chicken Club","Tikka Masala",
];

const STALE_RECIPE_NAMES = [
  "Bobos Deluxe","Bobos Breakfast",
  "Lowes 7in Red Fajita","Lowes 7in White Spin","Lowes Bacon Cheeseburger",
  "Lowes California","Lowes Caribbean","Lowes Chicken Club","Lowes Grilled Vegetable",
  "Lowes Red Hot","Lowes Spinach","Lowes 11in White Spinach",
  "Lucias Morning Melts Americano","Lucias Morming Melts Italiano","Lucias Morning Melts Mexicano","Lucias Morning Melts Parisian",
  "Lucias Pinsa Margherita","Lucias Pinsa Spinach","Lucias Pinsa Tikka Masala",
  "Lucias Buffalo Chicken","Lucias Supreme",
  "Morning Melts Americano (old)","Morming Melts Italiano",
];

const STALE_INGREDIENTS = [
  "Bacon",
  "Bacon - NATURAL / tri meats tm3514u or / c&f 061anub40",
  "Bacon / (Tri Meats tm3514u or c&fb 061anub40)",
  "Bacon / Tri Meats tm3514u or / c&f 001anub40",
  "Bacon / Tri Meats tm3514u or / c&f 061anub40",
  "Bacon / Tri Meats tm3514u or c&f 001anub40",
  "Bacon, NATURAL / Tri Meats tm3514u or / c&f 061anub40",
  "Bacon, NATURAL / Tri Meats tm3514u or c&f 061anub40",
  "Bacon, NATURAL / tri meats tm3514u or / c&f 061anub40",
  "Chicken, Diced / House of Raeford 28501 or / c&f 001mpdc40",
  "Chicken, Diced / c&f - 001mpdc40 or / House of Raeford - 28501",
  "Chicken, Diced / c&f - 001mpdc40 or House of Raeford - 28501",
  "Diced Chicken / (C&F 0001mpdc40 or House of Raeford 28501)",
  "Diced Chicken / c&f 001mpdc40 or / House of Raeford 28501",
];

const PEP_TAXONOMY_MIGRATION_KEY = "run-calc-pep-taxonomy-v1";

// One-time taxonomy fix:
//  • Pep types list: rename legacy names → detailed standard names, drop retired
//    names ("Diced Pepperoni" — now an applicator type), ensure defaults present.
//  • Applicator (ingredient) types list: add "Diced Pepperoni".
// Pep references inside saved profiles/runs/templates/history are normalized on
// read (see normalizePepFields), so this only repairs the manageable lists.
export function applyPepTaxonomyMigrationIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(PEP_TAXONOMY_MIGRATION_KEY)) return;
  try {
    const savedPep = loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES);
    const cleanedPep = savedPep
      .map(t => PEP_TYPE_RENAMES[t] ?? t)
      .filter(t => !RETIRED_PEP_TYPES.includes(t));
    const mergedPep = [...new Set([...DEFAULT_PEP_TYPES, ...cleanedPep])].sort((a, b) => a.localeCompare(b));
    saveList(PEP_TYPES_KEY, mergedPep);

    const savedApp = loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES);
    for (const name of RETIRED_PEP_TYPES) {
      if (!savedApp.some(t => t.toLowerCase() === name.toLowerCase())) savedApp.push(name);
    }
    saveList(INGREDIENT_TYPES_KEY, [...new Set(savedApp)].sort((a, b) => a.localeCompare(b)));

    localStorage.setItem(PEP_TAXONOMY_MIGRATION_KEY, "1");
  } catch {}
}

export function applyMixSeedIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(MIX_SEED_KEY)) return;
  try {
    // ── Purge stale data from previous seed versions ──
    localStorage.removeItem("run-calc-v1");

    const cleanedBrands = loadList(BRANDS_KEY, []).filter(b => !STALE_BRANDS.includes(b));
    saveList(BRANDS_KEY, cleanedBrands);

    const cleanedBF = loadBrandFlavors();
    for (const b of STALE_BRANDS) delete cleanedBF[b];
    if (cleanedBF["Lucia's"]) {
      cleanedBF["Lucia's"] = cleanedBF["Lucia's"].filter(f => !STALE_LUCIA_FLAVORS.includes(f));
    }
    saveBrandFlavors(cleanedBF);

    // Move misplaced topping recipe names from frontline (sauce) → mix
    const allMixNames = MIX_SEED.mixRecipeNames;
    const existingFrontlineNames = loadList(FRONTLINE_RECIPE_NAMES_KEY, []);
    const migratedToMix = existingFrontlineNames.filter(n => allMixNames.includes(n));
    const remainingFrontline = existingFrontlineNames.filter(n => !allMixNames.includes(n) && !STALE_RECIPE_NAMES.includes(n));
    saveList(FRONTLINE_RECIPE_NAMES_KEY, remainingFrontline);

    const existingMixNames = loadList(MIX_RECIPE_NAMES_KEY, []);
    const mergedMixNames = [...new Set([...existingMixNames, ...migratedToMix, ...allMixNames])].sort((a, b) => a.localeCompare(b));
    saveList(MIX_RECIPE_NAMES_KEY, mergedMixNames);

    const cleanedPresets = loadFrontlineRecipePresets();
    for (const n of STALE_RECIPE_NAMES) delete cleanedPresets[n];
    for (const n of allMixNames) delete cleanedPresets[n];
    saveFrontlineRecipePresets(cleanedPresets);

    const cleanedIngredients = loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS)
      .filter(i => !STALE_INGREDIENTS.includes(i));
    saveList(FRONTLINE_INGREDIENTS_KEY, cleanedIngredients);

    // ── Scrub mix recipe names from all stored brand profiles ──
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("run-calc-profile-")) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const prof = JSON.parse(raw) as Record<string, unknown>;
        if (prof.frontlineRecipeName && SEED_MIX_RECIPE_NAMES.has(prof.frontlineRecipeName as string)) {
          delete prof.frontlineRecipeName;
          delete prof.frontlineRecipe;
          localStorage.setItem(key, JSON.stringify(prof));
        }
      } catch {}
    }

    // ── Merge seed data ──
    const existingBrands = loadList(BRANDS_KEY, []);
    const mergedBrands = [...new Set([...existingBrands, ...MIX_SEED.brands])].sort();
    saveList(BRANDS_KEY, mergedBrands);

    const existingBF = loadBrandFlavors();
    const mergedBF: Record<string, string[]> = { ...existingBF };
    for (const [brand, flavors] of Object.entries(MIX_SEED.brandFlavors)) {
      if (!mergedBF[brand]) mergedBF[brand] = [];
      mergedBF[brand] = [...new Set([...mergedBF[brand], ...flavors])];
    }
    saveBrandFlavors(mergedBF);

    // Topping ingredients go into Mix (applicator), NOT into Sauce/Frontline
    const existingMixIng = loadList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS);
    const mergedMixIng = [...new Set([...existingMixIng, ...MIX_SEED.frontlineIngredients])].sort((a, b) => a.localeCompare(b));
    saveList(MIX_INGREDIENTS_KEY, mergedMixIng);

    localStorage.setItem(MIX_SEED_KEY, "1");
  } catch {}
}

/** v15: same as v14 but with expanded MIX_SEED.frontlineIngredients list (adds preset variant names) */
export function applyMixSeedV15IfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(MIX_SEED_V15_KEY)) return;
  try {
    const toppingSet = new Set(MIX_SEED.frontlineIngredients);

    const currentFrontline = loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS);
    const cleanedFrontline = currentFrontline.filter(i => !toppingSet.has(i));
    saveList(FRONTLINE_INGREDIENTS_KEY, cleanedFrontline);

    const currentMix = loadList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS);
    const mergedMix = [...new Set([...currentMix, ...MIX_SEED.frontlineIngredients])].sort((a, b) => a.localeCompare(b));
    saveList(MIX_INGREDIENTS_KEY, mergedMix);

    localStorage.setItem(MIX_SEED_V15_KEY, "1");
  } catch {}
}

/** v14: move topping ingredients that were mis-seeded into Sauce → into Mix */
export function applyMixSeedV14IfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(MIX_SEED_V14_KEY)) return;
  try {
    const toppingSet = new Set(MIX_SEED.frontlineIngredients);

    // Remove toppings from the Sauce/Frontline ingredient list
    const currentFrontline = loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS);
    const cleanedFrontline = currentFrontline.filter(i => !toppingSet.has(i));
    saveList(FRONTLINE_INGREDIENTS_KEY, cleanedFrontline);

    // Merge toppings into the Mix ingredient list
    const currentMix = loadList(MIX_INGREDIENTS_KEY, DEFAULT_MIX_INGREDIENTS);
    const mergedMix = [...new Set([...currentMix, ...MIX_SEED.frontlineIngredients])].sort((a, b) => a.localeCompare(b));
    saveList(MIX_INGREDIENTS_KEY, mergedMix);

    localStorage.setItem(MIX_SEED_V14_KEY, "1");
  } catch {}
}

const SPEC_PROFILES_SEED_KEY = "run-calc-spec-profiles-v3";

/** Case-insensitive merge that keeps the existing label when a duplicate appears. */
function mergeListInsensitive(existing: string[], additions: string[]): string[] {
  const seen = new Map<string, string>();
  for (const x of existing) seen.set(x.toLowerCase(), x);
  for (const a of additions) {
    const k = a.toLowerCase();
    if (!seen.has(k)) seen.set(k, a);
  }
  return [...seen.values()];
}

/**
 * Seed brand/flavor PRESETS imported from the pizza spec spreadsheets. Adds the
 * new brands, flavors, applicator/pepperoni/cheese option lists, and writes a
 * stored profile per brand+flavor (only when one does not already exist, so user
 * edits are never clobbered). Runs once, guarded by a version marker.
 */
export function applySpecProfilesSeedIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(SPEC_PROFILES_SEED_KEY)) return;
  try {
    const mergedBrands = mergeListInsensitive(
      loadList(BRANDS_KEY, []),
      SPEC_BRANDS,
    ).sort();
    saveList(BRANDS_KEY, mergedBrands);

    const bf = loadBrandFlavors();
    for (const [brand, flavors] of Object.entries(SPEC_BRAND_FLAVORS)) {
      bf[brand] = mergeListInsensitive(bf[brand] ?? [], flavors);
    }
    saveBrandFlavors(bf);

    saveList(
      INGREDIENT_TYPES_KEY,
      mergeListInsensitive(
        loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES),
        SPEC_APP_TYPES,
      ).sort((a, b) => a.localeCompare(b)),
    );
    saveList(
      PEP_TYPES_KEY,
      mergeListInsensitive(
        loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES),
        SPEC_PEP_TYPES,
      ),
    );
    saveList(
      CHEESE_INGREDIENTS_KEY,
      mergeListInsensitive(
        loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS),
        SPEC_CHEESE_INGREDIENTS,
      ).sort((a, b) => a.localeCompare(b)),
    );

    for (const p of SPEC_PROFILES) {
      const key = PROFILE_KEY(p.brand, p.flavor);
      const existingRaw = localStorage.getItem(key);
      if (existingRaw) {
        // Keep profiles that hold real user data; recreate ones that are
        // missing, blank/clobbered, or unparseable (corrupt → fall through).
        try {
          const parsed = JSON.parse(existingRaw) as Record<string, unknown>;
          if (profileObjHasRealData(parsed)) continue;
        } catch {
          // unparseable: fall through and recreate from seed
        }
      }
      const die = SPEC_DIE_TYPES[key];
      const values = die ? { ...p.values, dieType: die } : p.values;
      localStorage.setItem(key, JSON.stringify(values));
    }

    localStorage.setItem(SPEC_PROFILES_SEED_KEY, "1");
  } catch {}
}

const DIE_TYPES_SEED_KEY = "run-calc-die-types-v3";

/**
 * Backfill the die size onto existing brand/flavor profiles, sourced from the
 * CRUST field of the pizza spec sheets. Only fills a profile when its dieType is
 * empty, so user edits are never clobbered. Also ensures the die-type option
 * list includes any newly seeded sizes (e.g. "9in"). Runs once, guarded by a
 * version marker.
 */
export function applyDieTypesSeedIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(DIE_TYPES_SEED_KEY)) return;
  try {
    saveList(
      DIE_TYPES_KEY,
      mergeListInsensitive(
        loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES),
        DEFAULT_DIE_TYPES,
      ),
    );

    for (const [key, die] of Object.entries(SPEC_DIE_TYPES)) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let values: Record<string, unknown>;
      try {
        values = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      const cur = values.dieType;
      if (typeof cur === "string" && cur.trim()) continue;
      values.dieType = die;
      localStorage.setItem(key, JSON.stringify(values));
    }

    localStorage.setItem(DIE_TYPES_SEED_KEY, "1");
  } catch {}
}

const DOUGH_SPECS_SEED_KEY = "run-calc-dough-specs-v3";

/**
 * Seed dough RECIPES + SPECS imported from the dough mixing-procedure sheets.
 * Tier 1 adds every dough recipe to the recipe library (presets, names,
 * ingredient list). Tier 2 ties an unambiguous brand+flavor to its dough recipe
 * and doughball weight on the stored profile — only when the profile has no
 * dough recipe yet, so user edits are never clobbered. Yield and per-tray counts
 * are auto-formulated by the app and are intentionally not seeded. Runs once,
 * guarded by a version marker.
 */
export function applyDoughSpecsSeedIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(DOUGH_SPECS_SEED_KEY)) return;
  try {
    // ── Tier 1: dough recipe library ──
    const presets = loadDoughRecipePresets();
    for (const [name, rows] of Object.entries(DOUGH_RECIPES)) {
      if (!presets[name]) presets[name] = { rows: rows.map(r => ({ ...r })) };
    }
    saveDoughRecipePresets(presets);

    saveList(
      DOUGH_RECIPE_NAMES_KEY,
      mergeListInsensitive(
        loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES),
        Object.keys(DOUGH_RECIPES),
      ).sort((a, b) => a.localeCompare(b)),
    );

    const allDoughIngredients = [
      ...new Set(
        Object.values(DOUGH_RECIPES).flatMap(rows => rows.map(r => r.ingredient)),
      ),
    ];
    saveList(
      DOUGH_INGREDIENTS_KEY,
      mergeListInsensitive(
        loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS),
        allDoughIngredients,
      ).sort((a, b) => a.localeCompare(b)),
    );

    // ── Tier 2: unambiguous brand → dough ties on stored profiles ──
    const bf = loadBrandFlavors();
    for (const spec of DOUGH_BRAND_SPECS) {
      const rows = DOUGH_RECIPES[spec.recipe];
      if (!rows) continue;
      const flavors = spec.flavor ? [spec.flavor] : (bf[spec.brand] ?? []);
      for (const flavor of flavors) {
        const key = PROFILE_KEY(spec.brand, flavor);
        let prof: Record<string, unknown> = {};
        try {
          prof = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
        } catch {
          prof = {};
        }
        const existing = prof.doughRecipe as unknown[] | undefined;
        if (Array.isArray(existing) && existing.length > 0) continue;
        prof.doughRecipeName = spec.recipe;
        prof.doughRecipe = rows.map(r => ({ ...r }));
        prof.targetDoughballWeight = spec.oz;
        localStorage.setItem(key, JSON.stringify(prof));
      }
    }

    localStorage.setItem(DOUGH_SPECS_SEED_KEY, "1");
  } catch {}
}

const SAUCE_SPECS_SEED_KEY = "run-calc-sauce-specs-v3";

/**
 * Seed sauce RECIPES + SPECS imported from the sauce procedure sheets. The app
 * stores sauce recipes under the "frontline" recipe system (the UI labels it
 * "Sauce Recipe"). Tier 1 adds every sauce recipe to that library (presets,
 * names, ingredient list). Tier 2 ties an unambiguous brand+flavor to its sauce
 * recipe on the stored profile — only when the profile has no sauce recipe yet,
 * so user edits are never clobbered. Oz-per-pizza usage is not in the sheets and
 * is intentionally not seeded. Runs once, guarded by a version marker.
 */
export function applySauceSpecsSeedIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(SAUCE_SPECS_SEED_KEY)) return;
  try {
    // ── Tier 1: sauce (frontline) recipe library ──
    const presets = loadFrontlineRecipePresets();
    for (const [name, rows] of Object.entries(SAUCE_RECIPES)) {
      if (!presets[name]) presets[name] = rows.map(r => ({ ...r }));
    }
    saveFrontlineRecipePresets(presets);

    saveList(
      FRONTLINE_RECIPE_NAMES_KEY,
      mergeListInsensitive(
        loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES),
        Object.keys(SAUCE_RECIPES),
      ).sort((a, b) => a.localeCompare(b)),
    );

    const allSauceIngredients = [
      ...new Set(
        Object.values(SAUCE_RECIPES).flatMap(rows => rows.map(r => r.ingredient)),
      ),
    ];
    saveList(
      FRONTLINE_INGREDIENTS_KEY,
      mergeListInsensitive(
        loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS),
        allSauceIngredients,
      ).sort((a, b) => a.localeCompare(b)),
    );

    // ── Tier 2: unambiguous brand → sauce ties on stored profiles ──
    const bf = loadBrandFlavors();
    for (const spec of SAUCE_BRAND_SPECS) {
      const rows = SAUCE_RECIPES[spec.recipe];
      if (!rows) continue;
      const flavors = spec.flavor ? [spec.flavor] : (bf[spec.brand] ?? []);
      for (const flavor of flavors) {
        const key = PROFILE_KEY(spec.brand, flavor);
        let prof: Record<string, unknown> = {};
        try {
          prof = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
        } catch {
          prof = {};
        }
        const existing = prof.frontlineRecipe as unknown[] | undefined;
        if (Array.isArray(existing) && existing.length > 0) continue;
        prof.frontlineRecipeName = spec.recipe;
        prof.frontlineRecipe = rows.map(r => ({ ...r }));
        localStorage.setItem(key, JSON.stringify(prof));
      }
    }

    localStorage.setItem(SAUCE_SPECS_SEED_KEY, "1");
  } catch {}
}

const CHEESE_SPECS_SEED_KEY = "run-calc-cheese-specs-v3";

/**
 * Seed cheese RECIPES + SPECS imported from the cheese-mix sheets. Tier 1 adds
 * every cheese mix to the cheese recipe library (presets, names, ingredient
 * list) so each mix is selectable in the App 1-4 cheese dropdowns. Tier 2 ties
 * a brand+flavor to its specific mix on the stored profile, on the cheese
 * applicator slot the sheet specifies (app 1-4) — only when that slot has no
 * cheese recipe yet, so user edits are never clobbered. Batch totals are
 * auto-summed from the recipe and are not seeded. Runs once, guarded by a
 * version marker.
 */
export function applyCheeseSpecsSeedIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(CHEESE_SPECS_SEED_KEY)) return;
  try {
    // ── Tier 1: cheese recipe library ──
    const presets = loadCheeseRecipePresets();
    for (const [name, rows] of Object.entries(CHEESE_RECIPES)) {
      if (!presets[name]) presets[name] = rows.map(r => ({ ...r }));
    }
    saveCheeseRecipePresets(presets);

    saveList(
      CHEESE_RECIPE_NAMES_KEY,
      mergeListInsensitive(
        loadList(CHEESE_RECIPE_NAMES_KEY, []),
        Object.keys(CHEESE_RECIPES),
      ).sort((a, b) => a.localeCompare(b)),
    );

    const allCheeseIngredients = [
      ...new Set(
        Object.values(CHEESE_RECIPES).flatMap(rows => rows.map(r => r.ingredient)),
      ),
    ];
    saveList(
      CHEESE_INGREDIENTS_KEY,
      mergeListInsensitive(
        loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS),
        allCheeseIngredients,
      ).sort((a, b) => a.localeCompare(b)),
    );

    // ── Tier 2: brand+flavor → cheese mix ties on stored profiles ──
    const bf = loadBrandFlavors();
    for (const spec of CHEESE_BRAND_SPECS) {
      const rows = CHEESE_RECIPES[spec.recipe];
      if (!rows) continue;
      const slot = spec.app >= 1 && spec.app <= 4 ? spec.app : 1;
      const nameField = `app${slot}CheeseRecipeName`;
      const recipeField = `app${slot}CheeseRecipe`;
      const flavors = spec.flavor ? [spec.flavor] : (bf[spec.brand] ?? []);
      for (const flavor of flavors) {
        const key = PROFILE_KEY(spec.brand, flavor);
        let prof: Record<string, unknown> = {};
        try {
          prof = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
        } catch {
          prof = {};
        }
        const existing = prof[recipeField] as unknown[] | undefined;
        if (Array.isArray(existing) && existing.length > 0) continue;
        prof[nameField] = spec.recipe;
        prof[recipeField] = rows.map(r => ({ ...r }));
        localStorage.setItem(key, JSON.stringify(prof));
      }
    }

    localStorage.setItem(CHEESE_SPECS_SEED_KEY, "1");
  } catch {}
}
