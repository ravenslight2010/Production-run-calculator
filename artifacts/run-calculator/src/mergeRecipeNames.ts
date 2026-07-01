// Pure, framework-free helpers for merging RECIPE NAMES (the picklist labels for
// dough/sauce/cheese/mix recipes) into a single canonical name. This is the
// parallel of ./mergeIngredients, but it rewrites recipe-NAME selection fields
// (e.g. `doughRecipeName`) and folds preset-map KEYS — it does NOT touch
// ingredient names or the rows inside a recipe. Persistence (localStorage) lives
// in the callers; this module owns only the value rewriting.
//
// Web-only for now: web+mobile parity is temporarily paused (see
// `.local/parity-pause-log.md`). Mirror this to the mobile app when parity
// resumes.

import type { MergeMap } from "./mergeIngredients";

export type RecipeNameMergeCategory = "dough" | "sauce" | "cheese" | "mixes";

// The FormValues string fields that hold a recipe-name selection, per category.
// Mixes have no per-run selection field (mixes are managed separately), so a mix
// merge only folds the name list — nothing on a run is re-pointed.
export const RECIPE_NAME_FIELDS_BY_CATEGORY: Record<RecipeNameMergeCategory, readonly string[]> = {
  dough: ["doughRecipeName"],
  sauce: ["frontlineRecipeName"],
  cheese: ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
  mixes: [],
};

/** Rewrite the recipe-name selection fields on a settings/values object. */
export function mergeRecipeNameSettingsObject<T extends Record<string, unknown>>(
  obj: T,
  map: MergeMap,
  fields: readonly string[],
): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of fields) {
    const v = out[k];
    if (typeof v === "string" && map[v]) out[k] = map[v];
  }
  return out as T;
}

/**
 * Fold a recipe-preset map's KEYS by the merge map. A source key's preset is
 * moved to the target key ONLY if the target has no preset yet — the kept
 * (target) recipe's rows always win over a merged-away source's. Non-source keys
 * pass through unchanged.
 */
export function foldPresetKeys<V>(presets: Record<string, V>, map: MergeMap): Record<string, V> {
  const out: Record<string, V> = {};
  // Pass 1: keep every non-source key. This preserves the target's own preset.
  for (const [k, v] of Object.entries(presets)) {
    if (!map[k]) out[k] = v;
  }
  // Pass 2: move each source's preset onto its target, but never clobber a
  // target that already has one.
  for (const [k, v] of Object.entries(presets)) {
    const t = map[k];
    if (t && !(t in out)) out[t] = v;
  }
  return out;
}

/**
 * Count how many recipe-name references a merge map would rewrite across the
 * supplied surfaces: name-list entries, selection-field hits on settings
 * objects, and preset KEYS that get folded. Drives the confirmation preview.
 */
export function countRecipeNameReferences(
  map: MergeMap,
  fields: readonly string[],
  surfaces: {
    lists?: string[][];
    settingsObjects?: Record<string, unknown>[];
    presetKeyMaps?: Record<string, unknown>[];
  },
): number {
  let count = 0;
  const hit = (name: unknown) => typeof name === "string" && Boolean(map[name]);
  for (const list of surfaces.lists ?? []) {
    for (const item of list) if (hit(item)) count++;
  }
  for (const obj of surfaces.settingsObjects ?? []) {
    for (const k of fields) if (hit(obj[k])) count++;
  }
  for (const presets of surfaces.presetKeyMaps ?? []) {
    for (const key of Object.keys(presets)) if (hit(key)) count++;
  }
  return count;
}

/**
 * True when a name is a stray recipe/mix name that has leaked into the
 * standalone-ingredient list and should NOT appear in the Ingredients merge
 * tab. Historically many mix / cheese-mix RECIPE names (e.g. "4Hands Club Mix",
 * "Aldo's Cheese Mix", "Red Hot Cheese Mix Monterey Jack ...", "Club Mix (With
 * Chicken)") were imported into `ingredientTypes` with spellings that don't
 * exactly match any recipe-name list, so exact-match exclusion misses them.
 * Anything containing the standalone word "mix" (as a whole token, so "mixed"
 * and "premix" are NOT matched) is treated as a recipe name, EXCEPT genuine
 * ingredients that legitimately contain "mix" (e.g. the jarred "Hot Giardiniera
 * Mix") — those are passed in via `realIngredients` (compared by full name).
 */
export function isStrayMixName(name: string, realIngredients: Set<string>): boolean {
  const t = name.trim().toLowerCase();
  if (realIngredients.has(t)) return false;
  return /\bmix\b/.test(t);
}
