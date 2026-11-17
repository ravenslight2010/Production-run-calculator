import { AlertTriangle } from "lucide-react";
import type { MixPlanEntry } from "@workspace/mixes";

/**
 * Amber warning block shown inside a prep-mix plan card when
 * `missingAmounts` is true — i.e. at least one component ingredient
 * name has no matching oz/pizza entry in any contributing run's profile.
 *
 * Extracted from the inline mixes-plan JSX in home.tsx so it can be
 * rendered in isolation for test coverage.
 */
export function PrepMixMissingAmountsWarning({ entry }: { entry: Pick<MixPlanEntry, "missingAmounts" | "missingComponentIngredients" | "components"> }) {
  if (!entry.missingAmounts) return null;

  const allMissing =
    entry.missingComponentIngredients != null &&
    entry.missingComponentIngredients.length === entry.components.length;

  return (
    <div
      data-testid="prep-mix-missing-amounts-warning"
      className="flex flex-col gap-0.5 rounded bg-amber-900/30 border border-amber-700/40 px-2 py-1.5 text-xs text-amber-300"
    >
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="font-semibold">
          {allMissing
            ? "No component amounts — pull quantities will be 0"
            : "Some components have no amounts — pull quantities may be understated"}
        </span>
      </div>
      {entry.missingComponentIngredients && entry.missingComponentIngredients.length > 0 && (
        <span data-testid="prep-mix-missing-ingredients-list" className="pl-5 text-amber-400/80">
          {entry.missingComponentIngredients.join(", ")} — check that these names exactly match
          ingredient names in the run profiles, or open Mix Recipes to enter oz/pizza amounts
          directly.
        </span>
      )}
    </div>
  );
}
