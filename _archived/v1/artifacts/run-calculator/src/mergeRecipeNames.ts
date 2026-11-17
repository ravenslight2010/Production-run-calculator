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
import { buildNearDupNameMatcher } from "@workspace/name-match";

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

// ── Pool-aware applicator-slot heal ──────────────────────────────────────────
// Older spec imports (and hand edits) sometimes wrote a cheese/mix RECIPE name
// straight into an applicator TYPE field (e.g. app2Type: "HT Standard Cheese
// Mix"). The run form's cards gate on the generic types ("cheese" / "Mix") and
// keep the recipe name in the app{n}CheeseRecipeName LINK field, so a raw name
// in the TYPE field leaves the slot half-broken AND leaks the name into the
// shared Type dropdown (it unions current values). The v1 migration
// (applyMixSlotRecategorizeIfNeeded) healed this with a word heuristic only —
// it ran at boot, BEFORE the server cheese/mix pools load, so names that don't
// contain the standalone word "mix" (e.g. "Gyro Cheese Blend") slipped through,
// and imports that landed after a device's one-time marker was set were never
// re-checked. This pool-aware pass closes both gaps.

const ciKey = (s: unknown): string => String(s ?? "").trim().toLowerCase();

/** Case-insensitive name → canonical pool spelling. */
export function buildPoolLookup(names: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of names) {
    const k = ciKey(n);
    if (k && !m.has(k)) m.set(k, n.trim());
  }
  return m;
}

/**
 * Heal the four applicator slots on a values/profile object:
 *  - TYPE ci-matches a server CHEESE pool name  → type "cheese", canonical name
 *    moved into the link field (only if the link is blank or ci-equal).
 *  - TYPE ci-matches a server MIX pool name     → type "Mix", same link move.
 *  - TYPE matches the stray word heuristic (standalone "mix" or "blend", not
 *    allowlisted) → "cheese" when it contains "cheese"/"blend", else "Mix",
 *    keeping the raw name as the link so it stays visible (and mergeable).
 * Never touches a slot whose type is allowlisted (generic types, pep types,
 * real ingredients). Returns the (possibly new) object plus a changed flag.
 */
export function healApplicatorSlotValues<T extends Record<string, unknown>>(
  obj: T,
  pools: {
    cheese: Map<string, string>;
    mixes: Map<string, string>;
    allowlist: Set<string>;
  },
): { values: T; changed: boolean } {
  let changed = false;
  const out = { ...obj } as Record<string, unknown>;
  for (const slot of [1, 2, 3, 4]) {
    const typeField = `app${slot}Type`;
    const linkField = `app${slot}CheeseRecipeName`;
    const raw = String(out[typeField] ?? "").trim();
    if (!raw) continue;
    const key = ciKey(raw);
    if (pools.allowlist.has(key)) continue;
    let generic: string;
    let canonical: string;
    if (pools.cheese.has(key)) {
      generic = "cheese";
      canonical = pools.cheese.get(key)!;
    } else if (pools.mixes.has(key)) {
      generic = "Mix";
      canonical = pools.mixes.get(key)!;
    } else if (/\bmix\b/.test(key) || /\bblend\b/.test(key)) {
      generic = /cheese|blend/i.test(raw) ? "cheese" : "Mix";
      canonical = raw;
    } else {
      continue;
    }
    out[typeField] = generic;
    const existing = String(out[linkField] ?? "").trim();
    if (!existing || ciKey(existing) === key) out[linkField] = canonical;
    changed = true;
  }
  return { values: out as T, changed };
}

/**
 * Collect recipe-name LINK/selection values referenced by values objects
 * (runs, profiles, templates, history) that match NO server pool name —
 * "stale references": old names still held after the real recipe was renamed,
 * merged, or re-imported. They still show in pickers (a picker always includes
 * the current pick) but are otherwise unfindable — not in the category's
 * Manage Lists section and, before this, not offered by the merge picker
 * either. Returned in first-seen spelling, deduped case-insensitively, so the
 * category's merge tab can offer them as merge sources (the merge rewrites
 * every link field, which is exactly how a user cleans one up).
 */
export function collectStaleRecipeLinkNames(
  objects: readonly Record<string, unknown>[],
  poolNamesCi: ReadonlySet<string>,
  fields: readonly string[],
): string[] {
  const seen = new Map<string, string>();
  for (const obj of objects) {
    for (const field of fields) {
      const name = String(obj[field] ?? "").trim();
      if (!name) continue;
      const key = ciKey(name);
      if (poolNamesCi.has(key) || seen.has(key)) continue;
      seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Cheese-tab variant kept for existing callers/tests (link fields = app1-4). */
export function collectStaleCheeseLinkNames(
  objects: readonly Record<string, unknown>[],
  poolNamesCi: ReadonlySet<string>,
): string[] {
  return collectStaleRecipeLinkNames(
    objects,
    poolNamesCi,
    RECIPE_NAME_FIELDS_BY_CATEGORY.cheese,
  );
}

export interface StaleCleanupSuggestion {
  /** The stale referenced name (first-seen spelling). */
  name: string;
  /** The closest real pool recipe, or null when no single safe match exists. */
  suggestion: string | null;
}

/**
 * Propose the best-matching REAL pool recipe for each stale referenced name,
 * using the shared near-duplicate matcher (loose key → word order → single
 * typo → one extra word). The extra-word layer is safe to enable here because
 * every cleanup is user-confirmed through the merge form before it applies
 * (the suggestion only PRE-FILLS the merge pair). Ambiguity-guarded: two
 * plausible pool candidates ⇒ no suggestion (null) rather than a guess. Pure.
 */
export function buildStaleCleanupSuggestions(
  staleNames: readonly string[],
  poolNames: readonly string[],
): StaleCleanupSuggestion[] {
  const matcher = buildNearDupNameMatcher(poolNames, { allowExtraToken: true });
  return staleNames.map((name) => ({ name, suggestion: matcher(name) }));
}
