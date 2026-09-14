// Server-side mix plan snapshot — the "server is boss when online" mirror of
// the web Mixes tab's make-day plan.
//
// Pure: every input is passed in (no DB reads here). The route in
// routes/mixPlanSnapshot.ts loads daily-sync rows, brand profiles, and the
// server mix pool, then calls computeMixPlanSnapshot. The web tab prefers this
// response when online and falls back to its own buildMixPlan call when
// offline, so every device sees identical batch/lbs figures and the CPU cost of
// building the plan is paid once on the server instead of on every device.
//
// Math parity: this feeds the SAME @workspace/mixes buildMixPlan function the
// web + mobile apps use — nothing is re-implemented. Run resolution mirrors the
// web's valsToMixRun helper (computeSummaryStats + computeCheesePerPizzaOz).

import {
  computeSummaryStats,
  computeCheesePerPizzaOz,
  type SummaryStatsInput,
  type RecipeRow,
} from "@workspace/inventory-math";
import { buildMixPlan, type Mix, type MixPlanGroup } from "@workspace/mixes";

/** Run row shape the route feeds us (values resolved from profile/runValues). */
export type MixPlanRunInput = {
  date: string;
  brand: string;
  flavor: string;
  /** Resolved per-run values (profile merge or live runValues). */
  values: Record<string, unknown>;
};

/**
 * Build the same MixScheduledRun[] the web tab builds from FormValues:
 * totalPizzasForSauce (with the casesPerLayer startup buffer) + totalCases, and
 * the per-ingredient oz/pizza map across the four applicator slots. Recipe rows
 * expand via computeCheesePerPizzaOz; slots without rows keep the raw type name.
 */
/** Normalize DB-shaped recipe rows (optional ingredient/lbs) to RecipeRow[]. */
function toRecipeRows(rows: unknown): RecipeRow[] | undefined {
  if (!Array.isArray(rows)) return undefined;
  return rows.map((r) => ({
    ingredient: String((r as { ingredient?: unknown })?.ingredient ?? ""),
    lbs: Number((r as { lbs?: unknown })?.lbs) || 0,
  }));
}

export function toMixScheduledRun(input: MixPlanRunInput): {
  date: string;
  brand: string;
  flavor: string;
  pizzas: number;
  cases: number;
  ingredients: string[];
  ingredientOzPerPizza: Record<string, number>;
} {
  const vals = input.values;
  // DB rows may legitimately lack optional recipe fields; the lib guards reads.
  const s = computeSummaryStats(
    vals as unknown as SummaryStatsInput,
    [],
  );
  const ingredientOzPerPizza: Record<string, number> = {};
  const addSlot = (recipe: unknown, type: string, oz: number) => {
    const rows = toRecipeRows(recipe);
    if ((rows?.length ?? 0) > 0 && oz > 0) {
      const { rows: ozRows } = computeCheesePerPizzaOz(rows, oz);
      rows?.forEach((row, i) => {
        const name = (row.ingredient ?? "").trim();
        if (!name) return;
        ingredientOzPerPizza[name] = (ingredientOzPerPizza[name] ?? 0) + (ozRows[i] ?? 0);
      });
    } else if (type && oz > 0) {
      ingredientOzPerPizza[type] = (ingredientOzPerPizza[type] ?? 0) + oz;
    }
  };
  addSlot(vals.app1CheeseRecipe, String(vals.app1Type ?? ""), Number(vals.app1OzPerPizza) || 0);
  addSlot(vals.app2CheeseRecipe, String(vals.app2Type ?? ""), Number(vals.app2OzPerPizza) || 0);
  addSlot(vals.app3CheeseRecipe, String(vals.app3Type ?? ""), Number(vals.app3OzPerPizza) || 0);
  addSlot(vals.app4CheeseRecipe, String(vals.app4Type ?? ""), Number(vals.app4OzPerPizza) || 0);
  return {
    date: input.date,
    brand: input.brand,
    flavor: input.flavor,
    pizzas: s.totalPizzasForSauce,
    cases: s.totalCases,
    ingredients: Object.keys(ingredientOzPerPizza),
    ingredientOzPerPizza,
  };
}

export function computeMixPlanSnapshot(input: {
  /** Today's live runs (dayState) resolved to values. */
  liveRuns: MixPlanRunInput[];
  /** Future scheduled runs (profile-resolved). */
  scheduledRuns: MixPlanRunInput[];
  /** Server mix pool (canonical Mix[]). */
  mixes: Mix[];
  /** Chosen make-day (YYYY-MM-DD); buildMixPlan's `today`. */
  makeDay: string;
}): MixPlanGroup[] {
  const runs = [...input.liveRuns, ...input.scheduledRuns].map(toMixScheduledRun);
  return buildMixPlan({
    runs,
    mixes: input.mixes,
    today: input.makeDay,
  });
}
