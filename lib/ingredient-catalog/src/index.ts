// Shared "ingredient catalog" model for the run calculator (web + mobile
// parity). See lib/db/src/schema/ingredients.ts for the full design rationale.
//
// An Ingredient is a factory-wide, server-managed catalog entry with a stable
// id. Recipe rows (dough/cheese/frontline) reference an ingredient by id;
// this module owns PURE resolution — turning an id (or a legacy bare name) back
// into the current display name — plus normalization for the API/DB layer.
// Nothing here talks to the network or storage; both apps call these helpers
// around their own fetch/cache glue.

export type IngredientCategory =
  | "cheese"
  | "dough"
  | "frontline"
  | "mix"
  | "pep"
  | "general";

export const INGREDIENT_CATEGORIES: IngredientCategory[] = [
  "cheese",
  "dough",
  "frontline",
  "mix",
  "pep",
  "general",
];

export interface Ingredient {
  id: string;
  scope?: string;
  name: string;
  categories: IngredientCategory[];
  // When set, this ingredient was merged into another (still-live) ingredient;
  // id -> name resolution should follow this pointer instead of using `name`.
  mergedInto?: string | null;
  enabled: boolean;
}

// A recipe row that references an ingredient by stable id. `ingredient` is kept
// as a plain-text fallback/cache of the last-known display name so legacy rows
// (saved before the catalog existed, or created offline before the catalog
// synced) keep working and nothing is ever silently lost.
export interface CatalogRecipeRow {
  ingredientId?: string;
  ingredient: string;
  lbs: number;
}

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

function normalizeCategories(input: unknown): IngredientCategory[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<IngredientCategory>();
  for (const raw of input) {
    if (typeof raw === "string" && (INGREDIENT_CATEGORIES as string[]).includes(raw)) {
      set.add(raw as IngredientCategory);
    }
  }
  return Array.from(set);
}

// Coerce a raw API/DB record into a clean Ingredient, or null if it has no
// usable name or id. Mirrors normalizeMix/normalizeCheeseRecipe.
export function normalizeIngredient(input: unknown): Ingredient | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name,
    categories: normalizeCategories(raw.categories),
    mergedInto:
      typeof raw.mergedInto === "string" && raw.mergedInto.trim()
        ? raw.mergedInto.trim()
        : null,
    enabled: raw.enabled === false ? false : true,
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type IngredientIndex = {
  byId: Map<string, Ingredient>;
  // Case-insensitive name -> ingredient, for matching legacy bare-name rows
  // (respects renames since it's rebuilt from the live catalog every time).
  byName: Map<string, Ingredient>;
};

export function buildIngredientIndex(items: Ingredient[]): IngredientIndex {
  const byId = new Map<string, Ingredient>();
  const byName = new Map<string, Ingredient>();
  for (const item of items) {
    byId.set(item.id, item);
    const key = item.name.trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, item);
  }
  return { byId, byName };
}

const MAX_MERGE_HOPS = 8;

// Follow `mergedInto` pointers (bounded, cycle-safe) to the live ingredient a
// given id currently resolves to. Returns null if the id is unknown.
export function resolveActiveIngredient(
  id: string,
  index: IngredientIndex,
): Ingredient | null {
  let current = index.byId.get(id) ?? null;
  const seen = new Set<string>();
  let hops = 0;
  while (current?.mergedInto && !seen.has(current.id) && hops < MAX_MERGE_HOPS) {
    seen.add(current.id);
    const next = index.byId.get(current.mergedInto);
    if (!next) break;
    current = next;
    hops++;
  }
  return current;
}

// Resolve a single row's current display name, preferring the catalog
// (following merges) and falling back to whatever name is already on the row
// (covers legacy rows with no ingredientId, and rows whose id is unknown to
// the currently-loaded catalog, e.g. offline).
export function resolveRowName(row: CatalogRecipeRow, index: IngredientIndex): string {
  if (row.ingredientId) {
    const active = resolveActiveIngredient(row.ingredientId, index);
    if (active) return active.name;
  }
  return row.ingredient;
}

