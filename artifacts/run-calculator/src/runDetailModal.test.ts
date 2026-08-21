import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeCheesePull } from "@workspace/inventory-math";
import { DEFAULT_VALUES, type FormValues } from "./types";
import {
  setActiveSubstitutions,
  withSubstitutions,
  withTodaySubstitutions,
} from "./substitutionState";

afterEach(() => setActiveSubstitutions([]));

// Focused tests for the ingredient-breakdown calculations used by the
// Ingredient Detail modal (run detail card → "Ingredient Detail" button).
//
// Cheese rows: per-ingredient lbs = computeCheesePull(recipe, batches).rows
//   — applies Math.max(1, batches) so fractional runs still show a full batch.
// Mix rows:   per-ingredient lbs = (componentOzPerPizza / sumOzPerPizza) * totalMixLbs
//   — mirrors MixRecipeCard.rowTotal proportional allocation.

// ── Helpers mirroring the modal's inline logic ────────────────────────────────

function cheeseIngredientRows(
  recipe: { ingredient: string; lbs: number }[],
  batches: number,
): { ingredient: string; lbs: number }[] {
  const pull = computeCheesePull(recipe as any, batches);
  return pull.rows.filter((r) => (r.ingredient ?? "").trim() && r.lbs > 0);
}

function mixIngredientRows(
  recipe: { ingredient: string; lbs: number }[],
  totalMixLbs: number,
): { ingredient: string; lbs: number }[] {
  const rows = recipe.filter(
    (r) => (r.ingredient ?? "").trim() && Number(r.lbs ?? 0) > 0,
  );
  const sumOz = rows.reduce((acc, r) => acc + Number(r.lbs), 0);
  return rows
    .map((r) => ({
      ingredient: r.ingredient.trim(),
      lbs: sumOz > 0 ? (Number(r.lbs) / sumOz) * totalMixLbs : 0,
    }))
    .filter((r) => r.lbs > 0);
}

function doughIngredientRows(
  vals: Pick<FormValues, "doughRecipe" | "targetDoughballWeight" | "doughBatchYield" | "casesNeeded" | "pizzasPerCase">,
): { ingredient: string; lbs: number }[] {
  const totalPizzas = vals.casesNeeded * vals.pizzasPerCase;
  const recipeLbs = (vals.doughRecipe ?? []).reduce((sum, row) => sum + Number(row.lbs ?? 0), 0);
  const effectiveYield = recipeLbs > 0 && vals.targetDoughballWeight > 0
    ? (recipeLbs * 16) / vals.targetDoughballWeight
    : vals.doughBatchYield;
  const batches = effectiveYield > 0 && vals.targetDoughballWeight > 0
    ? Math.ceil(totalPizzas / effectiveYield)
    : 0;

  return (vals.doughRecipe ?? [])
    .filter((row) => row.ingredient.trim() && Number(row.lbs) > 0 && batches > 0)
    .map((row) => ({ ingredient: row.ingredient, lbs: Number(row.lbs) * batches }));
}

// ── Cheese: batch scaling ─────────────────────────────────────────────────────

describe("runDetailModal — cheese ingredient rows", () => {
  const recipe = [
    { ingredient: "Mozzarella", lbs: 30 },
    { ingredient: "Provolone", lbs: 10 },
  ];

  it("scales each ingredient by batches for whole batch counts", () => {
    const rows = cheeseIngredientRows(recipe, 3);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ingredient: "Mozzarella", lbs: 90 });
    expect(rows[1]).toEqual({ ingredient: "Provolone", lbs: 30 });
  });

  it("applies Math.max(1, batches) floor for fractional batches", () => {
    // 0.4 batches → treated as 1 full batch, never under-states ingredients.
    const rows = cheeseIngredientRows(recipe, 0.4);
    expect(rows[0].lbs).toBe(30); // 30 × Math.max(1, 0.4) = 30 × 1 = 30
    expect(rows[1].lbs).toBe(10);
  });

  it("applies Math.max(1, batches) floor for zero batches", () => {
    const rows = cheeseIngredientRows(recipe, 0);
    expect(rows[0].lbs).toBe(30);
    expect(rows[1].lbs).toBe(10);
  });

  it("returns empty rows for an empty recipe", () => {
    expect(cheeseIngredientRows([], 5)).toHaveLength(0);
  });

  it("filters out blank-ingredient rows", () => {
    const rows = cheeseIngredientRows(
      [{ ingredient: "  ", lbs: 20 }, { ingredient: "Cheddar", lbs: 5 }],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ingredient).toBe("Cheddar");
  });
});

