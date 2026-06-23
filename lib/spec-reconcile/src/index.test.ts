import { describe, it, expect } from "vitest";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  formatDiscrepanciesForPrompt,
  fmtLbs,
  type ReconcileRecipe,
} from "./index";

const dough = (name: string, rows: [string, number][]): ReconcileRecipe => ({
  kind: "dough",
  name,
  rows: rows.map(([ingredient, lbs]) => ({ ingredient, lbs })),
});

describe("reconcileSpecWithRecipes", () => {
  it("reports no discrepancies when recipes match exactly", () => {
    const recipe = dough("Standard", [["Flour", 50], ["Water", 30]]);
    const out = reconcileSpecWithRecipes({ specRecipes: [recipe], currentRecipes: [recipe] });
    expect(out).toEqual([]);
  });

  it("matches by kind+name case-insensitively and trims", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("  Standard ", [["Flour", 50]])],
      currentRecipes: [dough("standard", [["flour", 50]])],
    });
    expect(out).toEqual([]);
  });

  it("flags a recipe on the spec sheet but absent from current recipes", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 50]])],
      currentRecipes: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("missing-recipe");
    expect(out[0].recipeName).toBe("Standard");
  });

  it("does NOT flag a current recipe that is absent from the spec sheet", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [],
      currentRecipes: [dough("Standard", [["Flour", 50]])],
    });
    expect(out).toEqual([]);
  });

  it("flags a missing ingredient", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 50], ["Salt", 1]])],
      currentRecipes: [dough("Standard", [["Flour", 50]])],
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("missing-ingredient");
    expect(out[0].ingredient).toBe("Salt");
    expect(out[0].specLbs).toBe(1);
  });

  it("flags an extra ingredient in the current recipe", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 50]])],
      currentRecipes: [dough("Standard", [["Flour", 50], ["Sugar", 2]])],
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("extra-ingredient");
    expect(out[0].ingredient).toBe("Sugar");
    expect(out[0].currentLbs).toBe(2);
  });

  it("flags an amount mismatch beyond tolerance", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 50]])],
      currentRecipes: [dough("Standard", [["Flour", 48]])],
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("amount-mismatch");
    expect(out[0].specLbs).toBe(50);
    expect(out[0].currentLbs).toBe(48);
  });

  it("ignores tiny floating-point differences within tolerance", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 50]])],
      currentRecipes: [dough("Standard", [["Flour", 50.0005]])],
    });
    expect(out).toEqual([]);
  });

  it("respects a custom tolerance", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 50]])],
      currentRecipes: [dough("Standard", [["Flour", 50.5]])],
      lbsTolerance: 1,
    });
    expect(out).toEqual([]);
  });

  it("sums duplicate ingredient rows before comparing", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 25], ["Flour", 25]])],
      currentRecipes: [dough("Standard", [["Flour", 50]])],
    });
    expect(out).toEqual([]);
  });

  it("only compares recipes of the same kind", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [{ kind: "dough", name: "X", rows: [{ ingredient: "Flour", lbs: 1 }] }],
      currentRecipes: [{ kind: "sauce", name: "X", rows: [{ ingredient: "Flour", lbs: 1 }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("missing-recipe");
  });
});

describe("toReconcileRecipes", () => {
  it("normalizes a saved spec sheet's recipe array and drops malformed entries", () => {
    const out = toReconcileRecipes([
      { kind: "dough", name: "Std", doughballOz: 8, rows: [{ ingredient: "Flour", lbs: 50 }] },
      { kind: "bogus", name: "Nope", rows: [] },
      { kind: "sauce", name: "", rows: [] },
      { kind: "cheese", name: "Blend", rows: [{ ingredient: "", lbs: 1 }, { ingredient: "Mozz", lbs: "5" as unknown as number }] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ kind: "dough", name: "Std", rows: [{ ingredient: "Flour", lbs: 50 }] });
    expect(out[1]).toEqual({ kind: "cheese", name: "Blend", rows: [{ ingredient: "Mozz", lbs: 5 }] });
  });

  it("returns [] for non-array input", () => {
    expect(toReconcileRecipes(null)).toEqual([]);
    expect(toReconcileRecipes(undefined)).toEqual([]);
    expect(toReconcileRecipes({})).toEqual([]);
  });
});

describe("formatDiscrepanciesForPrompt / fmtLbs", () => {
  it("renders one line per discrepancy", () => {
    const out = reconcileSpecWithRecipes({
      specRecipes: [dough("Standard", [["Flour", 50]])],
      currentRecipes: [],
    });
    expect(formatDiscrepanciesForPrompt(out)).toBe(
      '- [dough] The dough recipe "Standard" is on the spec sheet but isn\'t in your current recipes.',
    );
  });

  it("formats pounds without trailing zeros", () => {
    expect(fmtLbs(50)).toBe("50");
    expect(fmtLbs(50.5)).toBe("50.5");
    expect(fmtLbs(50.0005)).toBe("50.001");
  });
});
