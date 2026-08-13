import { describe, it, expect } from "vitest";
import { computeCheesePull } from "@workspace/inventory-math";

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
