// Shared "cheese recipes" model for the run calculator (web + mobile parity).
//
// A "cheese recipe" is a named cheese blend a customer uses on the line — the
// thing the old local "Cheese Recipe" presets described, now promoted to
// factory-wide server master-data that works like Mixes: managers define them
// once, an importer can build them from the "Cheese Mix Recipe Specs" workbook,
// and the run applicator "Cheese" cards pick one (hydrating their rows from the
// chosen recipe) instead of each device keeping its own preset list.
//
// Each recipe names the customer it belongs to (`brand`), the product flavors it
// is assigned to (`flavors` — the "Pepperoni: Whole Mozz Cheese Mix" style
// assignment lines on the spec sheet; empty = applies to any flavor / "All
// Varieties"), the customer's cheese-shredder setting, an optional cellulose
// note, free-form notes, and a list of components — each an ingredient and its
// PER-BATCH pounds. (Cheese recipes are batch-ratio; there is no reliable
// per-pizza figure, which is why this model uses `lbs` per batch rather than the
// Mix model's per-pizza ounces.)
//
// This module is PURE so both apps agree on what a well-formed cheese recipe is
// and how the list is browsed. Definitions are stored factory-wide on the server
// (NOT in the per-day sync payload) and edited by managers only; the apps keep
// only thin platform glue (fetch/save/delete) plus the run-side hydration.

import { brandPrefixedName } from "@workspace/name-match";

// One component of a cheese recipe: an ingredient and how many POUNDS of it go
// into a single batch of the finished blend. This matches the per-batch "LBS"
// column on the Cheese Mix Recipe Specs sheets and the existing per-run
// `appNCheeseRecipe` RecipeRow shape ({ ingredient, lbs }) so hydration is a
// straight copy.
export interface CheeseComponent {
  ingredient: string;
  /** Pounds of this ingredient in one BATCH of the blend (manager-entered). */
  lbs: number;
  /**
   * This ingredient's share of the blend as a PERCENT (0–100). The blend is a
   * ratio: each flavor's actual per-ingredient oz/pizza is the flavor's cheese
   * applicator target oz × this share, so one blend serves flavors with
   * different cheese targets. Managers may enter it directly; absent/0 = not
   * recorded (derive from lbs proportions instead — see cheeseComponentShares).
   */
  sharePct?: number;
}

// A single manager-defined cheese recipe. Flat shape (plus a components array)
// so it serializes cleanly to the API/DB and is easy to edit field-by-field in
// the UI, mirroring the Mix model.
export interface CheeseRecipe {
  id: string;
  // Optional persistence scope (live vs sandbox); carried through opaquely.
  scope?: string;
  // Display name of the cheese mix (e.g. "Whole Mozz Cheese Mix").
  name: string;
  // The customer this recipe belongs to (the spec-sheet tab). Empty = any.
  brand: string;
  // The product flavors this recipe is assigned to (the per-flavor assignment
  // lines). Empty list = applies to any flavor of the brand ("All Varieties").
  flavors: string[];
  // The customer's cheese-shredder setting as printed on the sheet (e.g. "3").
  // Kept as a string so labels like "3.5" or "#4" survive verbatim.
  shredderSetting: string;
  // Optional cellulose metadata from the sheet's Cellulose/Percent pair.
  cellulose: string;
  // Free-form notes.
  notes: string;
  // The ingredients that make up one batch of the recipe.
  components: CheeseComponent[];
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
export function normalizeCheeseComponent(input: unknown): CheeseComponent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const ingredient = coerceStr(raw.ingredient);
  if (!ingredient) return null;
  const lbs = Math.max(0, coerceNum(raw.lbs, 0));
  const sharePct = Math.max(0, coerceNum(raw.sharePct, 0));
  const out: CheeseComponent = { ingredient, lbs };
  if (sharePct > 0) out.sharePct = sharePct;
  return out;
}

// Whole-brand "catch-all" flavor labels that mean "applies to EVERY flavor of
// the brand" rather than naming one specific product flavor. The CheeseRecipe
// contract represents that as an EMPTY flavors list (see the `flavors` doc
// above), so these labels are dropped during normalization: an "All Varieties"
// blend then matches every flavor in the run / setup pickers instead of being
// hidden the moment a specific flavor (e.g. "Meat Lovers") is selected. Mirrors
// the CATCH_ALL_FLAVORS set in @workspace/spec-import; kept as a small local
// copy so this low-level model stays dependency-free.
const CATCH_ALL_FLAVOR_WORDS = new Set([
  "all",
  "all varieties",
  "all variety",
  "all flavors",
  "all flavours",
  "all flavor",
  "every variety",
  "any",
  "n/a",
  "na",
]);

