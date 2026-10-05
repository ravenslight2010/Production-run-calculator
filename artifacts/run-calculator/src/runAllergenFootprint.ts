import { applySubstitutions, type IngredientSubstitution } from "@workspace/inventory-math";
import type { AllergenRecipeComponent } from "@workspace/ingredient-catalog";
import type { FormValues } from "./types";

function refs(
  rows: readonly { ingredient: string; ingredientId?: string }[],
): AllergenRecipeComponent["ingredients"] {
  return rows.map(({ ingredient, ingredientId }) => ({ ingredient, ingredientId }));
}

/**
 * Select only saved recipe ingredients and selected pepperoni types for the
 * derived footprint, after applying the same temporary day substitutions used
 * by production calculations. The manually entered `allergen` field is
 * intentionally not an input to this calculation.
 */
export function collectRunAllergenComponents(
  values: FormValues,
  substitutions: readonly IngredientSubstitution[] = [],
): AllergenRecipeComponent[] {
  const effectiveValues = applySubstitutions(values, substitutions);
  const components: AllergenRecipeComponent[] = [];

  if (effectiveValues.doughRecipeName.trim() || effectiveValues.doughRecipe.length > 0) {
    components.push({
      label: "Dough",
      configured: true,
      ingredients: refs(effectiveValues.doughRecipe),
    });
  }
  if (effectiveValues.frontlineRecipeName.trim() || effectiveValues.frontlineRecipe.length > 0) {
    components.push({
      label: "Frontline (Sauce)",
      configured: true,
      ingredients: refs(effectiveValues.frontlineRecipe),
    });
  }

  const applicators = [
    {
      label: "Applicator 1",
      type: effectiveValues.app1Type,
      recipeName: effectiveValues.app1CheeseRecipeName,
      rows: effectiveValues.app1CheeseRecipe,
    },
    {
      label: "Applicator 2",
      type: effectiveValues.app2Type,
      recipeName: effectiveValues.app2CheeseRecipeName,
      rows: effectiveValues.app2CheeseRecipe,
    },
    {
      label: "Applicator 3",
      type: effectiveValues.app3Type,
      recipeName: effectiveValues.app3CheeseRecipeName,
      rows: effectiveValues.app3CheeseRecipe,
    },
    {
      label: "Applicator 4",
      type: effectiveValues.app4Type,
      recipeName: effectiveValues.app4CheeseRecipeName,
      rows: effectiveValues.app4CheeseRecipe,
    },
  ];
  for (const applicator of applicators) {
    const recipeType = ["cheese", "mix"].includes(applicator.type.trim().toLowerCase());
    if (!applicator.recipeName.trim() && applicator.rows.length === 0 && !recipeType) {
      continue;
    }
    components.push({
      label: applicator.label,
      configured: true,
      ingredients: refs(applicator.rows),
    });
  }

  const pepperoniTypes = [
    ["Pepperoni 1", effectiveValues.pep1Type],
    ["Pepperoni 2", effectiveValues.pep2Type],
    ["Pepperoni 1 additional type", effectiveValues.pep1TypeB],
    ["Pepperoni 2 additional type", effectiveValues.pep2TypeB],
  ] as const;
  for (const [label, rawName] of pepperoniTypes) {
    const name = rawName.trim();
    if (!name) continue;
    components.push({
      label,
      configured: true,
      ingredients: [{ ingredient: name }],
    });
  }

  return components;
}
