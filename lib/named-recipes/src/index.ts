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
// Like Mixes and Cheese Recipes, a named recipe can carry an OPTIONAL
// brand/flavor tag ("who it goes to"): a single customer (brand) plus the
// product flavors it is used on. Empty flavors with a brand means "all
// varieties" of that brand (mirroring the Cheese Recipes convention); no brand
// means the recipe is shared/untagged. The tags are DISPLAY-ONLY — run-form
// Dough/Sauce pickers keep listing every enabled recipe — and the rows still
// match the per-run `doughRecipe` / `frontlineRecipe` RecipeRow shape so
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
  // Optional "who it goes to" tag: the customer (brand) this recipe is made
  // for. Empty string = shared/untagged. Display-only (never filters pickers).
  brand: string;
  // Product flavors of `brand` this recipe is used on. Empty with a brand set
  // means "all varieties" (same convention as Cheese Recipes).
  flavors: string[];
  // DOUGH only: target weight of one doughball in OUNCES (the spec sheet's
  // "target ball weight"). 0/absent = unknown. Sauce recipes never set it.
  // Stored on the pool so picking a dough recipe can fill the run form's
  // Target Doughball Weight — without it every pool-hydrated dough run sat at
  // 0 oz and the batch-yield math silently died.
  doughballWeightOz?: number;
  // DOUGH only: how many doughballs fit on one tray. 0/absent = unknown.
  // Stored on the pool (like doughballWeightOz) so picking a dough recipe —
  // or a pool-hydrated import/heal — can fill the run form's Doughballs Per
  // Tray; the spec sheet states it per RECIPE, so it must travel with the
  // recipe, not just the profiles an import happened to touch.
  doughballsPerTray?: number;
  // DOUGH only: the per-VARIANT doughball weights / per-tray counts this one
  // family recipe covers. A spec import collapses variant names ("11\" CRB",
  // "CRB Heavy Plus") onto ONE family recipe (one recipe per dough family) —
  // this list keeps every variant's numbers instead of losing all but one.
  // label = the variant's original sheet name. Additive: re-imports merge by
  // label (ci), never dropping variants. Empty/absent = no variants known.
  doughballVariants?: DoughballVariant[];
}

/** One dough family variant's doughball numbers (label = original sheet name). */
export interface DoughballVariant {
  label: string;
  /** Target doughball weight in oz; 0/absent = unknown. */
  weightOz?: number;
  /** Doughballs per tray; 0/absent = unknown. */
  perTray?: number;
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

// Coerce a raw flavors value into a clean, ci-deduped list of non-blank names.
// Tolerates absent/malformed input (older records have no flavors field).
export function normalizeNamedRecipeFlavors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const f = coerceStr(raw);
    if (!f) continue;
    const ci = f.toLowerCase();
    if (seen.has(ci)) continue;
    seen.add(ci);
    out.push(f);
  }
  return out;
}

// Coerce a raw API/DB record into a clean NamedRecipe, or null if it has no
// usable name. Numeric component pounds are clamped to >= 0; enabled defaults to
// true; malformed components are dropped. brand/flavors default to untagged
// (older records predate the tags) — flavors are only kept when a brand is set,
// since a flavor tag is meaningless without knowing whose flavor it is.
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
  const brand = coerceStr(raw.brand);
  const recipe: NamedRecipe = {
    id,
    name,
    notes: coerceStr(raw.notes),
    components,
    enabled,
    brand,
    flavors: brand ? normalizeNamedRecipeFlavors(raw.flavors) : [],
  };
  const ballOz = coerceNum(raw.doughballWeightOz, 0);
  if (ballOz > 0) recipe.doughballWeightOz = ballOz;
  const perTray = Math.round(coerceNum(raw.doughballsPerTray, 0));
  if (perTray > 0) recipe.doughballsPerTray = perTray;
  const variants = normalizeDoughballVariants(raw.doughballVariants);
  if (variants.length > 0) recipe.doughballVariants = variants;
  if (typeof raw.scope === "string" && raw.scope) recipe.scope = raw.scope;
  return recipe;
}

/**
 * Coerce a raw doughball variants value into a clean list: blank labels and
 * variants with neither a positive weight nor per-tray are dropped; duplicate
 * labels (ci) collapse onto the first occurrence (its set fields win, later
 * duplicates only fill gaps). Pure.
 */
