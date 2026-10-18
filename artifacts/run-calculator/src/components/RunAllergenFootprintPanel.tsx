import { deriveRunAllergenFootprint } from "@workspace/ingredient-catalog";
import type { IngredientSubstitution } from "@workspace/inventory-math";
import type { FormValues } from "../types";
import { useMasterDataSlice } from "../masterData";
import { collectRunAllergenComponents } from "../runAllergenFootprint";

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function RunAllergenFootprintPanel({
  values,
  substitutions = [],
}: {
  values: FormValues;
  substitutions?: readonly IngredientSubstitution[];
}) {
  const query = useMasterDataSlice("ingredients");

  return (
    <section
      aria-labelledby="run-allergen-footprint-title"
      data-testid="run-allergen-footprint"
      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
    >
      <h3 id="run-allergen-footprint-title" className="text-sm font-semibold">
        Derived ingredient allergen footprint
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Based on this run’s effective recipe ingredients, active day substitutions, and selected pepperoni
        types. This is a visibility aid, not a verified food-label declaration or cleaning clearance.
      </p>

      {query.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Loading ingredient mappings…
        </p>
      ) : query.isError || !query.data ? (
        <div className="mt-3 space-y-2" role="alert">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Coverage is unknown because ingredient mappings could not be loaded. No allergen-free result is shown.
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            Retry loading
          </button>
        </div>
      ) : (
        (() => {
          const footprint = deriveRunAllergenFootprint(
            collectRunAllergenComponents(values, substitutions),
            query.data,
          );

          if (!footprint.hasRecipeData) {
            return (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  No recipe ingredient data is available for this run, so the footprint cannot be computed.
                </p>
                {footprint.missingComponents.length > 0 && (
                  <p className="text-sm">
                    No ingredient rows for configured components: {footprint.missingComponents.join(", ")}.
                  </p>
                )}
              </div>
            );
          }

          return (
            <div className="mt-3 space-y-3">
              <p
                className={`text-sm font-semibold ${
                  footprint.isComplete
                    ? "text-foreground"
                    : "text-amber-800 dark:text-amber-200"
                }`}
                data-testid="run-allergen-coverage-status"
              >
                {footprint.isComplete
                  ? "Coverage complete for the configured ingredient mappings."
                  : "Coverage incomplete — unknown ingredients or recipe rows remain."}
              </p>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Mapped allergens
                </h4>
                {footprint.allergens.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {footprint.allergens.map(({ allergen, ingredientNames }) => (
                      <li
                        key={allergen}
                        className="text-sm"
                        data-testid={`run-allergen-${allergen}`}
                      >
                        <span className="font-semibold">{titleCase(allergen)}:</span>{" "}
                        {ingredientNames.join(", ")}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm">
                    No tracked allergens are mapped among the reviewed ingredients shown.
                  </p>
                )}
              </div>

              {footprint.unknownIngredients.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                    Ingredient mappings that need review
                  </h4>
                  <ul className="mt-1 space-y-1">
                    {footprint.unknownIngredients.map((ingredient) => (
                      <li
                        key={ingredient.key}
                        className="text-sm"
                        data-testid="run-allergen-unknown-ingredient"
                      >
                        <span className="font-medium">{ingredient.name}</span>
                        {" — "}
                        {ingredient.reason === "missing-catalog"
                          ? "not found in the ingredient catalog"
                          : "mapping not reviewed"}
                        {" · "}
                        {ingredient.components.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {footprint.missingComponents.length > 0 && (
                <p className="text-sm">
                  No ingredient rows for configured components: {footprint.missingComponents.join(", ")}.
                </p>
              )}
            </div>
          );
        })()
      )}
    </section>
  );
}