// ── Mix: proportional lbs allocation ─────────────────────────────────────────

describe("runDetailModal — mix ingredient rows", () => {
  it("splits totalMixLbs proportionally by oz/pizza component weights", () => {
    // Recipe stores oz/pizza per component in the 'lbs' field.
    // 3 oz/pizza + 1 oz/pizza = 4 total → 75% / 25%
    const recipe = [
      { ingredient: "Italian Blend", lbs: 3 },
      { ingredient: "Romano", lbs: 1 },
    ];
    const rows = mixIngredientRows(recipe, 200);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ingredient: "Italian Blend", lbs: 150 });
    expect(rows[1]).toEqual({ ingredient: "Romano", lbs: 50 });
  });

  it("handles a single-component mix (100% allocation)", () => {
    const recipe = [{ ingredient: "Parmesan", lbs: 2 }];
    const rows = mixIngredientRows(recipe, 80);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ ingredient: "Parmesan", lbs: 80 });
  });

  it("returns empty rows when totalMixLbs is 0", () => {
    const recipe = [{ ingredient: "Blend", lbs: 2 }];
    // lbs = (2/2)*0 = 0, filtered out
    expect(mixIngredientRows(recipe, 0)).toHaveLength(0);
  });

  it("returns empty rows when recipe is empty", () => {
    expect(mixIngredientRows([], 100)).toHaveLength(0);
  });

  it("filters out blank-ingredient rows before computing proportions", () => {
    const recipe = [
      { ingredient: "   ", lbs: 2 },
      { ingredient: "Basil Mix", lbs: 2 },
    ];
    const rows = mixIngredientRows(recipe, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ ingredient: "Basil Mix", lbs: 100 });
  });

  it("does not divide by zero when all oz/pizza values are zero", () => {
    const recipe = [{ ingredient: "Blend", lbs: 0 }];
    // sumOz = 0 → guard fires, returns 0 lbs → filtered out
    expect(mixIngredientRows(recipe, 100)).toHaveLength(0);
  });
});

// ── Today's substitution overlay ──────────────────────────────────────────────

describe("runDetailModal — today's substituted dough recipe", () => {
  const storedRun = {
    ...DEFAULT_VALUES,
    casesNeeded: 25,
    pizzasPerCase: 12,
    targetDoughballWeight: 16,
    doughRecipe: [
      { ingredient: "Standard Flour", lbs: 40 },
      { ingredient: "Water", lbs: 20 },
    ],
  };

  const substitutions = [
    {
      id: "replace-flour",
      ingredient: "Standard Flour",
      action: "swap" as const,
      substitute: "High Gluten Flour",
      amount: 50,
    },
    {
      id: "add-dough-conditioner",
      ingredient: "Water",
      action: "add" as const,
      substitute: "Dough Conditioner",
      amount: 5,
    },
  ];

  it("shows replaced and newly added dough ingredients at their substituted totals", () => {
    // This is the stored recipe for a run that has already started. Daily
    // substitutions deliberately do not mutate it; the Detail dialog must
    // overlay the rows just before it calculates the visible totals.
    setActiveSubstitutions(substitutions);

    // Exactly as Ingredient Detail does for today's run: it keeps the stored
    // value for summary math and overlays only the displayed recipe rows.
    const visibleRows = doughIngredientRows(withSubstitutions(storedRun));

    // 300 pizzas / ((50 + 20 + 5) * 16 / 16) = 4 dough batches.
    expect(visibleRows).toEqual([
      { ingredient: "High Gluten Flour", lbs: 200 },
      { ingredient: "Water", lbs: 80 },
      { ingredient: "Dough Conditioner", lbs: 20 },
    ]);
    expect(visibleRows.find((row) => row.ingredient === "Standard Flour")).toBeUndefined();
  });

  it("leaves historical run recipes and their ingredient detail unchanged", () => {
    const historicalBefore = structuredClone(storedRun);
    const visibleValues = withTodaySubstitutions(storedRun, false, substitutions);

    expect(visibleValues).toBe(storedRun);
    expect(visibleValues).toEqual(historicalBefore);
    expect(doughIngredientRows(visibleValues)).toEqual([
      { ingredient: "Standard Flour", lbs: 200 },
      { ingredient: "Water", lbs: 100 },
    ]);
  });

  it("keeps the real Ingredient Detail dialog wired to the today-only helper", () => {
    // This guard protects the production handoff: the modal must use the
    // today-only helper, while historical recipe detail remains immutable.
    const homeSource = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(homeSource).toContain(
      "withTodaySubstitutions(",
    );
  });
});
