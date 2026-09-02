import {
  ingredientNameKey,
  unionIngredientCategories,
  type IngredientCategory,
} from "@workspace/ingredient-catalog";

export type IngredientDuplicateHealRow = {
  id: string;
  scope: string;
  name: string;
  categories: IngredientCategory[] | null;
  mergedInto: string | null;
  enabled: boolean;
  createdAt: Date;
};

export type IngredientDuplicateMergePlan = {
  scope: string;
  canonicalId: string;
  duplicateIds: string[];
  categories: IngredientCategory[];
};

export function planIngredientDuplicateMerges(
  rows: IngredientDuplicateHealRow[],
): IngredientDuplicateMergePlan[] {
  const groups = new Map<string, IngredientDuplicateHealRow[]>();

  for (const row of rows) {
    if (!row.enabled || row.mergedInto) continue;
    const nameKey = ingredientNameKey(row.name);
    if (!nameKey) continue;
    const key = `${row.scope}\u0000${nameKey}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const plans: IngredientDuplicateMergePlan[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      const createdAtDiff = a.createdAt.getTime() - b.createdAt.getTime();
      return createdAtDiff !== 0
        ? createdAtDiff
        : a.id.localeCompare(b.id);
    });
    const [canonical, ...duplicates] = sorted;
    plans.push({
      scope: canonical.scope,
      canonicalId: canonical.id,
      duplicateIds: duplicates.map((row) => row.id),
      categories: unionIngredientCategories(
        ...sorted.map((row) => row.categories),
      ),
    });
  }

  return plans.sort(
    (a, b) =>
      a.scope.localeCompare(b.scope) ||
      a.canonicalId.localeCompare(b.canonicalId),
  );
}
