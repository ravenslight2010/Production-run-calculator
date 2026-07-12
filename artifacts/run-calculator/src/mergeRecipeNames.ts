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

import { buildCiMergeLookup, mapNameCi, type MergeMap } from "./mergeIngredients";

export type RecipeNameMergeCategory = "dough" | "sauce" | "cheese" | "mixes";

// The FormValues string fields that hold a recipe-name selection, per category.
// Mix names are picked through the SAME app{n}CheeseRecipeName link fields as
// cheese blends (the applicator slot type is generic "Mix"/"cheese"; the name
// lives in the link — see .agents/memory/mix-applicator-slots.md), so a mix
// merge must re-point those fields too or runs keep referencing a deleted mix.
export const RECIPE_NAME_FIELDS_BY_CATEGORY: Record<RecipeNameMergeCategory, readonly string[]> = {
  dough: ["doughRecipeName"],
  sauce: ["frontlineRecipeName"],
  cheese: ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
  mixes: ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"],
};

/**
 * Rewrite the recipe-name selection fields on a settings/values object.
 * Matching is case-insensitive (trim + lowercase) — imported selections often
 * drift in case from the server pool's canonical spelling.
 */
export function mergeRecipeNameSettingsObject<T extends Record<string, unknown>>(
  obj: T,
  map: MergeMap,
  fields: readonly string[],
): T {
  const lookup = buildCiMergeLookup(map);
  const out = { ...obj } as Record<string, unknown>;
  for (const k of fields) {
    const renamed = mapNameCi(out[k], lookup);
    if (renamed !== undefined) out[k] = renamed;
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
  const lookup = buildCiMergeLookup(map);
  const ci = (s: string) => s.trim().toLowerCase();
  const out: Record<string, V> = {};
  const outKeysCi = new Set<string>();
  // Pass 1: keep every non-source key (a key that only differs from its target
  // by case/whitespace counts as the target itself). Preserves the target's own
  // preset.
  for (const [k, v] of Object.entries(presets)) {
    const t = lookup.get(ci(k));
    if (t === undefined || ci(t) === ci(k)) {
      out[k] = v;
      outKeysCi.add(ci(k));
    }
  }
  // Pass 2: move each source's preset onto its target, but never clobber a
  // target that already has one.
  for (const [k, v] of Object.entries(presets)) {
    const t = lookup.get(ci(k));
    if (t !== undefined && ci(t) !== ci(k) && !outKeysCi.has(ci(t))) {
      out[t] = v;
      outKeysCi.add(ci(t));
    }
  }
  return out;
}

/**
 * Count how many recipe-name references a merge map would rewrite across the
 * supplied surfaces: name-list entries, selection-field hits on settings
 * objects, and preset KEYS that get folded. Drives the confirmation preview.
 * Matching is case-insensitive (trim + lowercase), mirroring the apply path.
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
  const lookup = buildCiMergeLookup(map);
  let count = 0;
  const hit = (name: unknown) => mapNameCi(name, lookup) !== undefined;
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
 * Mix") — those are passed in via `realIngredients` (compared by full name)
 * and/or covered by the built-in GENUINE_MIX_INGREDIENT_NAMES allowlist below.
 */

/**
 * Genuine standalone ingredients that legitimately contain the word "mix".
 * Built into isStrayMixName so protection does not depend on the (now
 * intentionally empty) factory seed lists — after the 2026-07-03 data purge the
 * caller-supplied `realIngredients` set no longer carries these names.
 * Lower-cased full names.
 */
export const GENUINE_MIX_INGREDIENT_NAMES: ReadonlySet<string> = new Set([
  "hot giardiniera mix",
]);

export function isStrayMixName(name: string, realIngredients: Set<string>): boolean {
  const t = name.trim().toLowerCase();
  if (realIngredients.has(t)) return false;
  if (GENUINE_MIX_INGREDIENT_NAMES.has(t)) return false;
  return /\bmix\b/.test(t);
}
