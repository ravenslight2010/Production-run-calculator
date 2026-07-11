// Shared "named recipe" model for the run calculator (web + mobile parity).
//
// A "named recipe" is a simple, factory-wide recipe organized purely by NAME
// plus a list of ingredient components (each an ingredient and its POUNDS). It
// backs the Dough and Sauce sections, promoting the old on-device Dough/Sauce
// preset lists to server master-data that works like Mixes and Cheese Recipes:
// managers define them once, they are shared across every signed-in device, and
// the run form's Dough / Sauce cards pick one (hydrating their rows from the
// chosen recipe) instead of each device keeping its own preset map.
//
// Unlike Mixes (per-pizza ounces + brand/flavor) and Cheese Recipes (brand +
// flavors + shredder setting), Dough and Sauce carry no brand/flavor grouping —
// they are just a name and a list of {ingredient, lbs} rows, matching the
// existing per-run `doughRecipe` / `frontlineRecipe` RecipeRow shape so
// hydration is a straight copy.
//
// This module is PURE so both apps agree on what a well-formed recipe is and how
// the list is browsed. Definitions are stored factory-wide on the server (NOT in
// the per-day sync payload) and edited by managers only; the apps keep only thin
// platform glue (fetch/save/delete) plus the run-side hydration.

import { buildNearDupNameMatcher, looseNameKey } from "@workspace/name-match";

// One component of a named recipe: an ingredient and how many POUNDS of it the
// recipe uses. Matches the per-run RecipeRow shape ({ ingredient, lbs }).
export interface NamedRecipeComponent {
  ingredient: string;
  lbs: number;
}

// A single manager-defined named recipe. Flat shape (plus a components array) so
// it serializes cleanly to the API/DB and is easy to edit field-by-field in the
// UI, mirroring the Mix / Cheese Recipe models minus the brand/flavor fields.
export interface NamedRecipe {
  id: string;
  // Optional persistence scope (live vs sandbox); carried through opaquely.
  scope?: string;
  // Display name of the recipe (e.g. "12in NY Dough", "Marinara Sauce").
  name: string;
  // Free-form notes.
  notes: string;
  // The ingredients that make up the recipe, each in pounds.
  components: NamedRecipeComponent[];
  // Disabled recipes are kept (so toggling is easy) but hidden from run pickers.
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function coerceNum(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function coerceStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Coerce a raw value into a clean component, or null if it has no usable
// ingredient name. lbs defaults to 0 and is clamped to >= 0.
export function normalizeNamedRecipeComponent(
  input: unknown,
): NamedRecipeComponent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const ingredient = coerceStr(raw.ingredient);
  if (!ingredient) return null;
  const lbs = Math.max(0, coerceNum(raw.lbs, 0));
  return { ingredient, lbs };
}

// Coerce a raw API/DB record into a clean NamedRecipe, or null if it has no
// usable name. Numeric component pounds are clamped to >= 0; enabled defaults to
// true; malformed components are dropped.
export function normalizeNamedRecipe(input: unknown): NamedRecipe | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = coerceStr(raw.name);
  if (!name) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id : name.toLowerCase();
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false;
  const components = Array.isArray(raw.components)
    ? raw.components
        .map(normalizeNamedRecipeComponent)
        .filter((c): c is NamedRecipeComponent => c !== null)
    : [];
  const recipe: NamedRecipe = {
    id,
    name,
    notes: coerceStr(raw.notes),
    components,
    enabled,
  };
  if (typeof raw.scope === "string" && raw.scope) recipe.scope = raw.scope;
  return recipe;
}

// Normalize a list, dropping malformed entries and collapsing duplicate ids onto
// the last-seen entry.
export function normalizeNamedRecipes(input: unknown): NamedRecipe[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, NamedRecipe>();
  for (const raw of input) {
    const recipe = normalizeNamedRecipe(raw);
    if (!recipe) continue;
    byId.set(recipe.id, recipe);
  }
  return Array.from(byId.values());
}

// Total pounds of the recipe (sum of component pounds).
export function namedRecipeTotalLbs(recipe: NamedRecipe): number {
  return recipe.components.reduce((acc, c) => acc + c.lbs, 0);
}

/** Case-insensitive match of a search query against name/ingredients. */
export function namedRecipeMatchesQuery(
  recipe: NamedRecipe,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    recipe.name.toLowerCase().includes(q) ||
    recipe.components.some((c) => c.ingredient.toLowerCase().includes(q))
  );
}