export function normalizeDoughballVariants(input: unknown): DoughballVariant[] {
  if (!Array.isArray(input)) return [];
  const out: DoughballVariant[] = [];
  const byKey = new Map<string, number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const label = coerceStr(rec.label);
    if (!label) continue;
    const weightOz = coerceNum(rec.weightOz, 0);
    const perTray = Math.round(coerceNum(rec.perTray, 0));
    const v: DoughballVariant = { label };
    if (weightOz > 0) v.weightOz = weightOz;
    if (perTray > 0) v.perTray = perTray;
    if (v.weightOz === undefined && v.perTray === undefined) continue;
    const key = label.toLowerCase();
    const at = byKey.get(key);
    if (at === undefined) {
      byKey.set(key, out.length);
      out.push(v);
      continue;
    }
    const keep = out[at];
    out[at] = {
      ...keep,
      ...(keep.weightOz === undefined && v.weightOz !== undefined ? { weightOz: v.weightOz } : {}),
      ...(keep.perTray === undefined && v.perTray !== undefined ? { perTray: v.perTray } : {}),
    };
  }
  return out;
}

/**
 * Additively merge learned variants onto EXISTING pool dough recipes by recipe
 * NAME (ci). Per recipe: variants are merged by label (ci) — new labels append,
 * an existing label's UNSET fields are filled and set fields are updated to
 * the incoming value (a re-import states the variant's current spec numbers).
 * Variants are never removed. Returns ONLY the recipes that changed. Pure —
 * mirrors fillNamedRecipeDoughballWeights.
 */
export function mergeNamedRecipeDoughballVariants(
  recipes: ReadonlyArray<NamedRecipe>,
  variantsByName: ReadonlyMap<string, ReadonlyArray<DoughballVariant>>,
): NamedRecipe[] {
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const incoming = normalizeDoughballVariants(
      variantsByName.get(r.name.trim().toLowerCase()) as unknown,
    );
    if (incoming.length === 0) continue;
    const merged = [...normalizeDoughballVariants(r.doughballVariants)];
    const byKey = new Map<string, number>(
      merged.map((v, i) => [v.label.toLowerCase(), i]),
    );
    let touched = false;
    for (const v of incoming) {
      const at = byKey.get(v.label.toLowerCase());
      if (at === undefined) {
        byKey.set(v.label.toLowerCase(), merged.length);
        merged.push(v);
        touched = true;
        continue;
      }
      const keep = merged[at];
      const next: DoughballVariant = {
        ...keep,
        ...(v.weightOz !== undefined ? { weightOz: v.weightOz } : {}),
        ...(v.perTray !== undefined ? { perTray: v.perTray } : {}),
      };
      if (
        next.weightOz !== keep.weightOz ||
        next.perTray !== keep.perTray
      ) {
        merged[at] = next;
        touched = true;
      }
    }
    if (touched) changed.push({ ...r, doughballVariants: merged });
  }
  return changed;
}

/**
 * Pick the dough family variant that best matches a product, for auto-filling
 * a blank run form. Deterministic and conservative:
 * 1. exactly ONE variant → that variant;
 * 2. the die size's leading number (e.g. `11` from `11 inch`) appears as the
 *    size number in EXACTLY ONE variant label ("11\" CRB") → that variant;
 * 3. otherwise null — the caller should offer a manual pick.
 */
export function matchDoughballVariant(
  variants: ReadonlyArray<DoughballVariant> | undefined,
  opts: { dieType?: string },
): DoughballVariant | null {
  const list = normalizeDoughballVariants(variants as unknown);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const dieNum = (() => {
    const m = /(\d+(?:\.\d+)?)/.exec(opts.dieType ?? "");
    return m ? m[1] : "";
  })();
  if (!dieNum) return null;
  const hits = list.filter((v) => {
    const nums: string[] = v.label.match(/\d+(?:\.\d+)?/g) ?? [];
    return nums.includes(dieNum);
  });
  return hits.length === 1 ? hits[0] : null;
}

// Loose ingredient-name key for lining up component rows in a merge backfill:
// lowercase, split on non-alphanumerics, tokens sorted then joined (word
// reorder like "Pepperoni, Diced" vs "Diced Pepperoni" folds).
function looseMergeIngredientKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length >= 4 ? t.replace(/s$/, "") : t))
    .sort()
    .join("");
}

