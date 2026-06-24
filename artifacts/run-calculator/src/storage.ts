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
  MERGED_AWAY_KEY,
  DELETED_ITEMS_KEY,
  PEP_TYPES_KEY,
  DEFAULT_PEP_TYPES,
  PEP_TYPE_RENAMES,
  INGREDIENT_RENAMES,
  RETIRED_PEP_TYPES,
  CHEESE_INGREDIENTS_KEY,
  DEFAULT_CHEESE_INGREDIENTS,
  DIE_TYPES_KEY,
  DEFAULT_DIE_TYPES,
  MAX_HISTORY_DAYS,
  CHANGE_HISTORY_KEY,
  MAX_CHANGE_HISTORY,
  type MasterDataChange,
  type MasterDataChangeType,
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
  type MergeMap,
  mergeList as mergeListNames,
  mergeSettingsObject,
  mergeRecipePresetMap,
} from "./mergeIngredients";
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
import { recipeTargets } from "@workspace/spec-import";
import type {
  ParsedSpecImport,
  ParsedRecipe,
  SpecImportAlias,
} from "@workspace/spec-import";

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

// ── Merge tombstones ────────────────────────────────────────────────────────
// Names that an ingredient merge removed. Persisted + synced so the additive
// list-union in live-sync can't resurrect a merged-away name from a stale peer.
export function loadMergedAway(): string[] {
  return loadList(MERGED_AWAY_KEY, []);
}
export function saveMergedAway(list: string[]): void {
  saveList(MERGED_AWAY_KEY, [...new Set(list)]);
}
/** Drop names in the tombstone set (case-insensitive) from a list. */
export function dropMergedAway(list: string[], tomb: Set<string>): string[] {
  if (tomb.size === 0) return list;
  return list.filter((n) => !tomb.has(n.trim().toLowerCase()));
}
/** Remove a name from the tombstone so it can be re-added/resurrected later. */
export function clearMergedAway(name: string): void {
  const v = name.trim().toLowerCase();
  if (!v) return;
  const next = loadMergedAway().filter((n) => n.trim().toLowerCase() !== v);
  saveMergedAway(next);
}

// ── Per-list deletion tombstones ────────────────────────────────────────────
// A user-deleted master-list item removed locally would be resurrected by the
// additive list-union in live-sync from a stale peer. Record the deletion under
// the list's namespace so the union can strip it. Namespaced (unlike the flat
// mergedAway set) so deleting a flavor "Pepperoni" never strips a pep-type of the
// same name. Flavor namespace is `flavor:<brandLower>`.
export function flavorNamespace(brand: string): string {
  return `flavor:${brand.trim().toLowerCase()}`;
}
export function loadDeletedItems(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(DELETED_ITEMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {};
}
export function saveDeletedItems(map: Record<string, string[]>): void {
  try { localStorage.setItem(DELETED_ITEMS_KEY, JSON.stringify(map)); } catch {}
}
/** Record a deletion of `name` from the list `namespace`. */
export function tombstoneDeleted(namespace: string, name: string): void {
  const v = name.trim().toLowerCase();
  if (!v) return;
  const map = loadDeletedItems();
  const cur = map[namespace] ?? [];
  if (cur.includes(v)) return;
  map[namespace] = [...cur, v];
  saveDeletedItems(map);
}
/** Un-tombstone `name` in `namespace` so a re-add sticks. */
export function clearDeleted(namespace: string, name: string): void {
  const v = name.trim().toLowerCase();
  if (!v) return;
  const map = loadDeletedItems();
  const cur = map[namespace];
  if (!cur || !cur.includes(v)) return;
  const next = cur.filter((n) => n !== v);
  if (next.length > 0) map[namespace] = next;
  else delete map[namespace];
  saveDeletedItems(map);
}
/** Union two deletedItems maps (case-insensitive within each namespace). */
export function unionDeletedItems(
  a: Record<string, string[]>,
  b: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ns, names] of Object.entries(a)) out[ns] = [...new Set(names.map((n) => n.trim().toLowerCase()))];
  if (b) {
    for (const [ns, names] of Object.entries(b)) {
      if (!Array.isArray(names)) continue;
      const set = new Set(out[ns] ?? []);
      for (const n of names) if (typeof n === "string") set.add(n.trim().toLowerCase());
      out[ns] = [...set];
    }
  }
  return out;
}
/** Drop names tombstoned under `namespace` from a list (case-insensitive). */
export function dropDeleted(list: string[], map: Record<string, string[]>, namespace: string): string[] {
  const tomb = map[namespace];
  if (!tomb || tomb.length === 0) return list;
  const set = new Set(tomb.map((n) => n.trim().toLowerCase()));
  return list.filter((n) => !set.has(n.trim().toLowerCase()));
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
  normalizeIngredientFields(o);
  return o;
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
// their canonical spelling on read, so saved profiles/runs/templates/history
// stay consistent with the deduped option lists. Idempotent and self-healing.
function normalizeIngredientFields(o: Record<string, unknown>): void {
  for (const k of ["app1Type", "app2Type", "app3Type", "app4Type"] as const) {
    const val = o[k];
    if (typeof val === "string" && INGREDIENT_RENAMES[val]) {
      o[k] = INGREDIENT_RENAMES[val];
    }
  }
  for (const k of RECIPE_FIELDS) {
    const arr = o[k];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        if (typeof r.ingredient === "string" && INGREDIENT_RENAMES[r.ingredient]) {
          r.ingredient = INGREDIENT_RENAMES[r.ingredient];
        }
      }
    }
  }
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
 * The RAW stored profile object for brand+flavor (dough + crust merged), WITHOUT
 * the DEFAULT_VALUES overlay loadProfile applies. Returns null when nothing is
 * saved for this brand+flavor. Used by the scheduled-recipe warning to tell a
 * missing profile apart from one that exists but carries no real recipe data.
 */