/**
 * Sort recipes by name (case-insensitive) for a browsable settings list. Pure —
 * used by BOTH web and mobile so the two lists can't drift.
 */
export function sortNamedRecipesByName(
  recipes: ReadonlyArray<NamedRecipe>,
): NamedRecipe[] {
  return [...recipes].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Re-point named-recipe (dough/sauce) COMPONENT ingredient names when an
 * ingredient is merged in the Merge tool. Named recipes are server-backed
 * master-data (their own tables, NOT part of day-state sync), so an ingredient
 * merge — which only rewrites local lists/presets/runs — leaves the server
 * recipes naming the merged-away ingredient, and it resurfaces when a run
 * hydrates its rows from the pool. Rewrites each matching component's
 * `ingredient` to the target; rows are NOT combined (a recipe that named two
 * now-merged ingredients keeps both rows so its total weight is preserved
 * exactly, mirroring mergeRecipeRows). Returns ONLY the recipes that changed
 * (so the caller can upsert just those), matched case-insensitively.
 */
export function repointNamedRecipeIngredients(
  recipes: ReadonlyArray<NamedRecipe>,
  sources: ReadonlyArray<string>,
  target: string,
): NamedRecipe[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    if (!r.components.some((c) => srcSet.has(c.ingredient.trim().toLowerCase())))
      continue;
    changed.push({
      ...r,
      components: r.components.map((c) =>
        srcSet.has(c.ingredient.trim().toLowerCase())
          ? { ...c, ingredient: tgt }
          : c,
      ),
    });
  }
  return changed;
}

/**
 * Build a well-formed NamedRecipe from a name + component rows using a
 * deterministic, name-slug id (prefixed so dough and sauce ids never collide,
 * and so re-importing/re-migrating the same name targets the same recipe instead
 * of duplicating it). enabled is true so run pickers see it right away. Returns
 * null for a blank name. Pure — shared by web + mobile.
 */
export function namedRecipeFromDraft(draft: {
  name: string;
  components: ReadonlyArray<{ ingredient: string; lbs: number }>;
  idPrefix: string;
  notes?: string;
}): NamedRecipe | null {
  const name = draft.name.trim();
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = draft.idPrefix.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return normalizeNamedRecipe({
    id: slug ? `${prefix}:${slug}` : `${prefix}:${name.toLowerCase()}`,
    name,
    notes: draft.notes ?? "",
    components: draft.components,
    enabled: true,
  });
}

// ---------------------------------------------------------------------------
// One-time local→server name consolidation planning
// ---------------------------------------------------------------------------

/**
 * The consolidation decision for one master-data pool: which device-local
 * recipe names should be PUSHED to the server pool (they become canonical
 * entries), which are near-duplicate VARIANTS of an existing (or newly pushed)
 * name and should be merged into it, and which already exist on the server
 * verbatim (nothing to push — just clean up the local list).
 */
export interface NameConsolidationPlan {
  /** Local-only names to add to the server pool, in canonical-first order. */
  additions: string[];
  /** Variant local name → the canonical name it should be merged into. */
  renames: Record<string, string>;
  /** Local names already in the server pool (case-insensitive exact match). */
  alreadyPresent: string[];
}

/**
 * Plan how a device-local recipe-name list folds into its server master-data
 * pool so run-form pickers and Manage Lists converge on ONE canonical entry per
 * recipe. Matching uses the shared near-dup layers (word order / single typo,
 * ambiguity + digit guards; the extra-word layer stays OFF — "Garlic Alfredo"
 * must NOT fold into "Alfredo Sauce"), with kind-generic filler tokens (e.g.
 * "sauce", "recipe") stripped from the key so "Mystic", "Mystic Recipe" and
 * "mystic sauce" all resolve to the same recipe.
 *
 * Two passes: (1) each local name is matched against the server pool — an exact
 * case-insensitive hit is reported as already-present, a near-dup hit becomes a
 * rename onto the server spelling; (2) the remaining local-only names are
 * deduped among THEMSELVES — `preferAsCanonical` (e.g. "has saved recipe rows")
 * then shorter-name/alphabetical order picks the canonical spelling, and the
 * other variants become renames onto it. Pure.
 */
