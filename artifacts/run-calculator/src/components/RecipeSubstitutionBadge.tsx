import { Replace } from "lucide-react";
import type { IngredientSubstitution } from "@workspace/inventory-math";
import { describeSubstitution } from "./SubstitutionsManager";

type RecipeRow = { ingredient?: string };

// Shows which active day-state substitutions touch the recipes/types on the
// currently-viewed run, so floor staff know the printed recipe is overlaid for
// today. Read-only badge — managing substitutions lives in the Inventory tab.
export default function RecipeSubstitutionBadge({
  substitutions,
  recipes,
  typeValues,
}: {
  substitutions: IngredientSubstitution[];
  recipes: (RecipeRow[] | undefined)[];
  typeValues: (string | undefined)[];
}) {
  if (substitutions.length === 0) return null;
  const present = new Set<string>();
  for (const rows of recipes) for (const r of rows ?? []) if (r?.ingredient) present.add(r.ingredient.toLowerCase());
  for (const t of typeValues) if (t) present.add(t.toLowerCase());

  const relevant = substitutions.filter((s) => present.has(s.ingredient.toLowerCase()));
  if (relevant.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 mb-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
        <Replace className="w-3.5 h-3.5" /> Today's substitutions
      </div>
      <div className="flex flex-wrap gap-1.5">
        {relevant.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
          >
            {describeSubstitution(s)}
          </span>
        ))}
      </div>
    </div>
  );
}