// Clean a raw flavor list into trimmed, de-duplicated (case-insensitive),
// non-empty labels, preserving first-seen order. Whole-brand catch-all labels
// ("All Varieties", etc.) are dropped so they collapse to the empty = "applies
// to any flavor" representation the rest of the app relies on.
function normalizeFlavors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const f = coerceStr(raw);
    if (!f) continue;
    const key = f.toLowerCase();
    if (CATCH_ALL_FLAVOR_WORDS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// Coerce a raw API/DB record into a clean CheeseRecipe, or null if it has no
// usable name. Numeric component pounds are clamped to >= 0; enabled defaults to
// true; malformed components are dropped.
export function normalizeCheeseRecipe(input: unknown): CheeseRecipe | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = coerceStr(raw.name);
  if (!name) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id : name.toLowerCase();
  const brand = coerceStr(raw.brand);
  const flavors = normalizeFlavors(raw.flavors);
  const shredderSetting = coerceStr(raw.shredderSetting);
  const cellulose = coerceStr(raw.cellulose);
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false;
  const components = Array.isArray(raw.components)
    ? raw.components
        .map(normalizeCheeseComponent)
        .filter((c): c is CheeseComponent => c !== null)
    : [];
  const recipe: CheeseRecipe = {
    id,
    name,
    brand,
    flavors,
    shredderSetting,
    cellulose,
    notes: coerceStr(raw.notes),
    components,
    enabled,
  };
  if (typeof raw.scope === "string" && raw.scope) recipe.scope = raw.scope;
  return recipe;
}

// Normalize a list, dropping malformed entries and collapsing duplicate ids onto
// the last-seen entry.
export function normalizeCheeseRecipes(input: unknown): CheeseRecipe[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, CheeseRecipe>();
  for (const raw of input) {
    const recipe = normalizeCheeseRecipe(raw);
    if (!recipe) continue;
    byId.set(recipe.id, recipe);
  }
  return Array.from(byId.values());
}

// Total pounds of one batch (sum of component pounds).
export function cheeseRecipeTotalLbs(recipe: CheeseRecipe): number {
  return recipe.components.reduce((acc, c) => acc + c.lbs, 0);
}

// ---------------------------------------------------------------------------
// Blend shares (ratio model)
// ---------------------------------------------------------------------------
// A cheese blend is fundamentally a RATIO: each ingredient owns a share of the
// mix, and a flavor's actual per-ingredient oz/pizza is that flavor's cheese
// applicator target oz × the share. Shares come from (in priority order):
//   1. explicit manager-entered `sharePct` values,
//   2. the per-batch pound proportions (`lbs`).
// Whichever source is used, the returned fractions are normalized to sum to 1
// (or all zeros when no source has usable numbers).

/**
 * Index-aligned blend-share FRACTIONS (0–1, summing to 1) for a component
 * list, using the sharePct → lbs priority above. Pure.
 */
export function cheeseComponentShares(
  components: ReadonlyArray<CheeseComponent>,
): number[] {
  const pick = (vals: number[]): number[] | null => {
    const total = vals.reduce((s, v) => s + (v > 0 ? v : 0), 0);
    if (!(total > 0)) return null;
    return vals.map((v) => (v > 0 ? v / total : 0));
  };
  return (
    pick(components.map((c) => Number(c.sharePct ?? 0))) ??
    pick(components.map((c) => Number(c.lbs ?? 0))) ??
    components.map(() => 0)
  );
}

/**
 * Per-ingredient oz on ONE PIZZA for a flavor whose cheese applicator target
 * is `targetOzPerPizza`: target × each component's blend share. Index-aligned
 * with `components`; rows sum to the target when shares exist. Pure.
 */
export function cheesePerFlavorComponentOz(
  components: ReadonlyArray<CheeseComponent>,
  targetOzPerPizza: number,
): { rows: number[]; totalOz: number } {
  const oz = Number.isFinite(targetOzPerPizza) ? Math.max(0, targetOzPerPizza) : 0;
  const rows = cheeseComponentShares(components).map((s) => s * oz);
  return { rows, totalOz: rows.reduce((s, v) => s + v, 0) };
}