export function loadRawProfile(brand: string, flavor: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return null;
    const dough = JSON.parse(raw) as Record<string, unknown>;
    let crust: Record<string, unknown> = {};
    try {
      const crustRaw = localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor));
      if (crustRaw) crust = JSON.parse(crustRaw) as Record<string, unknown>;
    } catch {}
    return { ...dough, ...crust };
  } catch {
    return null;
  }
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
  return { runs: [{ id: genId(), brand: "", flavor: "" }], currentIndex: 0, date: todayStr(), substitutions: [], substitutionLog: [], stagedItems: {} };
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

const INGREDIENT_DEDUPE_MIGRATION_KEY = "run-calc-ingredient-dedupe-v2";

// One-time near-duplicate cleanup: rename app-type and cheese-ingredient names to
// their canonical spelling and drop the resulting duplicates (case-insensitive).
// Names inside saved profiles/runs/templates/history are renamed on read (see
// normalizeIngredientFields), so this only repairs the manageable option lists.
export function applyIngredientDedupeMigrationIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(INGREDIENT_DEDUPE_MIGRATION_KEY)) return;
  try {
    for (const key of [INGREDIENT_TYPES_KEY, CHEESE_INGREDIENTS_KEY]) {
      if (localStorage.getItem(key) === null) continue;
      const saved = loadList(key, []);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of saved) {
        const renamed = INGREDIENT_RENAMES[t] ?? t;
        const lk = renamed.toLowerCase();
        if (!seen.has(lk)) {
          seen.add(lk);
          out.push(renamed);
        }
      }
      saveList(key, out.sort((a, b) => a.localeCompare(b)));
    }
    localStorage.setItem(INGREDIENT_DEDUPE_MIGRATION_KEY, "1");
  } catch {}
}

