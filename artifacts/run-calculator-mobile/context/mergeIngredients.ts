// Pure, framework-free helpers for merging "similar" ingredient names into a
// single canonical name. The user picks one or more source names and a target;
// every reference to a source is rewritten to the target across master-data
// lists, recipe rows, applicator/pep type fields, profiles, runs, templates and
// history. This module owns ONLY the value rewriting — persistence and inventory
// folding live in the callers. Kept mirrored with the web copy at
// `run-calculator/src/mergeIngredients.ts` for web+mobile parity.

export type MergeMap = Record<string, string>;

// String fields on a settings object that hold a single ingredient name.
export const MERGE_NAME_FIELDS = [
  "app1Type",
  "app2Type",
  "app3Type",
  "app4Type",
  "pep1Type",
  "pep2Type",
  "dieType",
] as const;

// Array fields holding recipe rows whose `ingredient` is a name.
export const MERGE_RECIPE_FIELDS = [
  "doughRecipe",
  "app1CheeseRecipe",
  "app2CheeseRecipe",
  "app3CheeseRecipe",
  "app4CheeseRecipe",
  "frontlineRecipe",
] as const;

/**
 * Build a source→target rename map. Blank sources, a blank target, and any
 * source equal to the target are dropped (no-ops). Returns {} when nothing
 * meaningful remains so callers can reject the merge.
 */
export function buildMergeMap(sources: string[], target: string): MergeMap {
  const t = target.trim();
  const map: MergeMap = {};
  if (!t) return map;
  for (const raw of sources) {
    const s = (raw ?? "").trim();
    if (s && s !== t) map[s] = t;
  }
  return map;
}

/** Apply a rename to a single name. */
export function mapName(name: string, map: MergeMap): string {
  return map[name] ?? name;
}

/**
 * Rewrite a flat string list, dropping case-insensitive duplicates that the
 * rename produces while preserving first-seen order.
 */
export function mergeList(list: string[], map: MergeMap): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const renamed = map[item] ?? item;
    const key = renamed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(renamed);
    }
  }
  return out;
}

/**
 * Rewrite the `ingredient` of each recipe row. Rows are NOT combined — a recipe
 * that referenced two now-merged names keeps both rows so its total weight is
 * preserved exactly (mirrors the existing rename-on-read behavior).
 */
export function mergeRecipeRows<R extends { ingredient?: unknown }>(
  rows: R[],
  map: MergeMap,
): R[] {
  return rows.map((row) =>
    row && typeof row === "object" && typeof row.ingredient === "string" && map[row.ingredient]
      ? { ...row, ingredient: map[row.ingredient] }
      : row,
  );
}

/**
 * Rewrite the single-name fields and recipe-row fields on a settings object.
 * Returns a new object.
 */
export function mergeSettingsObject<T extends Record<string, unknown>>(
  obj: T,
  map: MergeMap,
): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of MERGE_NAME_FIELDS) {
    const v = out[k];
    if (typeof v === "string" && map[v]) out[k] = map[v];
  }
  for (const k of MERGE_RECIPE_FIELDS) {
    const arr = out[k];
    if (Array.isArray(arr)) out[k] = mergeRecipeRows(arr as { ingredient?: unknown }[], map);
  }
  return out as T;
}

/** Rewrite every preset's recipe rows in a name→rows map. */
export function mergeRecipePresetMap<R extends { ingredient?: unknown }>(
  presets: Record<string, R[]>,
  map: MergeMap,
): Record<string, R[]> {
  const out: Record<string, R[]> = {};
  for (const [name, rows] of Object.entries(presets)) {
    out[name] = Array.isArray(rows) ? mergeRecipeRows(rows, map) : rows;
  }
  return out;
}

/**
 * Count how many references a merge map would rewrite across the supplied
 * surfaces. Used to drive the confirmation preview. Counts list entries that get
 * renamed, type-field hits, and recipe-row hits.
 */
export function countMergeReferences(
  map: MergeMap,
  surfaces: {
    lists?: string[][];
    settingsObjects?: Record<string, unknown>[];
    presetMaps?: Record<string, { ingredient?: unknown }[]>[];
  },
): number {
  let count = 0;
  const hit = (name: unknown) => typeof name === "string" && Boolean(map[name]);
  for (const list of surfaces.lists ?? []) {
    for (const item of list) if (hit(item)) count++;
  }
  for (const obj of surfaces.settingsObjects ?? []) {
    for (const k of MERGE_NAME_FIELDS) if (hit(obj[k])) count++;
    for (const k of MERGE_RECIPE_FIELDS) {
      const arr = obj[k];
      if (Array.isArray(arr)) for (const row of arr) if (row && hit((row as { ingredient?: unknown }).ingredient)) count++;
    }
  }
  for (const presets of surfaces.presetMaps ?? []) {
    for (const rows of Object.values(presets)) {
      if (Array.isArray(rows)) for (const row of rows) if (hit(row.ingredient)) count++;
    }
  }
  return count;
}