/**
 * For a CATCH-ALL (empty flavors) recipe's editor preview coverage: decide
 * whether a flavor should be SKIPPED because its saved profile's cheese card
 * is name-linked to a DIFFERENT existing cheese recipe. Returns the linked
 * recipe's canonical name when the flavor should be skipped, or null when it
 * should stay in the preview. Pure.
 *
 * Rules:
 * - If ANY slot is linked (case-insensitive) to `recipeName` itself, never
 *   skip — an explicit link to this recipe wins.
 * - Otherwise, if some slot names a DIFFERENT recipe that actually exists in
 *   `knownRecipeNames`, skip and report that recipe's name (first match).
 * - Slot names that don't match any known recipe are ignored (stale links
 *   shouldn't hide coverage).
 */
export function catchAllPreviewSkipReason(
  slotRecipeNames: ReadonlyArray<string>,
  recipeName: string,
  knownRecipeNames: ReadonlyArray<string>,
): string | null {
  const selfLc = recipeName.trim().toLowerCase();
  const known = new Map<string, string>();
  for (const n of knownRecipeNames) {
    const t = n.trim();
    if (t) known.set(t.toLowerCase(), t);
  }
  let other: string | null = null;
  for (const raw of slotRecipeNames) {
    const lc = raw.trim().toLowerCase();
    if (!lc) continue;
    if (selfLc && lc === selfLc) return null;
    if (other === null) {
      const canonical = known.get(lc);
      if (canonical !== undefined && lc !== selfLc) other = canonical;
    }
  }
  return other;
}

/**
 * One-time additive backfill: fill in `sharePct` (percent, 2dp) on components
 * that don't have one yet, derived from the recipe's existing ozPerPizza or
 * lbs proportions. Existing sharePct values are NEVER changed; recipes with no
 * usable numbers are left alone. Returns ONLY the recipes that changed. Pure —
 * used by the server data heal so old blends convert to the ratio model.
 */
export function backfillCheeseSharePcts(
  recipes: ReadonlyArray<CheeseRecipe>,
): CheeseRecipe[] {
  const changed: CheeseRecipe[] = [];
  for (const r of recipes) {
    const shares = cheeseComponentShares(r.components);
    let touched = false;
    const components = r.components.map((c, i) => {
      if ((c.sharePct ?? 0) > 0) return c;
      const pct = Math.round(shares[i] * 10000) / 100;
      if (!(pct > 0)) return c;
      touched = true;
      return { ...c, sharePct: pct };
    });
    if (touched) changed.push({ ...r, components });
  }
  return changed;
}

/**
 * Add importer-detected cheese recipes to the existing list, skipping any whose
 * id already exists. Pure. Returns the merged list plus how many were actually
 * added. (Callers that want update-by-id semantics use mergeCheeseRecipes.)
 */
export function addCheeseRecipesIfAbsent(
  existing: ReadonlyArray<CheeseRecipe>,
  candidates: ReadonlyArray<CheeseRecipe>,
): { merged: CheeseRecipe[]; added: number } {
  const haveIds = new Set(existing.map((r) => r.id));
  const merged: CheeseRecipe[] = [...existing];
  let added = 0;
  for (const c of candidates) {
    if (!c.id || haveIds.has(c.id)) continue;
    haveIds.add(c.id);
    merged.push(c);
    added++;
  }
  return { merged, added };
}

/**
 * Build a well-formed CheeseRecipe from a spec-sheet-detected cheese blend
 * draft (name + brand + flavors + components). A deterministic, name-slug id is
 * used so re-importing the same sheet targets the same recipe instead of
 * duplicating it. shredderSetting/cellulose/notes are left blank for a manager
 * to fill in the editor; the recipe is enabled so run pickers see it right away.
 * Pure — shared by web + mobile so a spec-import cheese recipe is identical on
 * both platforms.
 *
 * Component `lbs` values from a SpecCheeseRecipeDraft are proportional amounts
 * (the spec sheet's per-pizza ounces used as ratio seeds). `ozPerPizza` is
 * deliberately NOT written onto recipe components — that column belongs to
 * applicator slots, not recipes.
 */
export function specCheeseDraftToRecipe(draft: {
  name: string;
  brand: string;
  flavors: string[];
  /**
   * Component amounts. `lbs` is real per-batch pounds (0 for spec-import stubs
   * — managers fill in real values in the editor). `sharePct` (0–100, 2dp) is
   * the ingredient's percentage of the blend, derived from oz proportions during
   * import so blend ratios are preserved even before real batch lbs are entered.
   */
  components: ReadonlyArray<{ ingredient: string; lbs?: number; sharePct?: number }>;
}): CheeseRecipe | null {
  const name = draft.name.trim();
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalizeCheeseRecipe({
    id: slug ? `cheese:spec:${slug}` : name.toLowerCase(),
    name,
    brand: draft.brand,
    flavors: draft.flavors,
    shredderSetting: "",
    cellulose: "",
    notes: "",
    components: draft.components.map((c) => ({
      ingredient: c.ingredient,
      lbs: c.lbs ?? 0,
      ...(c.sharePct ? { sharePct: c.sharePct } : {}),
    })),
    enabled: true,
  });
}