// Rehydrate a full set of recipe rows against the current catalog: refreshes
// `ingredient` from the catalog for any row carrying an id (so renames/merges
// propagate with no client-side rewrite), and best-effort backfills a missing
// `ingredientId` by case-insensitive name match for legacy rows. Never drops a
// row and never blanks a name it can't resolve.
export function hydrateRecipeRows<R extends CatalogRecipeRow>(
  rows: R[],
  index: IngredientIndex,
): R[] {
  return rows.map((row) => {
    if (row.ingredientId) {
      const active = resolveActiveIngredient(row.ingredientId, index);
      if (active && active.name !== row.ingredient) {
        return { ...row, ingredient: active.name, ingredientId: active.id };
      }
      if (active && active.id !== row.ingredientId) {
        return { ...row, ingredientId: active.id };
      }
      return row;
    }
    const name = (row.ingredient ?? "").trim().toLowerCase();
    if (!name) return row;
    const match = index.byName.get(name);
    if (!match) return row;
    const active = resolveActiveIngredient(match.id, index) ?? match;
    return { ...row, ingredientId: active.id, ingredient: active.name };
  });
}

// Build the flat, category-scoped, enabled-only name list a picker needs
// (mirrors the shape of the old synced `cheeseIngredients`/`doughIngredients`/…
// lists), sorted alphabetically. Includes an ingredient in every category it
// was tagged with; "general" ingredients are ALSO returned for every other
// category so the old "one big pool" pickers keep seeing everything they used
// to (categories only narrow the picker down further when actually set).
export function pickerNamesForCategory(
  items: Ingredient[],
  category: IngredientCategory,
): string[] {
  const names = new Set<string>();
  for (const item of items) {
    if (!item.enabled || item.mergedInto) continue;
    if (item.categories.length === 0) continue;
    if (item.categories.includes(category) || item.categories.includes("general")) {
      names.add(item.name);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function coerceLbs(value: unknown): number {
  return Math.max(0, coerceNum(value, 0));
}

// ---------------------------------------------------------------------------
// Unified ingredient universe (Task: unified ingredient list everywhere)
// ---------------------------------------------------------------------------

// Everything that can contribute ingredient NAMES to the one factory-wide
// universe: the server catalog itself, recipe rows from every server pool
// (dough / sauce / cheese / mixes), and the legacy local master lists. The
// builder is strictly READ-ONLY — it unions and dedupes names for display in
// pickers/suggestions/merge, and never writes or normalizes stored data.
export interface IngredientUniverseSources {
  // Server ingredient catalog entries. Disabled or merged-away entries are
  // skipped (their live target is already in the catalog under its own name).
  catalog?: Ingredient[];
  // Recipe rows from any pool/editor — anything with an `ingredient` name.
  // Grouped as arrays-of-arrays so callers can pass each pool's component
  // lists straight through without flattening first.
  recipeRows?: ReadonlyArray<ReadonlyArray<{ ingredient: string }>>;
  // Plain name lists (legacy local master lists, pep types, …).
  nameLists?: ReadonlyArray<ReadonlyArray<string>>;
  // Names to exclude from EVERY source, matched case-insensitively
  // (trim + lowercase). Used for merged-away tombstones: right after an
  // ingredient merge the client's catalog copy / pool rows can briefly still
  // carry the old name, and this filter keeps it from resurfacing in the
  // universe until the refetch lands.
  excludeNames?: ReadonlyArray<string>;
}

// Union every source into one flat, case-insensitively deduped (first casing
// seen wins), alphabetically sorted name list.
export function buildIngredientUniverse(
  sources: IngredientUniverseSources,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const excluded = new Set<string>();
  for (const raw of sources.excludeNames ?? []) {
    const key = (raw ?? "").trim().toLowerCase();
    if (key) excluded.add(key);
  }
  const add = (raw: string) => {
    const name = (raw ?? "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (excluded.has(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const item of sources.catalog ?? []) {
    if (!item.enabled || item.mergedInto) continue;
    add(item.name);
  }
  for (const rows of sources.recipeRows ?? []) {
    for (const row of rows) add(row.ingredient);
  }
  for (const list of sources.nameLists ?? []) {
    for (const name of list) add(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