// Persist a user-driven ingredient merge across every localStorage surface:
// master-data option lists, recipe presets (dough/sauce/cheese), brand + crust
// profiles, per-run values, templates, and history. Pure value rewriting lives
// in ./mergeIngredients; this only wires it to storage. Inventory stock is
// folded separately via the server merge endpoint. Callers reload the app after
// this so React state re-initializes from the rewritten localStorage and the
// merged lists get pushed to live-sync.
export function applyIngredientMerge(map: MergeMap): void {
  if (typeof localStorage === "undefined") return;
  if (Object.keys(map).length === 0) return;
  // Record the merged-away source names as tombstones so live-sync's additive
  // list-union can't bring them back from a stale peer/server. Never tombstone a
  // target (a source that maps to itself isn't a real source).
  const targets = new Set(Object.values(map).map((t) => t.trim().toLowerCase()));
  const sources = Object.keys(map).filter((s) => !targets.has(s.trim().toLowerCase()));
  if (sources.length > 0) saveMergedAway([...loadMergedAway(), ...sources]);
  // ── Flat master-data option lists. dieTypes is included so a merged die-type
  // name is removed from the selectable list (the dieType field is rewritten via
  // MERGE_NAME_FIELDS in mergeSettingsObject). ──
  const listKeys = [
    INGREDIENT_TYPES_KEY,
    PEP_TYPES_KEY,
    CHEESE_INGREDIENTS_KEY,
    DOUGH_INGREDIENTS_KEY,
    FRONTLINE_INGREDIENTS_KEY,
    MIX_INGREDIENTS_KEY,
    DIE_TYPES_KEY,
  ];
  for (const key of listKeys) {
    if (localStorage.getItem(key) === null) continue;
    const merged = mergeListNames(loadList(key, []), map).sort((a, b) => a.localeCompare(b));
    saveList(key, merged);
  }
  // ── Recipe presets ──
  try {
    const dough = loadDoughRecipePresets();
    const nextDough: Record<string, DoughRecipePreset> = {};
    for (const [name, preset] of Object.entries(dough)) {
      nextDough[name] = { ...preset, rows: mergeRecipePresetMap({ r: preset.rows ?? [] }, map).r };
    }
    saveDoughRecipePresets(nextDough);
  } catch {}
  try { saveFrontlineRecipePresets(mergeRecipePresetMap(loadFrontlineRecipePresets(), map)); } catch {}
  try { saveCheeseRecipePresets(mergeRecipePresetMap(loadCheeseRecipePresets(), map)); } catch {}
  // ── Templates ──
  try {
    const templates = loadTemplates().map((t) =>
      t.values ? { ...t, values: mergeSettingsObject(t.values as unknown as Record<string, unknown>, map) as unknown as typeof t.values } : t,
    );
    saveTemplates(templates);
  } catch {}
  // ── History ──
  try {
    const history = loadHistory().map((day) => ({
      ...day,
      runValues: Object.fromEntries(
        Object.entries(day.runValues ?? {}).map(([id, vals]) => [
          id,
          mergeSettingsObject(vals as unknown as Record<string, unknown>, map) as unknown as FormValues,
        ]),
      ),
    }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
  // ── Per-run values + brand/crust profiles (prefix scan; mirrors buildSyncPayload) ──
  const runPrefix = RUN_KEY("");
  const keysToRewrite: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith(runPrefix) ||
      k.startsWith("run-calc-profile-") ||
      k.startsWith("run-calc-crust-profile-")
    ) {
      keysToRewrite.push(k);
    }
  }
  for (const k of keysToRewrite) {
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null");
      if (obj && typeof obj === "object") {
        localStorage.setItem(k, JSON.stringify(mergeSettingsObject(obj as Record<string, unknown>, map)));
      }
    } catch {}
  }
}

// ── Master-data change history (local-only undo trail) ──────────────────────
// A snapshot is every "run-calc-*" localStorage key EXCEPT the change-history
// key itself (which would nest snapshots and blow up exponentially). This is the
// maximal blast radius of any master-data edit — a merge rewrites lists, recipe
// presets, profiles, runs, templates and history; a brand/flavor rename rewrites
// profiles + day-state; an ingredient rename rewrites per-run values. Snapshot-
// everything is the only universally-correct undo, so we accept the size cost
// (bounded by MAX_CHANGE_HISTORY + quota-safe trimming on write).
const APP_KEY_PREFIX = "run-calc-";

export function captureMasterDataSnapshot(): Record<string, string> {
  const snap: Record<string, string> = {};
  if (typeof localStorage === "undefined") return snap;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k === CHANGE_HISTORY_KEY) continue;
    if (!k.startsWith(APP_KEY_PREFIX)) continue;
    const v = localStorage.getItem(k);
    if (v !== null) snap[k] = v;
  }
  return snap;
}