/**
 * Apply the compatible portion of a regular production spec to a curated
 * cheese recipe. Regular specs express component weights as per-pizza ounces;
 * collectSpecImportCheeseRecipes turns those amounts into `sharePct`, while
 * keeping `lbs` at zero because the pool's pounds are per-batch.
 *
 * A spec refresh therefore treats its positive component shares as the current
 * ratio definition. It keeps every existing per-batch pound value, clears a
 * stale explicit share from components the sheet no longer mentions, and adds
 * newly mentioned ingredients at zero batch pounds. This lets the current sheet
 * update the blend used on the line without turning ounces into erroneous batch
 * pounds.
 */
function mergeSpecCheeseComponents(
  existing: CheeseComponent[],
  specComponents: ReadonlyArray<CheeseComponent>,
): CheeseComponent[] {
  const sharesByIngredient = new Map<string, number>();
  for (const component of specComponents) {
    const ingredient = component.ingredient.trim();
    const sharePct = Number(component.sharePct);
    if (
      !ingredient ||
      !Number.isFinite(sharePct) ||
      sharePct <= 0 ||
      sharesByIngredient.has(ingredient.toLowerCase())
    ) {
      continue;
    }
    sharesByIngredient.set(ingredient.toLowerCase(), sharePct);
  }
  if (sharesByIngredient.size === 0) return existing;

  let changed = false;
  const seen = new Set<string>();
  const merged = existing.map((component) => {
    const key = component.ingredient.trim().toLowerCase();
    seen.add(key);
    const sharePct = sharesByIngredient.get(key);
    if (sharePct === undefined) {
      if (component.sharePct === undefined) return component;
      changed = true;
      const { sharePct: _staleShare, ...withoutShare } = component;
      return withoutShare;
    }
    if (component.sharePct === sharePct) return component;
    changed = true;
    return { ...component, sharePct };
  });

  for (const component of specComponents) {
    const ingredient = component.ingredient.trim();
    const key = ingredient.toLowerCase();
    const sharePct = sharesByIngredient.get(key);
    if (!ingredient || sharePct === undefined || seen.has(key)) continue;
    changed = true;
    seen.add(key);
    merged.push({ ingredient, lbs: 0, sharePct });
  }

  return changed ? merged : existing;
}

/**
 * Upsert spec-import cheese recipes into the existing pool. For each candidate:
 *
 * • Same-scope name match (same brand, or either side unbranded): update the
 *   existing recipe's flavors and compatible component data from the sheet
 *   while preserving manager-typed fields the spec sheet never carries
 *   (`cellulose`, `shredderSetting`, `enabled`, `notes`). Regular production
 *   specs refresh component shares only; cheese-workbook candidates carrying
 *   real per-batch pounds still replace components wholesale. The stable pool
 *   id and the display name casing from the existing record are kept.
 * • Same id, different name: also updates the existing recipe (same recipe,
 *   re-imported with fresh data).
 * • Cross-brand-only collision on a BRANDED candidate: kept apart by prefixing
 *   the new entry with its brand ("Lucia's Taco Mix"). A re-import of that
 *   workbook will find the prefixed row by name and update it in place.
 * • Genuinely new (no name or id match): appended as-is.
 *
 * BRAND SCOPE: a match only counts when the candidate and the pool row belong
 * to the same customer or either side is unbranded (an unbranded pool row is
 * shared/curated master-data any brand may link to).
 *
 * Within a single candidate batch the first entry for a given name wins;
 * subsequent candidates for the same existing recipe are silently ignored.
 * Pure. Returns the merged list plus how many were added (new) and updated.
 */