/**
 * Backfill a merge TARGET dough/sauce recipe from the recipes being merged
 * away, BEFORE the sources are deleted from the server pool. Blank-fill-only:
 * real data on the target is never clobbered — sources only fill gaps.
 * Component rows are matched by loose ingredient name (lbs filled only where
 * the target has none; source-only rows appended); notes fill only when blank;
 * brand (+ flavors) are adopted only when the target has NO brand (a branded
 * recipe's empty flavors list means "all varieties" and is left alone);
 * doughballWeightOz / doughballsPerTray fill only when unset; doughball
 * variants merge additively by label (target's variants win). Sources fold in
 * order. Returns the enriched recipe, or null when nothing changed. Pure.
 */
export function backfillNamedRecipeFromMergedSources(
  target: NamedRecipe,
  sources: ReadonlyArray<NamedRecipe>,
): NamedRecipe | null {
  let changed = false;
  const next: NamedRecipe = {
    ...target,
    components: target.components.map((c) => ({ ...c })),
    flavors: [...target.flavors],
    doughballVariants: target.doughballVariants
      ? target.doughballVariants.map((v) => ({ ...v }))
      : undefined,
  };
  for (const src of sources) {
    if (!next.notes.trim() && src.notes.trim()) {
      next.notes = src.notes;
      changed = true;
    }
    if (!next.brand.trim() && src.brand.trim()) {
      next.brand = src.brand;
      if (next.flavors.length === 0 && src.flavors.length > 0) {
        next.flavors = [...src.flavors];
      }
      changed = true;
    }
    if (!((next.doughballWeightOz ?? 0) > 0) && (src.doughballWeightOz ?? 0) > 0) {
      next.doughballWeightOz = src.doughballWeightOz;
      changed = true;
    }
    if (!((next.doughballsPerTray ?? 0) > 0) && (src.doughballsPerTray ?? 0) > 0) {
      next.doughballsPerTray = src.doughballsPerTray;
      changed = true;
    }
    if ((src.doughballVariants ?? []).length > 0) {
      const have = new Set(
        (next.doughballVariants ?? []).map((v) => v.label.trim().toLowerCase()),
      );
      for (const v of src.doughballVariants ?? []) {
        const key = v.label.trim().toLowerCase();
        if (!key || have.has(key)) continue;
        have.add(key);
        next.doughballVariants = [...(next.doughballVariants ?? []), { ...v }];
        changed = true;
      }
    }
    const byKey = new Map<string, NamedRecipeComponent>();
    for (const c of next.components) {
      const key = looseMergeIngredientKey(c.ingredient);
      if (key && !byKey.has(key)) byKey.set(key, c);
    }
    for (const sc of src.components) {
      const key = looseMergeIngredientKey(sc.ingredient);
      if (!key) continue;
      const tc = byKey.get(key);
      if (!tc) {
        const added: NamedRecipeComponent = { ingredient: sc.ingredient, lbs: sc.lbs };
        next.components.push(added);
        byKey.set(key, added);
        changed = true;
        continue;
      }
      if (!(tc.lbs > 0) && sc.lbs > 0) {
        tc.lbs = sc.lbs;
        changed = true;
      }
    }
  }
  if (!changed) return null;
  if (!next.doughballVariants || next.doughballVariants.length === 0) {
    delete next.doughballVariants;
  }
  return next;
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
  brand?: string;
  flavors?: ReadonlyArray<string>;
  doughballWeightOz?: number;
  doughballsPerTray?: number;
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
    brand: draft.brand ?? "",
    flavors: draft.flavors ?? [],
    doughballWeightOz: draft.doughballWeightOz,
    doughballsPerTray: draft.doughballsPerTray,
  });
}

// ---------------------------------------------------------------------------
// Brand/flavor tag fill (spec-import backfill)
// ---------------------------------------------------------------------------

/** "Who it goes to" tag learned for one recipe name during a spec import. */
export interface NamedRecipeTag {
  brand: string;
  /** Empty = all varieties of `brand` (whole-brand / catch-all recipe). */
  flavors: string[];
}

/**
 * Additively fill brand/flavor tags onto EXISTING pool recipes from what a spec
 * import just learned, without ever fighting a manager's explicit tags:
 * - untagged recipe (no brand) + learned tag → adopt the learned brand/flavors
 * - same brand (case-insensitive) → union the learned flavors in; a recipe
 *   already tagged "all varieties" (brand set, no flavors) stays all-varieties
 * - different brand already set → left untouched (the manager's tag wins)
 * Matching is by recipe NAME (case-insensitive). Returns ONLY the recipes that
 * changed so the caller can save just those. Pure — shared web/mobile.
 */
