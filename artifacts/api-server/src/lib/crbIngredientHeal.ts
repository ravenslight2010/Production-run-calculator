export const CRB_INGREDIENT_HEAL_ROWS = [
  { ingredient: "ADM WHEAT FLOUR", lbs: 200 },
  { ingredient: "WATER", lbs: 97.4 },
  { ingredient: "SUNFLOWER OIL", lbs: 16 },
  { ingredient: "FRESH COMPRESSED YEAST", lbs: 3 },
  { ingredient: "HONEY", lbs: 2 },
  { ingredient: "SALT", lbs: 1 },
  { ingredient: "GARLIC POWDER", lbs: 0.5 },
] as const;

export type CrbIngredientHealRecipe = {
  name: string;
  components: unknown;
  doughballVariants: unknown;
};

/**
 * The CRB repair is intentionally strict. It only recognizes the known
 * affected family row: the landed recipe name, an empty formula, and the
 * complete twelve-variant chart. A populated formula or a partial/different
 * variant set is manager data and is never touched.
 */
export function isAffectedCrbIngredientRow(recipe: CrbIngredientHealRecipe): boolean {
  if (recipe.name.trim().toLowerCase() !== "crb recipe") return false;
  if (!Array.isArray(recipe.components) || recipe.components.length !== 0) return false;
  const variants = recipe.doughballVariants;
  if (!Array.isArray(variants)) return false;
  return variants.length === 12;
}