// Restore a snapshot: rewrite every captured key, and delete any current
// "run-calc-*" key (except the change-history key) that wasn't in the snapshot —
// so additions made after the snapshot are truly reverted, not just overwritten.
export function restoreMasterDataSnapshot(snap: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  const present = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(APP_KEY_PREFIX) && k !== CHANGE_HISTORY_KEY) present.add(k);
  }
  for (const k of present) {
    if (!(k in snap)) {
      try { localStorage.removeItem(k); } catch {}
    }
  }
  for (const [k, v] of Object.entries(snap)) {
    try { localStorage.setItem(k, v); } catch {}
  }
}

export function loadChangeHistory(): MasterDataChange[] {
  try {
    const raw = localStorage.getItem(CHANGE_HISTORY_KEY);
    if (raw) return JSON.parse(raw) as MasterDataChange[];
  } catch {}
  return [];
}

// Persist the change-history list, trimming oldest entries until it fits the
// localStorage quota. A snapshot can be large, so a write may overflow; rather
// than throw (and break the edit that triggered it) we drop the oldest entries
// and retry, keeping whatever recent history fits.
export function saveChangeHistory(list: MasterDataChange[]): void {
  if (typeof localStorage === "undefined") return;
  let trimmed = list.slice(0, MAX_CHANGE_HISTORY);
  while (trimmed.length > 0) {
    try {
      localStorage.setItem(CHANGE_HISTORY_KEY, JSON.stringify(trimmed));
      return;
    } catch {
      trimmed = trimmed.slice(0, -1); // drop the oldest and retry
    }
  }
  try { localStorage.removeItem(CHANGE_HISTORY_KEY); } catch {}
}

// Record a change. `before` must be a snapshot captured BEFORE the edit. If the
// edit turned out to be a no-op (the post-edit state equals `before`), nothing
// is recorded — list mutations bail silently on duplicates/invalid input, and a
// useless undo entry would just clutter the history.
export function recordMasterDataChange(
  type: MasterDataChangeType,
  description: string,
  before: Record<string, string>,
): void {
  const after = captureMasterDataSnapshot();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const entry: MasterDataChange = {
    id: genId(),
    ts: Date.now(),
    type,
    description,
    before,
  };
  saveChangeHistory([entry, ...loadChangeHistory()]);
}

// Roll back to the point just before the given entry: restore that entry's
// before-snapshot and discard it plus every newer entry (the list is newest-
// first, so we keep only entries older than the undone one). Returns false when
// the entry no longer exists. Callers reload/refresh React state and re-push to
// the server after a successful undo.
export function undoChange(id: string): boolean {
  const list = loadChangeHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  restoreMasterDataSnapshot(list[idx].before);
  saveChangeHistory(list.slice(idx + 1));
  return true;
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

// ── Excel spec-sheet importer (user-facing) ──────────────────────────────────
//
// These power the user-facing Excel importer (web header menu → Import Spec
// Sheet). The pure logic — canonicalization, alias collection, new-vs-updated
// summary, prompt shaping — lives in @workspace/spec-import; this is the thin
// platform glue that reads the known canonical lists and writes profiles +
// recipe presets to localStorage. Apply semantics (per product): overwrite
// existing brand/flavor profiles + recipes and add brand-new ones automatically.
// Mirrors the mobile glue in artifacts/run-calculator-mobile/context (parity).

/** All known canonical name lists, supplied to ground the AI parse + fuzzy match. */
export function loadSpecImportKnown(): {
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  appTypes: string[];
  pepTypes: string[];
  cheeseIngredients: string[];
  doughIngredients: string[];
  sauceIngredients: string[];
  dieTypes: string[];
} {
  return {
    brands: loadList(BRANDS_KEY, []).filter(b => !STALE_BRANDS.includes(b)),
    flavorsByBrand: loadBrandFlavors(),
    appTypes: loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES),
    pepTypes: loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES)
      .map(t => PEP_TYPE_RENAMES[t] ?? t)
      .filter(t => !RETIRED_PEP_TYPES.includes(t)),
    cheeseIngredients: loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS),
    doughIngredients: loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS),
    sauceIngredients: loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS),
    dieTypes: [...new Set([...DEFAULT_DIE_TYPES, ...loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES)])],
  };
}

