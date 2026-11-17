import { describe, expect, it } from "vitest";
import { CRB_INGREDIENT_HEAL_ROWS, isAffectedCrbIngredientRow } from "./crbIngredientHeal";

describe("CRB ingredient heal scope", () => {
  const variants = Array.from({ length: 12 }, (_, i) => ({ label: `CRB ${i}` }));

  it("matches only the empty landed CRB family stub", () => {
    expect(isAffectedCrbIngredientRow({ name: "CRB Recipe", components: [], doughballVariants: variants })).toBe(true);
    expect(isAffectedCrbIngredientRow({ name: "CRB Dough", components: [], doughballVariants: variants })).toBe(false);
    expect(isAffectedCrbIngredientRow({ name: "CRB Recipe", components: [{ ingredient: "Flour", lbs: 1 }], doughballVariants: variants })).toBe(false);
    expect(isAffectedCrbIngredientRow({ name: "CRB Recipe", components: [], doughballVariants: variants.slice(0, 11) })).toBe(false);
  });

  it("uses the seven source rows without altering the variant chart", () => {
    expect(CRB_INGREDIENT_HEAL_ROWS).toHaveLength(7);
    expect(CRB_INGREDIENT_HEAL_ROWS.reduce((sum, row) => sum + row.lbs, 0)).toBe(319.9);
  });
});