export function addCheeseRecipesIfAbsentByName(
  existing: ReadonlyArray<CheeseRecipe>,
  candidates: ReadonlyArray<CheeseRecipe>,
): { merged: CheeseRecipe[]; added: number; updated: number } {
  const brandKeyOf = (r: { brand?: string }) => (r.brand ?? "").trim().toLowerCase();
  const merged: CheeseRecipe[] = [...existing];
  let added = 0;
  let updated = 0;
  // Track which existing-recipe ids were already updated this pass so two
  // candidates naming the same recipe don't both apply.
  const alreadyUpdated = new Set<string>();
  // Track names and ids now represented in `merged` (existing + newly added) for
  // within-batch dedup of genuinely new candidates.
  const mergedIds = new Set<string>(existing.map((r) => r.id));
  // Same scope = same brand, or either side unbranded.
  const inScope = (candBrand: string, rowBrand: string) =>
    !candBrand || !rowBrand || candBrand === rowBrand;

  // Apply an import upsert onto an existing recipe: overwrite content fields
  // (components, flavors, brand) but preserve manager-typed fields the spec
  // sheet cannot carry. Keeps the existing stable id and display name.
  //
  // COMPONENT GUARD: spec sheets store per-pizza ounces in the `lbs` field as a
  // parser quirk; `collectSpecImportCheeseRecipes` normalises these to `lbs: 0`
  // with `sharePct` as the ratio seed. Overwriting a manager's curated
  // per-BATCH pounds (e.g. 207 lbs) with those zero stubs would corrupt the
  // pool, so components are only replaced when the candidate carries at least
  // one component with lbs > 0 (i.e. it comes from a Cheese Mix Recipe Specs
  // workbook, not a regular spec sheet). When the candidate has all lbs=0 we
  // keep the existing components and only update flavors and brand, which are
  // always safe to refresh from the import.
  const upsertAtIdx = (idx: number, c: CheeseRecipe): void => {
    const prev = merged[idx];
    if (alreadyUpdated.has(prev.id)) return; // first candidate wins per existing recipe
    alreadyUpdated.add(prev.id);
    const candidateHasRealLbs = c.components.some((comp) => (comp.lbs ?? 0) > 0);
    const components = candidateHasRealLbs
      ? c.components
      : mergeSpecCheeseComponents(prev.components, c.components);
    const next: CheeseRecipe = {
      ...c,
      id: prev.id,    // keep stable existing id
      name: prev.name, // keep existing display name / casing
      // Components: use candidate's when it carries real per-batch lbs (cheese
      // workbook); regular specs refresh only explicit ratios and keep the
      // manager-entered per-batch pounds intact.
      components,
      // Preserve manager-typed fields the spec sheet cannot carry.
      // cellulose: keep any non-empty stored value; fall back to candidate's.
      cellulose: (prev.cellulose ?? "") || (c.cellulose ?? ""),
      // shredderSetting / enabled / notes: manager's stored value always wins
      // (even an empty-string clear or a false flag is intentional).
      shredderSetting: prev.shredderSetting !== undefined ? prev.shredderSetting : (c.shredderSetting ?? ""),
      enabled: prev.enabled !== undefined ? prev.enabled : (c.enabled ?? true),
      notes: prev.notes !== undefined ? prev.notes : c.notes,
    };
    // Only mark as updated (and trigger a save) when the resulting recipe
    // actually differs from the stored one — avoids spurious saves when a
    // spec-sheet re-import produces a candidate byte-identical to the pool.
    // Optional string fields normalize to "" so undefined vs "" is not a diff.
    const differs =
      next.components !== prev.components || // reference equality: same ref = no change
      JSON.stringify(next.flavors) !== JSON.stringify(prev.flavors ?? []) ||
      (next.brand ?? "") !== (prev.brand ?? "") ||
      (next.cellulose ?? "") !== (prev.cellulose ?? "") ||
      (next.shredderSetting ?? "") !== (prev.shredderSetting ?? "") ||
      (next.enabled ?? true) !== (prev.enabled ?? true) ||
      (next.notes ?? "") !== (prev.notes ?? "");
    if (!differs) return;
    merged[idx] = next;
    updated++;
  };

  for (const c of candidates) {
    const name = c.name.trim();
    let nameKey = name.toLowerCase();
    if (!nameKey) continue;
    const candBrand = brandKeyOf(c);

    // Same-scope name match → update existing recipe's content (spec wins).
    const nameMatchIdx = merged.findIndex(
      (r) => r.name.trim().toLowerCase() === nameKey && inScope(candBrand, brandKeyOf(r)),
    );
    if (nameMatchIdx >= 0) {
      upsertAtIdx(nameMatchIdx, c);
      continue;
    }

    let next = c;
    if (candBrand && merged.some((r) => r.name.trim().toLowerCase() === nameKey)) {
      // Cross-brand-only collision on a branded candidate: keep both apart by
      // prefixing the new one with its brand.
      const prefixed = brandPrefixedName((c.brand ?? "").trim(), name);
      const prefixedKey = prefixed.toLowerCase();
      if (prefixedKey === nameKey) continue; // already brand-prefixed yet still colliding — treat as dup
      // Re-import: the prefixed row may already exist in this brand's scope.
      const prefixedMatchIdx = merged.findIndex(
        (r) => r.name.trim().toLowerCase() === prefixedKey && inScope(candBrand, brandKeyOf(r)),
      );
      if (prefixedMatchIdx >= 0) {
        upsertAtIdx(prefixedMatchIdx, { ...c, name: prefixed, id: respecCheeseId(c.id, prefixed) });
        continue;
      }
      next = { ...c, name: prefixed, id: respecCheeseId(c.id, prefixed) };
      nameKey = prefixedKey;
    }

    // Same-id match (same recipe re-imported under a different or unresolved name).
    if (mergedIds.has(next.id)) {
      const idMatchIdx = merged.findIndex((r) => r.id === next.id);
      if (idMatchIdx >= 0) upsertAtIdx(idMatchIdx, next);
      continue;
    }

    // Genuinely new recipe: append and track so later candidates can't re-add
    // or overwrite it (alreadyUpdated prevents upsertAtIdx from firing on the
    // newly-appended row; mergedIds prevents the id-match path from reaching it).
    mergedIds.add(next.id);
    alreadyUpdated.add(next.id);
    merged.push(next);
    added++;
  }
  return { merged, added, updated };
}

