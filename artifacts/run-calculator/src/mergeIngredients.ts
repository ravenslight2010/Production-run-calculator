// Pure, framework-free helpers for merging "similar" ingredient names into a
// single canonical name. The user picks one or more source names and a target;
// every reference to a source is rewritten to the target across master-data
// lists, recipe rows, applicator/pep type fields, profiles, runs, templates and
// history. This module owns ONLY the value rewriting — persistence (localStorage
// on web, AsyncStorage state on mobile) and inventory folding live in the
// callers. Kept mirrored with the mobile copy at
// `run-calculator-mobile/context/mergeIngredients.ts` for web+mobile parity.

export type MergeMap = Record<string, string>;

// String fields on a settings/values object that hold a single ingredient name.
export const MERGE_NAME_FIELDS = [
  "app1Type",
  "app2Type",
  "app3Type",
  "app4Type",
  "pep1Type",
  "pep2Type",
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

/**
 * Case-insensitive (trim + lowercase) source→target lookup for a merge map.
 * Imported data commonly drifts in case/whitespace from the master lists, and
 * the server-side repoint/fold helpers already match case-insensitively — the
 * local rewrite and the preview count must match the same occurrences or the
 * preview undercounts ("0 references") and the apply leaves stragglers behind.
 */
export function buildCiMergeLookup(map: MergeMap): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [s, t] of Object.entries(map)) {
    const k = s.trim().toLowerCase();
    if (k) lookup.set(k, t);
  }
  return lookup;
}

/** Case-insensitive rename of one name via a prebuilt lookup. */
export function mapNameCi(name: unknown, lookup: Map<string, string>): string | undefined {
  return typeof name === "string" ? lookup.get(name.trim().toLowerCase()) : undefined;
}

/** Apply a rename to a single name (case-insensitive on the source). */
export function mapName(name: string, map: MergeMap): string {
  return mapNameCi(name, buildCiMergeLookup(map)) ?? name;
}

/**
 * Rewrite a flat string list, dropping case-insensitive duplicates that the
 * rename produces while preserving first-seen order.
 */
export function mergeList(list: string[], map: MergeMap): string[] {
  const lookup = buildCiMergeLookup(map);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const renamed = mapNameCi(item, lookup) ?? item;
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
  const lookup = buildCiMergeLookup(map);
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const renamed = mapNameCi(row.ingredient, lookup);
    return renamed !== undefined && renamed !== row.ingredient
      ? { ...row, ingredient: renamed }
      : row;
  });
}

/**
 * Rewrite the single-name fields and recipe-row fields on a settings/values
 * object (FormValues on web, RunSettings on mobile). Returns a new object.
 */
export function mergeSettingsObject<T extends Record<string, unknown>>(
  obj: T,
  map: MergeMap,
): T {
  const lookup = buildCiMergeLookup(map);
  const out = { ...obj } as Record<string, unknown>;
  for (const k of MERGE_NAME_FIELDS) {
    const renamed = mapNameCi(out[k], lookup);
    if (renamed !== undefined) out[k] = renamed;
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
 * renamed, type-field hits, and recipe-row hits. All matching is
 * case-insensitive (trim + lowercase) — the same occurrences the apply path and
 * the server re-point helpers rewrite — so the preview can't undercount and
 * show a misleading "0 references" for names that drifted in case/whitespace.
 *
 * `ciRowLists` holds recipe rows from the SERVER master-data pools (cheese
 * recipes, mixes, dough/sauce recipes), which the merge re-points server-side.
 */
export function countMergeReferences(
  map: MergeMap,
  surfaces: {
    lists?: string[][];
    settingsObjects?: Record<string, unknown>[];
    presetMaps?: Record<string, { ingredient?: unknown }[]>[];
    ciRowLists?: { ingredient?: unknown }[][];
  },
): number {
  const lookup = buildCiMergeLookup(map);
  let count = 0;
  const hit = (name: unknown) => mapNameCi(name, lookup) !== undefined;
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
  for (const rows of surfaces.ciRowLists ?? []) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) if (row && hit(row.ingredient)) count++;
  }
  return count;
}
