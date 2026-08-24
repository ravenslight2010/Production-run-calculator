import type { IngredientCategory } from "@workspace/ingredient-catalog";

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