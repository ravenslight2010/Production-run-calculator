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
   * Ounces of this ingredient on ONE PIZZA — the unit spec sheets use. Kept in
   * its own column so a spec-sheet import can record per-pizza amounts without
   * ever touching the curated per-batch pounds (and vice versa: the cheese
   * workbook importer owns `lbs`). Absent/0 = not recorded.
   */
  ozPerPizza?: number;
  /**
   * This ingredient's share of the blend as a PERCENT (0–100). The blend is a
   * ratio: each flavor's actual per-ingredient oz/pizza is the flavor's cheese
   * applicator target oz × this share, so one blend serves flavors with
   * different cheese targets. Managers may enter it directly; absent/0 = not
   * recorded (derive from ozPerPizza or lbs proportions instead — see
   * cheeseComponentShares).
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
  const ozPerPizza = Math.max(0, coerceNum(raw.ozPerPizza, 0));
  const sharePct = Math.max(0, coerceNum(raw.sharePct, 0));
  const out: CheeseComponent = { ingredient, lbs };
  if (ozPerPizza > 0) out.ozPerPizza = ozPerPizza;
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
//   2. the recorded per-pizza ounce proportions (`ozPerPizza`),
//   3. the per-batch pound proportions (`lbs`).
// Whichever source is used, the returned fractions are normalized to sum to 1
// (or all zeros when the source has no usable numbers).

/**
 * Index-aligned blend-share FRACTIONS (0–1, summing to 1) for a component
 * list, using the sharePct → ozPerPizza → lbs priority above. Pure.
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
    pick(components.map((c) => Number(c.ozPerPizza ?? 0))) ??
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
 */
export function specCheeseDraftToRecipe(draft: {
  name: string;
  brand: string;
  flavors: string[];
  /**
   * Spec-sheet amounts are PER-PIZZA OUNCES and must arrive under `ozPerPizza`
   * so they land in the component's oz column — never masquerading as batch
   * pounds. `lbs` is only for callers that genuinely hold per-batch pounds
   * (e.g. the one-time local→server preset consolidation).
   */
  components: ReadonlyArray<{ ingredient: string; lbs?: number; ozPerPizza?: number }>;
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
      ozPerPizza: c.ozPerPizza ?? 0,
    })),
    enabled: true,
  });
}

/**
 * Add spec-import cheese recipes to the existing pool, skipping any whose NAME
 * already exists (case-insensitive) OR whose id already exists. This is the
 * "match, don't clobber" rule: a manager's curated recipe of the same name is
 * left untouched — the run applicator simply links to it by name — while a
 * genuinely new blend is appended. Pure. Returns the merged list plus how many
 * were actually added.
 */
export function addCheeseRecipesIfAbsentByName(
  existing: ReadonlyArray<CheeseRecipe>,
  candidates: ReadonlyArray<CheeseRecipe>,
): { merged: CheeseRecipe[]; added: number } {
  const haveNames = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const haveIds = new Set(existing.map((r) => r.id));
  const merged: CheeseRecipe[] = [...existing];
  let added = 0;
  for (const c of candidates) {
    const nameKey = c.name.trim().toLowerCase();
    if (!nameKey || haveNames.has(nameKey) || haveIds.has(c.id)) continue;
    haveNames.add(nameKey);
    haveIds.add(c.id);
    merged.push(c);
    added++;
  }
  return { merged, added };
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
 * Write spec-sheet PER-PIZZA OUNCES onto existing cheese recipes' components —
 * the `ozPerPizza` column ONLY. Per-batch `lbs` is never touched (that column
 * belongs to managers and the cheese workbook importer), so a spec import can
 * refresh per-pizza amounts without any risk of corrupting curated batch
 * pounds. Recipes are matched by trimmed case-insensitive NAME; within a
 * matched recipe, components are matched by trimmed case-insensitive
 * ingredient name. Unmatched update ingredients are ignored (no components are
 * added or removed). Pure. Returns the next list plus how many RECIPES had at
 * least one component's ozPerPizza actually change.
 */
export function applyCheeseOzPerPizza(
  existing: ReadonlyArray<CheeseRecipe>,
  updates: ReadonlyArray<{
    name: string;
    components: ReadonlyArray<{ ingredient: string; ozPerPizza: number }>;
  }>,
): { next: CheeseRecipe[]; updated: number } {
  const byName = new Map<
    string,
    Map<string, number>
  >();
  for (const u of updates) {
    const nameKey = u.name.trim().toLowerCase();
    if (!nameKey) continue;
    const oz = new Map<string, number>();
    for (const c of u.components) {
      const ing = c.ingredient.trim().toLowerCase();
      const v = Number(c.ozPerPizza);
      if (!ing || !Number.isFinite(v) || v <= 0) continue;
      if (!oz.has(ing)) oz.set(ing, v);
    }
    if (oz.size) byName.set(nameKey, oz);
  }
  if (!byName.size) return { next: [...existing], updated: 0 };
  let updated = 0;
  const next = existing.map((r) => {
    const oz = byName.get(r.name.trim().toLowerCase());
    if (!oz) return r;
    let changed = false;
    const components = r.components.map((c) => {
      const v = oz.get(c.ingredient.trim().toLowerCase());
      if (v === undefined || c.ozPerPizza === v) return c;
      changed = true;
      return { ...c, ozPerPizza: v };
    });
    if (!changed) return r;
    updated++;
    return { ...r, components };
  });
  return { next, updated };
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
