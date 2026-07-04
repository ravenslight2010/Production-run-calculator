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
  lbs: number;
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
  return { ingredient, lbs };
}

// Clean a raw flavor list into trimmed, de-duplicated (case-insensitive),
// non-empty labels, preserving first-seen order.
function normalizeFlavors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const f = coerceStr(raw);
    if (!f) continue;
    const key = f.toLowerCase();
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
  components: ReadonlyArray<{ ingredient: string; lbs: number }>;
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
    components: draft.components,
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