export function fillNamedRecipeTags(
  recipes: ReadonlyArray<NamedRecipe>,
  tagsByName: ReadonlyMap<string, NamedRecipeTag> | Record<string, NamedRecipeTag>,
): NamedRecipe[] {
  const tags = new Map<string, NamedRecipeTag>();
  const entries =
    tagsByName instanceof Map
      ? tagsByName.entries()
      : Object.entries(tagsByName);
  for (const [name, tag] of entries) {
    const key = (name ?? "").trim().toLowerCase();
    const brand = (tag?.brand ?? "").trim();
    if (!key || !brand) continue;
    tags.set(key, {
      brand,
      flavors: normalizeNamedRecipeFlavors(tag.flavors),
    });
  }
  if (tags.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const tag = tags.get(r.name.trim().toLowerCase());
    if (!tag) continue;
    if (!r.brand) {
      changed.push({ ...r, brand: tag.brand, flavors: [...tag.flavors] });
      continue;
    }
    if (r.brand.trim().toLowerCase() !== tag.brand.toLowerCase()) continue;
    // Same brand: union flavors — but "all varieties" (empty flavors) stays.
    if (r.flavors.length === 0) continue;
    if (tag.flavors.length === 0) {
      // Import says whole-brand; widen to all varieties.
      changed.push({ ...r, flavors: [] });
      continue;
    }
    const have = new Set(r.flavors.map((f) => f.toLowerCase()));
    const extra = tag.flavors.filter((f) => !have.has(f.toLowerCase()));
    if (extra.length === 0) continue;
    changed.push({ ...r, flavors: [...r.flavors, ...extra] });
  }
  return changed;
}

/**
 * Backfill doughball weights onto EXISTING pool dough recipes from what a spec
 * import just learned, without ever fighting a manager's explicit value: only
 * recipes whose weight is unset/0 adopt the learned weight. Matching is by
 * recipe NAME (case-insensitive). Returns ONLY the recipes that changed so the
 * caller can save just those. Pure — mirrors fillNamedRecipeTags.
 */
export function fillNamedRecipeDoughballWeights(
  recipes: ReadonlyArray<NamedRecipe>,
  weightsByName: ReadonlyMap<string, number> | Record<string, number>,
): NamedRecipe[] {
  const weights = new Map<string, number>();
  const entries =
    weightsByName instanceof Map
      ? weightsByName.entries()
      : Object.entries(weightsByName);
  for (const [name, oz] of entries) {
    const key = (name ?? "").trim().toLowerCase();
    if (!key || !Number.isFinite(oz) || oz <= 0) continue;
    weights.set(key, oz);
  }
  if (weights.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const oz = weights.get(r.name.trim().toLowerCase());
    if (oz === undefined) continue;
    if ((r.doughballWeightOz ?? 0) > 0) continue;
    changed.push({ ...r, doughballWeightOz: oz });
  }
  return changed;
}

/**
 * Backfill doughballs-per-tray onto EXISTING pool dough recipes from what a
 * spec import just learned, without ever fighting a manager's explicit value:
 * only recipes whose per-tray count is unset/0 adopt the learned count.
 * Matching is by recipe NAME (case-insensitive). Returns ONLY the recipes that
 * changed so the caller can save just those. Pure — mirrors
 * fillNamedRecipeDoughballWeights.
 */
export function fillNamedRecipeDoughballsPerTray(
  recipes: ReadonlyArray<NamedRecipe>,
  traysByName: ReadonlyMap<string, number> | Record<string, number>,
): NamedRecipe[] {
  const trays = new Map<string, number>();
  const entries =
    traysByName instanceof Map
      ? traysByName.entries()
      : Object.entries(traysByName);
  for (const [name, count] of entries) {
    const key = (name ?? "").trim().toLowerCase();
    const n = Math.round(count);
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    trays.set(key, n);
  }
  if (trays.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const n = trays.get(r.name.trim().toLowerCase());
    if (n === undefined) continue;
    if ((r.doughballsPerTray ?? 0) > 0) continue;
    changed.push({ ...r, doughballsPerTray: n });
  }
  return changed;
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