/** True when a brand+flavor already has a stored profile with real data. */
export function profileExistsForImport(brand: string, flavor: string): boolean {
  return profileHasRealData(brand, flavor);
}

function recipePresetMapForKind(kind: ParsedRecipe["kind"]): Record<string, RecipeRow[]> {
  if (kind === "dough") {
    const presets = loadDoughRecipePresets();
    const out: Record<string, RecipeRow[]> = {};
    for (const [name, p] of Object.entries(presets)) out[name] = p.rows;
    return out;
  }
  if (kind === "sauce") return loadFrontlineRecipePresets();
  return loadCheeseRecipePresets();
}

/** True when a dough/sauce/cheese recipe already exists in the library by name. */
export function recipeExistsForImport(kind: ParsedRecipe["kind"], name: string): boolean {
  const map = recipePresetMapForKind(kind);
  const lower = name.trim().toLowerCase();
  return Object.keys(map).some(k => k.trim().toLowerCase() === lower);
}

function ingredientKeyForKind(kind: ParsedRecipe["kind"]): { key: string; defaults: string[] } {
  if (kind === "dough") return { key: DOUGH_INGREDIENTS_KEY, defaults: DEFAULT_DOUGH_INGREDIENTS };
  if (kind === "sauce") return { key: FRONTLINE_INGREDIENTS_KEY, defaults: DEFAULT_FRONTLINE_INGREDIENTS };
  return { key: CHEESE_INGREDIENTS_KEY, defaults: DEFAULT_CHEESE_INGREDIENTS };
}

/**
 * Apply a (already-canonicalized) parsed spec-sheet import to local storage.
 * Profiles and recipes overwrite existing entries of the same brand+flavor /
 * name and add new ones; option lists are additively merged so every new
 * brand/flavor/type/ingredient/recipe name becomes selectable. Best-effort and
 * fail-safe: a malformed entry is skipped rather than aborting the whole import.
 */