/**
 * Re-derive a spec-import cheese recipe id after a brand-prefix rename. Only
 * `cheese:spec:` ids are name-derived (see specCheeseDraftToRecipe) and would
 * otherwise collide across brands sharing a blend name; ids from other
 * namespaces (workbook import, manual) are already unique and kept as-is.
 */
function respecCheeseId(id: string, name: string): string {
  if (!id.startsWith("cheese:spec:")) return id;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `cheese:spec:${slug}` : id;
}

/**
 * Backfill customer tags onto existing cheese recipes that have NO brand yet,
 * from spec-import drafts matched by trimmed case-insensitive name. Only fully
 * unbranded recipes are touched (a recipe already scoped to a customer is
 * never re-scoped), and only from a draft that actually carries a brand.
 * Flavors are copied only when the recipe has none (an empty flavors list on a
 * BRANDED recipe means "All Varieties" — deliberate, never overwritten).
 * Pure. Returns the next list plus how many recipes were tagged.
 */
export function fillCheeseRecipeTags(
  existing: ReadonlyArray<CheeseRecipe>,
  drafts: ReadonlyArray<{ name: string; brand: string; flavors: ReadonlyArray<string> }>,
): { next: CheeseRecipe[]; tagged: number } {
  const byName = new Map<string, { brand: string; flavors: string[] }>();
  for (const d of drafts) {
    const key = d.name.trim().toLowerCase();
    const brand = d.brand.trim();
    if (!key || !brand || byName.has(key)) continue;
    byName.set(key, {
      brand,
      flavors: d.flavors.map((f) => f.trim()).filter(Boolean),
    });
  }
  let tagged = 0;
  const next = existing.map((r) => {
    if ((r.brand ?? "").trim()) return r;
    const d = byName.get(r.name.trim().toLowerCase());
    if (!d) return r;
    tagged++;
    return {
      ...r,
      brand: d.brand,
      flavors: (r.flavors ?? []).length ? r.flavors : d.flavors,
    };
  });
  return { next, tagged };
}

/**
 * Merge imported cheese recipes into the existing list BY ID: an imported
 * recipe replaces the existing one with the same id, otherwise it is appended.
 * Order is preserved (existing first, then genuinely new). Pure — mirrors the
 * premix mergePremixIntoMixes helper.
 */
