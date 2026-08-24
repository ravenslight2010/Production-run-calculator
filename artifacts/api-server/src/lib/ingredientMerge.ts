import type { IngredientCategory } from "@workspace/ingredient-catalog";

export type MergeableIngredient = {
  id: string;
  mergedInto: string | null;
};

/**
 * Preserve every confirmed recipe surface when catalog entries are merged.
 * The kept ingredient is the public identity; categories from its soft-disabled
 * predecessors must therefore remain available on that kept entry.
 */
export function unionIngredientCategories(
  ...categoryLists: Array<readonly IngredientCategory[] | null | undefined>
): IngredientCategory[] {
  const categories = new Set<IngredientCategory>();
  for (const list of categoryLists) {
    for (const category of list ?? []) categories.add(category);
  }
  return [...categories];
}

/**
 * Resolve a catalog entry to the final identity in its merge chain.
 * The cycle guard keeps malformed legacy data from making a merge hang.
 */
export function resolveIngredientMergeTarget(
  rows: readonly MergeableIngredient[],
  id: string,
): string {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  let currentId = id;

  while (!seen.has(currentId)) {
    seen.add(currentId);
    const nextId = byId.get(currentId)?.mergedInto;
    if (!nextId || !byId.has(nextId)) return currentId;
    currentId = nextId;
  }

  return currentId;
}

/**
 * Return the ids in an entry's merge path, including the entry itself.
 * This lets a later merge flatten every predecessor, not just direct children.
 */
export function ingredientMergePath(
  rows: readonly MergeableIngredient[],
  id: string,
): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: string[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = id;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    path.push(currentId);
    currentId = byId.get(currentId)?.mergedInto ?? undefined;
  }

  return path;
}