export function applySpecImport(parsed: ParsedSpecImport): void {
  if (typeof localStorage === "undefined") return;

  // ── Recipe libraries (overwrite by name + register names/ingredients) ──
  const doughPresets = loadDoughRecipePresets();
  const saucePresets = loadFrontlineRecipePresets();
  const cheesePresets = loadCheeseRecipePresets();
  const newDoughIng: string[] = [];
  const newSauceIng: string[] = [];
  const newCheeseIng: string[] = [];
  const newDoughNames: string[] = [];
  const newSauceNames: string[] = [];
  const newCheeseNames: string[] = [];

  for (const r of parsed.recipes) {
    const name = r.name.trim();
    if (!name || r.rows.length === 0) continue;
    const rows = r.rows.map(row => ({ ingredient: row.ingredient, lbs: row.lbs }));
    if (r.kind === "dough") {
      doughPresets[name] = { rows };
      newDoughNames.push(name);
      newDoughIng.push(...rows.map(x => x.ingredient));
    } else if (r.kind === "sauce") {
      saucePresets[name] = rows;
      newSauceNames.push(name);
      newSauceIng.push(...rows.map(x => x.ingredient));
    } else {
      cheesePresets[name] = rows;
      newCheeseNames.push(name);
      newCheeseIng.push(...rows.map(x => x.ingredient));
    }
  }

  saveDoughRecipePresets(doughPresets);
  saveFrontlineRecipePresets(saucePresets);
  saveCheeseRecipePresets(cheesePresets);

  if (newDoughNames.length) {
    saveList(DOUGH_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES), newDoughNames).sort((a, b) => a.localeCompare(b)));
    saveList(ingredientKeyForKind("dough").key, mergeListInsensitive(loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS), newDoughIng).sort((a, b) => a.localeCompare(b)));
  }
  if (newSauceNames.length) {
    saveList(FRONTLINE_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES), newSauceNames).sort((a, b) => a.localeCompare(b)));
    saveList(ingredientKeyForKind("sauce").key, mergeListInsensitive(loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS), newSauceIng).sort((a, b) => a.localeCompare(b)));
  }
  if (newCheeseNames.length) {
    saveList(CHEESE_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(CHEESE_RECIPE_NAMES_KEY, []), newCheeseNames).sort((a, b) => a.localeCompare(b)));
    saveList(ingredientKeyForKind("cheese").key, mergeListInsensitive(loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS), newCheeseIng).sort((a, b) => a.localeCompare(b)));
  }

  // ── Profiles (overwrite spec fields, preserve unrelated fields) ──
  const bf = loadBrandFlavors();
  const newBrands: string[] = [];
  const newAppTypes: string[] = [];
  const newPepTypes: string[] = [];

  function registerBrandFlavor(brand: string, flavor: string): void {
    if (!brand || !flavor) return;
    newBrands.push(brand);
    const list = bf[brand] ?? [];
    if (!list.some(f => f.toLowerCase() === flavor.toLowerCase())) bf[brand] = [...list, flavor];
  }

  for (const p of parsed.profiles) {
    const brand = p.brand.trim();
    const flavor = p.flavor.trim();
    if (!brand || !flavor) continue;
    registerBrandFlavor(brand, flavor);
    const values: FormValues = { ...DEFAULT_VALUES, ...(loadProfile(brand, flavor) ?? {}) };
    if (p.dieType) values.dieType = p.dieType;
    if (p.sauceOzPerPizza != null) values.sauceOzPerPizza = p.sauceOzPerPizza;
    p.applicators.slice(0, 4).forEach((a, i) => {
      const slot = i + 1;
      const type = a.type.trim();
      if (!type) return;
      (values as Record<string, unknown>)[`app${slot}Type`] = type;
      (values as Record<string, unknown>)[`app${slot}OzPerPizza`] = a.ozPerPizza;
      newAppTypes.push(type);
    });
    p.pepperonis.slice(0, 2).forEach((pp, i) => {
      const slot = i + 1;
      const type = pp.type.trim();
      if (!type) return;
      (values as Record<string, unknown>)[`pep${slot}Type`] = type;
      (values as Record<string, unknown>)[`pep${slot}Sticks`] = pp.sticks;
      (values as Record<string, unknown>)[`pep${slot}OzPerPizza`] = pp.ozPerPizza;
      newPepTypes.push(type);
    });
    saveProfile(brand, flavor, values);
  }

  // ── Tie recipes onto their profiles ──
  // One recipe can serve many brand/flavor profiles (recipeTargets unions the
  // singular brand/flavor with the targets[] list), so it ties to each without
  // being duplicated in the recipe library.
  for (const r of parsed.recipes) {
    const rows = r.rows.map(row => ({ ingredient: row.ingredient, lbs: row.lbs }));
    for (const { brand, flavor } of recipeTargets(r)) {
      registerBrandFlavor(brand, flavor);
      const values: FormValues = { ...DEFAULT_VALUES, ...(loadProfile(brand, flavor) ?? {}) };
      if (r.kind === "dough") {
        values.doughRecipeName = r.name;
        values.doughRecipe = rows;
        if (r.doughballOz != null) values.targetDoughballWeight = r.doughballOz;
      } else if (r.kind === "sauce") {
        values.frontlineRecipeName = r.name;
        values.frontlineRecipe = rows;
      } else {
        const slot = r.app != null && r.app >= 1 && r.app <= 4 ? r.app : 1;
        (values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] = r.name;
        (values as Record<string, unknown>)[`app${slot}CheeseRecipe`] = rows;
      }
      saveProfile(brand, flavor, values);
    }
  }

  // ── Register brands/flavors + new option-list entries ──
  if (newBrands.length) {
    saveList(BRANDS_KEY, mergeListInsensitive(loadList(BRANDS_KEY, []), newBrands).sort((a, b) => a.localeCompare(b)));
    saveBrandFlavors(bf);
  }
  if (newAppTypes.length) {
    saveList(INGREDIENT_TYPES_KEY, mergeListInsensitive(loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES), newAppTypes).sort((a, b) => a.localeCompare(b)));
  }
  if (newPepTypes.length) {
    saveList(PEP_TYPES_KEY, mergeListInsensitive(loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES), newPepTypes));
  }
}

/** Re-export so the importer glue can pass the alias type through to clients. */
export type { SpecImportAlias };
