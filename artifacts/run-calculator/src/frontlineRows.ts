import type { FormValues } from "./types";
import {
  computeFrontlineRunRequirement,
  type Calc,
} from "@workspace/live-calc";

export type FrontlineQuantitySource = {
  productionNeedsAvailable?: boolean;
  sauceLbs: number;
  sauceBatches: number;
  app1Lbs: number; app1Batches: number;
  app2Lbs: number; app2Batches: number;
  app3Lbs: number; app3Batches: number;
  app4Lbs: number; app4Batches: number;
  pep1Lbs: number; pep1Batches: number;
  pep2Lbs: number; pep2Batches: number;
  pep1LbsB: number; pep1BatchesB: number;
  pep2LbsB: number; pep2BatchesB: number;
};

export type FrontlineNeedRow = {
  key: string;
  station: "sauce" | "app1" | "app2" | "pep1" | "pep2" | "app3" | "app4";
  label: string;
  amount: number;
  unit: "batches" | "lbs";
  totalLbs: number;
  recipeName?: string;
  batchProgressField?: "app1BatchesMade" | "app2BatchesMade" | "app3BatchesMade" | "app4BatchesMade";
};

export type FrontlineIngredientNeed = {
  ingredient: string;
  amountLbs: number;
};

type LiveFrontlineCalcInput = Pick<
  Calc,
  | "casesLeftToRun"
  | "sauceBatches"
  | "pep1Lbs"
  | "pep1Batches"
  | "pep2Lbs"
  | "pep2Batches"
  | "pep1LbsB"
  | "pep1BatchesB"
  | "pep2LbsB"
  | "pep2BatchesB"
>;

/**
 * Collect the quantities used by the live Frontline panel. Applicator needs
 * are recalculated from the selected recipe (or configured batch weight),
 * while Sauce and Pep values come from the live calculator.
 */
export function deriveLiveFrontlineQuantitySource(
  v: FormValues,
  calc: LiveFrontlineCalcInput,
): FrontlineQuantitySource {
  const appRequirement = (slot: 1 | 2 | 3 | 4) => {
    const recipeLbs = (v[`app${slot}CheeseRecipe`] ?? []).reduce(
      (sum, row) => sum + (Number(row.lbs) || 0),
      0,
    );
    return computeFrontlineRunRequirement({
      casesNeeded: v.casesNeeded,
      pizzasPerCase: v.pizzasPerCase,
      ozPerPizza: v[`app${slot}OzPerPizza`],
      configuredEffectiveWeight: recipeLbs > 0
        ? recipeLbs
        : v[`app${slot}BatchLbs`],
    });
  };

  const app1 = appRequirement(1);
  const app2 = appRequirement(2);
  const app3 = appRequirement(3);
  const app4 = appRequirement(4);

  return {
    sauceLbs: Math.max(
      0,
      calc.casesLeftToRun * v.pizzasPerCase + v.casesPerLayer * v.pizzasPerCase,
    ) * v.sauceOzPerPizza / 16 + 30,
    sauceBatches: calc.sauceBatches,
    app1Lbs: app1.totalLbs,
    app1Batches: app1.totalUnits,
    app2Lbs: app2.totalLbs,
    app2Batches: app2.totalUnits,
    app3Lbs: app3.totalLbs,
    app3Batches: app3.totalUnits,
    app4Lbs: app4.totalLbs,
    app4Batches: app4.totalUnits,
    pep1Lbs: calc.pep1Lbs,
    pep1Batches: calc.pep1Batches,
    pep2Lbs: calc.pep2Lbs,
    pep2Batches: calc.pep2Batches,
    pep1LbsB: calc.pep1LbsB,
    pep1BatchesB: calc.pep1BatchesB,
    pep2LbsB: calc.pep2LbsB,
    pep2BatchesB: calc.pep2BatchesB,
  };
}

/**
 * One presentation model for every Frontline operator surface.
 * A configured item is always retained. Batches are used only when the
 * calculation has an effective batch weight; otherwise pounds are the honest
 * fallback.
 */
