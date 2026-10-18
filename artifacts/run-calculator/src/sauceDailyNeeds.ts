import { computeSauceRunRequirement } from "@workspace/live-calc";
import type { FormValues, RecipeRow, RunMeta } from "./types";

export type SauceDailyNeed = {
  key: string;
  recipeName: string;
  plannedBarrels: number;
  runCount: number;
};

type SaucePlanValues = Pick<
  FormValues,
  "casesNeeded" | "pizzasPerCase" | "sauceOzPerPizza" | "sauceBarrelLbs" | "frontlineRecipe" | "frontlineRecipeName"
>;

function normalizedRecipeRows(rows: RecipeRow[] | undefined): Array<{ ingredient: string; lbs: number }> {
  const totals = new Map<string, number>();
  for (const row of rows ?? []) {
    const ingredient = String(row.ingredientId || row.ingredient || "").trim().toLocaleLowerCase();
    const lbs = Number(row.lbs);
    if (!ingredient || !Number.isFinite(lbs) || lbs <= 0) continue;
    totals.set(ingredient, (totals.get(ingredient) ?? 0) + lbs);
  }
  return [...totals.entries()]
    .map(([ingredient, lbs]) => ({ ingredient, lbs: Math.round(lbs * 10000) / 10000 }))
    .sort((a, b) => a.ingredient.localeCompare(b.ingredient));
}

/** Aggregate saved planned needs, never remaining demand or online stock. */
export function buildSauceDailyNeeds(
  runs: RunMeta[],
  valuesByRunId: Record<string, SaucePlanValues>,
): SauceDailyNeed[] {
  const groups = new Map<string, SauceDailyNeed>();
  for (const run of runs) {
    const values = valuesByRunId[run.id];
    if (!values) continue;
    const rows = normalizedRecipeRows(values.frontlineRecipe);
    const effectiveBarrelLbs = rows.reduce((sum, row) => sum + row.lbs, 0)
      || Math.max(0, Number(values.sauceBarrelLbs) || 0);
    const requirement = computeSauceRunRequirement({
      casesNeeded: values.casesNeeded,
      pizzasPerCase: values.pizzasPerCase,
      ozPerPizza: values.sauceOzPerPizza,
      barrelLbs: effectiveBarrelLbs,
    });
    if (!(requirement.totalUnits > 0)) continue;
    const recipeName = String(values.frontlineRecipeName ?? "").trim() || "Sauce";
    const key = JSON.stringify([rows, rows.length ? null : effectiveBarrelLbs, recipeName.toLocaleLowerCase()]);
    const existing = groups.get(key);
    if (existing) {
      existing.plannedBarrels += requirement.totalUnits;
      existing.runCount += 1;
    } else {
      groups.set(key, { key, recipeName, plannedBarrels: requirement.totalUnits, runCount: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => a.recipeName.localeCompare(b.recipeName));
}
