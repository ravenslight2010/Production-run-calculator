import type { RunAllergenFootprint } from "@workspace/ingredient-catalog";

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function RunAllergenFootprintPanel({
  runId,
  footprint,
  isLoading,
  isError,
  onRetry,
}: {
  runId: string;
  footprint: RunAllergenFootprint | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="run-allergen-footprint-title"
      data-testid="qc-run-allergen-footprint"
      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="run-allergen-footprint-title" className="text-sm font-semibold">
          Derived ingredient allergen footprint
        </h3>
        <span className="max-w-full break-all rounded border border-border/70 bg-background/70 px-2 py-1 font-mono text-xs" data-testid="qc-allergen-run-id">
          Run {runId || "not selected"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Based on this run’s effective recipe ingredients, active day substitutions, and selected pepperoni
        types. This is a visibility aid, not a verified food-label declaration or cleaning clearance.
      </p>

      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Loading ingredient mappings…
        </p>
      ) : isError || !footprint ? (
        <div className="mt-3 space-y-2" role="alert">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Coverage is unknown because ingredient mappings could not be loaded. No allergen-free result is shown.
          </p>
          <button
            type="button"
            onClick={onRetry}
            data-testid="button-retry-run-allergen-footprint"
            className="min-h-10 rounded border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            Retry loading
          </button>
        </div>
      ) : !footprint.hasRecipeData ? (
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
      ) : (
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
                    className="break-words text-sm [overflow-wrap:anywhere]"
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
                    className="break-words text-sm [overflow-wrap:anywhere]"
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
      )}
    </section>
  );
}