export function mergeCheeseRecipes(
  existing: ReadonlyArray<CheeseRecipe>,
  imported: ReadonlyArray<CheeseRecipe>,
): CheeseRecipe[] {
  const byId = new Map<string, CheeseRecipe>();
  for (const r of existing) byId.set(r.id, r);
  const order: string[] = existing.map((r) => r.id);
  for (const r of imported) {
    if (!byId.has(r.id)) order.push(r.id);
    byId.set(r.id, r);
  }
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

// Re-point cheese recipes when brands are merged. Cheese recipes are
// server-backed master-data (their own table, NOT part of day-state sync), so a
// brand merge — which only rewrites local brand/flavor lists and today's runs —
// leaves them naming the merged-away brand, and they keep showing under the old
// heading in the Cheese Recipes manager. Returns ONLY the recipes whose brand
// changed (with `brand` rewritten to the target), so the caller can upsert just
// those.
export function repointCheeseRecipesForBrandMerge(
  recipes: ReadonlyArray<CheeseRecipe>,
  sources: ReadonlyArray<string>,
  target: string,
): CheeseRecipe[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: CheeseRecipe[] = [];
  for (const r of recipes) {
    if (srcSet.has(r.brand.trim().toLowerCase())) {
      changed.push({ ...r, brand: tgt });
    }
  }
  return changed;
}

/**
 * Rename one customer (brand) group in the cheese-recipes pool (Manage Lists
 * "rename / merge brand" control). Every recipe whose brand matches `from`
 * (case-insensitive) is rewritten to `to`. Unlike the merge repoint helper
 * this ALLOWS a case-only respelling ("aldos" → "Aldo's"); renaming to
 * another existing customer's name merges the groups (grouping is
 * case-insensitive). Returns only the changed rows. Pure.
 */
export function renameCheeseRecipesBrand(
  recipes: ReadonlyArray<CheeseRecipe>,
  from: string,
  to: string,
): CheeseRecipe[] {
  const tgt = to.trim();
  const fromKey = from.trim().toLowerCase();
  if (!tgt || !fromKey || from.trim() === tgt) return [];
  const changed: CheeseRecipe[] = [];
  for (const r of recipes) {
    if (r.brand.trim().toLowerCase() === fromKey && r.brand.trim() !== tgt) {
      changed.push({ ...r, brand: tgt });
    }
  }
  return changed;
}

// Re-point cheese recipes when flavors are merged WITHIN a brand. A flavor merge
// keeps the recipe under the same brand, but its per-flavor assignment list
// (`flavors`) can still name a merged-away flavor. Returns ONLY the recipes of
// that brand whose `flavors` list actually changed (source flavors rewritten to
// the target, de-duplicated case-insensitively, order preserved). Recipes with
// an empty flavors list ("All Varieties") already cover every flavor, so they
// are left alone.
export function repointCheeseRecipesForFlavorMerge(
  recipes: ReadonlyArray<CheeseRecipe>,
  brand: string,
  sources: ReadonlyArray<string>,
  target: string,
): CheeseRecipe[] {
  const b = brand.trim().toLowerCase();
  const tgt = target.trim();
  if (!b || !tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: CheeseRecipe[] = [];
  for (const r of recipes) {
    if (r.brand.trim().toLowerCase() !== b) continue;
    if (!r.flavors.some((f) => srcSet.has(f.trim().toLowerCase()))) continue;
    const seen = new Set<string>();
    const nextFlavors: string[] = [];
    for (const f of r.flavors) {
      const mapped = srcSet.has(f.trim().toLowerCase()) ? tgt : f;
      const key = mapped.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      nextFlavors.push(mapped);
    }
    changed.push({ ...r, flavors: nextFlavors });
  }
  return changed;
}

// Re-point cheese-recipe COMPONENT ingredient names when an ingredient is merged
// in the Merge tool. Cheese recipes are server-backed master-data (NOT part of
// day-state sync), so an ingredient merge — which only rewrites local
// lists/presets/runs — leaves the server recipes naming the merged-away
// ingredient, and it resurfaces when a run hydrates its rows from the pool.
// Rewrites each matching component's `ingredient` to the target; rows are NOT
// combined (both rows are kept so total weight is preserved exactly, mirroring
// mergeRecipeRows). Returns ONLY the recipes that changed, matched
// case-insensitively.
export function repointCheeseRecipeIngredients(
  recipes: ReadonlyArray<CheeseRecipe>,
  sources: ReadonlyArray<string>,
  target: string,
): CheeseRecipe[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: CheeseRecipe[] = [];
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

// ---------------------------------------------------------------------------
// Merge backfill (recipe-name merges must carry data)
// ---------------------------------------------------------------------------

// Loose ingredient-name key used to line up component rows between a merge's
// target and source recipes: lowercase, split on non-alphanumerics, tokens
// SORTED then joined — so "Cow's Romano" matches "Cows Romano" and
// "Pepperoni, Diced" matches "Diced Pepperoni" (word reorder folds).
function looseIngredientKey(name: string): string {
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
 * Backfill a merge TARGET cheese recipe from the recipes being merged away,
 * BEFORE the sources are deleted from the server pool. Blank-fill-only: real
 * data already on the target is never clobbered — the source only fills gaps.
 * - Component rows are matched by loose ingredient name; a matched target row
 *   gets lbs / ozPerPizza / sharePct filled only where it has none, and
 *   source-only rows (e.g. Cellulose) are appended.
 * - shredderSetting / cellulose / notes fill only when blank on the target.
 * - brand (+ flavors) are adopted only when the target has NO brand; a branded
 *   target's empty flavors list means "All Varieties" and is left alone.
 * Sources are folded in order (earlier sources win ties among themselves).
 * Returns the enriched recipe, or null when nothing changed. Pure.
 */
export function backfillCheeseRecipeFromMergedSources(
  target: CheeseRecipe,
  sources: ReadonlyArray<CheeseRecipe>,
): CheeseRecipe | null {
  let changed = false;
  let next: CheeseRecipe = {
    ...target,
    components: target.components.map((c) => ({ ...c })),
    flavors: [...target.flavors],
  };
  for (const src of sources) {
    // Field-level blank fills.
    if (!next.shredderSetting.trim() && src.shredderSetting.trim()) {
      next.shredderSetting = src.shredderSetting;
      changed = true;
    }
    if (!next.cellulose.trim() && src.cellulose.trim()) {
      next.cellulose = src.cellulose;
      changed = true;
    }
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
    // Component rows: fill matched rows' blank numbers, append missing rows.
    const byKey = new Map<string, CheeseComponent>();
    for (const c of next.components) {
      const key = looseIngredientKey(c.ingredient);
      if (key && !byKey.has(key)) byKey.set(key, c);
    }
    for (const sc of src.components) {
      const key = looseIngredientKey(sc.ingredient);
      if (!key) continue;
      const tc = byKey.get(key);
      if (!tc) {
        const added: CheeseComponent = { ingredient: sc.ingredient, lbs: sc.lbs };
        if ((sc.sharePct ?? 0) > 0) added.sharePct = sc.sharePct;
        next.components.push(added);
        byKey.set(key, added);
        changed = true;
        continue;
      }
      if (!(tc.lbs > 0) && sc.lbs > 0) {
        tc.lbs = sc.lbs;
        changed = true;
      }
      if (!((tc.sharePct ?? 0) > 0) && (sc.sharePct ?? 0) > 0) {
        tc.sharePct = sc.sharePct;
        changed = true;
      }
    }
  }
  return changed ? next : null;
}

// ---------------------------------------------------------------------------
// List browsing (search + brand grouping for the settings UI)
// ---------------------------------------------------------------------------

/** Case-insensitive match of a search query against name/brand/flavors. */
export function cheeseRecipeMatchesQuery(recipe: CheeseRecipe, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    recipe.name.toLowerCase().includes(q) ||
    recipe.brand.toLowerCase().includes(q) ||
    recipe.flavors.some((f) => f.toLowerCase().includes(q))
  );
}

export interface CheeseRecipeBrandGroup {
  /** Trimmed brand name; "" for recipes with no brand (sorted last). */
  brand: string;
  /** The customer's shredder setting (first non-empty among the group). */
  shredderSetting: string;
  recipes: CheeseRecipe[];
}

/**
 * Group cheese recipes by brand for a browsable settings list: brands sorted
 * alphabetically (case-insensitive), the no-brand group last, and recipes
 * inside each group sorted by name. The group's shredder setting is the first
 * non-empty one found (all recipes on a customer tab share it). Pure — used by
 * BOTH web and mobile so the two lists can't drift.
 */
export function groupCheeseRecipesByBrand(
  recipes: ReadonlyArray<CheeseRecipe>,
): CheeseRecipeBrandGroup[] {
  const byBrand = new Map<string, CheeseRecipeBrandGroup>();
  for (const recipe of recipes) {
    const brand = recipe.brand.trim();
    const key = brand.toLowerCase();
    const g = byBrand.get(key);
    if (g) {
      g.recipes.push(recipe);
      if (!g.shredderSetting && recipe.shredderSetting) {
        g.shredderSetting = recipe.shredderSetting;
      }
    } else {
      byBrand.set(key, {
        brand,
        shredderSetting: recipe.shredderSetting,
        recipes: [recipe],
      });
    }
  }
  const groups = [...byBrand.values()];
  for (const g of groups) {
    g.recipes.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }
  groups.sort((a, b) => {
    if (!a.brand && b.brand) return 1;
    if (a.brand && !b.brand) return -1;
    return a.brand.localeCompare(b.brand, undefined, { sensitivity: "base" });
  });
  return groups;
}