export function deriveFrontlineNeedRows(
  v: FormValues,
  q: FrontlineQuantitySource,
): FrontlineNeedRow[] {
  if (q.productionNeedsAvailable === false) return [];
  const rows: FrontlineNeedRow[] = [];
  if (v.sauceOzPerPizza > 0 && q.sauceLbs > 0) {
    rows.push({
      key: "sauce", station: "sauce", label: "Sauce",
      amount: q.sauceBatches > 0 ? q.sauceBatches : q.sauceLbs,
      unit: q.sauceBatches > 0 ? "batches" : "lbs",
      totalLbs: q.sauceLbs,
      recipeName: v.frontlineRecipeName?.trim() || undefined,
    });
  }

  const addApp = (slot: 1 | 2 | 3 | 4) => {
    const type = v[`app${slot}Type`].trim();
    const lbs = q[`app${slot}Lbs`];
    const batches = q[`app${slot}Batches`];
    if (!type || !(lbs > 0)) return;
    const useBatches = batches > 0;
    rows.push({
      key: `app${slot}`,
      station: `app${slot}` as FrontlineNeedRow["station"],
      label: `App ${slot} — ${type}`,
      amount: useBatches ? batches : lbs,
      unit: useBatches ? "batches" : "lbs",
      totalLbs: lbs,
      recipeName: v[`app${slot}CheeseRecipeName`]?.trim() || undefined,
      ...(useBatches ? { batchProgressField: `app${slot}BatchesMade` as FrontlineNeedRow["batchProgressField"] } : {}),
    });
  };

  const addPep = (
    station: "pep1" | "pep2",
    suffix: "" | "B",
    label: string,
  ) => {
    const type = v[`${station}Type${suffix}` as keyof FormValues];
    const typeText = typeof type === "string" ? type.trim() : "";
    const lbs = q[`${station}Lbs${suffix}` as keyof FrontlineQuantitySource] as number;
    const batches = q[`${station}Batches${suffix}` as keyof FrontlineQuantitySource] as number;
    if (!typeText) return;
    rows.push({
      key: `${station}${suffix.toLowerCase()}`,
      station,
      label: `${label} — ${typeText}`,
      amount: batches > 0 ? batches : lbs,
      unit: batches > 0 ? "batches" : "lbs",
      totalLbs: lbs,
    });
  };

  addApp(1);
  addApp(2);
  const pep1Label = v.pep1Combined === true ? "Pep 1 & 2" : "Pep 1";
  addPep("pep1", "", pep1Label);
  addPep("pep1", "B", pep1Label);
  if (v.pep1Combined !== true) {
    addPep("pep2", "", "Pep 2");
    addPep("pep2", "B", "Pep 2");
  }
  addApp(3);
  addApp(4);
  return rows;
}

/**
 * Derive display-only ingredient quantities from each applicator's existing
 * pound need and recipe proportions. This deliberately does not affect the
 * aggregate need or any shared Frontline calculations.
 */
export function deriveFrontlineIngredientNeeds(
  v: FormValues,
  needRows: FrontlineNeedRow[],
): Record<string, FrontlineIngredientNeed[]> {
  const ingredientsByRow: Record<string, FrontlineIngredientNeed[]> = {};

  for (const needRow of needRows) {
    if (!/^app[1-4]$/.test(needRow.key)) continue;

    const slot = Number(needRow.key.slice(3)) as 1 | 2 | 3 | 4;
    const recipe = v[`app${slot}CheeseRecipe`] ?? [];
    const components = recipe
      .map((component) => ({
        ingredient: component.ingredient.trim(),
        lbs: Number(component.lbs),
      }))
      .filter((component) => component.lbs > 0);

    const recipeLbs = components.reduce((total, component) => total + component.lbs, 0);
    if (
      components.length === 0
      || components.some((component) => !component.ingredient || !Number.isFinite(component.lbs))
      || !Number.isFinite(recipeLbs)
      || recipeLbs <= 0
      || !Number.isFinite(needRow.totalLbs)
      || needRow.totalLbs <= 0
    ) {
      continue;
    }

    ingredientsByRow[needRow.key] = components.map((component) => ({
      ingredient: component.ingredient,
      amountLbs: needRow.totalLbs * component.lbs / recipeLbs,
    }));
  }

  return ingredientsByRow;
}