export function planNameConsolidation(opts: {
  localNames: ReadonlyArray<string>;
  serverNames: ReadonlyArray<string>;
  /**
   * Kind-generic filler tokens stripped (lowercased) from the match key, on
   * top of the shared generic fillers looseNameKey already removes. If
   * stripping would empty the key, the unstripped key is kept ("Sauce" stays
   * "sauce", it does not match everything).
   */
  genericTokens?: ReadonlyArray<string>;
  /** Prefer this name as the canonical spelling when deduping local names. */
  preferAsCanonical?: (name: string) => boolean;
}): NameConsolidationPlan {
  const generic = new Set(
    (opts.genericTokens ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const keyOf = (name: string): string => {
    const base = looseNameKey(name);
    if (!base) return base;
    const tokens = base.split(" ");
    const kept = tokens.filter((t) => !generic.has(t));
    return (kept.length ? kept : tokens).join(" ");
  };

  // Server pool, first spelling wins per case-insensitive name.
  const serverByCi = new Map<string, string>();
  for (const raw of opts.serverNames) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const ci = name.toLowerCase();
    if (!serverByCi.has(ci)) serverByCi.set(ci, name);
  }

  // Clean + ci-dedupe the local list (first spelling wins).
  const locals: string[] = [];
  const seenLocal = new Set<string>();
  for (const raw of opts.localNames) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const ci = name.toLowerCase();
    if (seenLocal.has(ci)) continue;
    seenLocal.add(ci);
    locals.push(name);
  }

  const alreadyPresent: string[] = [];
  const renames: Record<string, string> = {};
  const rest: string[] = [];
  const matchServer = buildNearDupNameMatcher([...serverByCi.values()], {
    keyOf,
  });
  for (const name of locals) {
    const exact = serverByCi.get(name.toLowerCase());
    if (exact) {
      alreadyPresent.push(name);
      continue;
    }
    const hit = matchServer(name);
    if (hit && hit.toLowerCase() !== name.toLowerCase()) {
      renames[name] = hit;
      continue;
    }
    rest.push(name);
  }

  // Dedupe the remaining local-only names among themselves. Canonical
  // preference: caller's predicate (e.g. has saved rows), then the shorter
  // spelling, then alphabetical. The matcher is rebuilt per accepted addition —
  // fine here because this is a ONE-TIME migration over small pools (≤ ~100
  // names), not a per-keystroke scan.
  const prefer = opts.preferAsCanonical ?? (() => false);
  rest.sort(
    (a, b) =>
      Number(prefer(b)) - Number(prefer(a)) ||
      a.length - b.length ||
      a.localeCompare(b),
  );
  const additions: string[] = [];
  for (const name of rest) {
    const hit =
      additions.length > 0
        ? buildNearDupNameMatcher(additions, { keyOf })(name)
        : null;
    if (hit && hit.toLowerCase() !== name.toLowerCase()) {
      renames[name] = hit;
    } else {
      additions.push(name);
    }
  }

  return { additions, renames, alreadyPresent };
}

/**
 * Add recipes to the existing pool, skipping any whose NAME already exists
 * (case-insensitive) OR whose id already exists. This is the "match, don't
 * clobber" rule used by the one-time local→server migration and by spec-import:
 * a recipe of the same name already on the server is left untouched, while a
 * genuinely new one is appended. Pure. Returns the merged list plus how many
 * were actually added.
 */
export function addNamedRecipesIfAbsentByName(
  existing: ReadonlyArray<NamedRecipe>,
  candidates: ReadonlyArray<NamedRecipe>,
): { merged: NamedRecipe[]; added: number } {
  // Near-dup layers (loose key, word order, single typo — each with ambiguity
  // + digit guards) so an import whose name only drifts in labeling links to
  // the recipe the factory already keeps instead of forking a parallel entry.
  // The extra-word layer stays OFF: "Spicy Sauce" is not "Sauce".
  const matchExisting = buildNearDupNameMatcher(existing.map((r) => r.name));
  const haveNames = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const haveIds = new Set(existing.map((r) => r.id));
  const merged: NamedRecipe[] = [...existing];
  let added = 0;
  for (const c of candidates) {
    const nameKey = c.name.trim().toLowerCase();
    if (
      !nameKey ||
      haveNames.has(nameKey) ||
      haveIds.has(c.id) ||
      matchExisting(c.name) !== null
    ) {
      continue;
    }
    haveNames.add(nameKey);
    haveIds.add(c.id);
    merged.push(c);
    added++;
  }
  return { merged, added };
}
