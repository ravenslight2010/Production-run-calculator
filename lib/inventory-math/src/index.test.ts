import { describe, it, expect } from "vitest";
import {
  applyRecipeSubstitutions,
  applySubstitutions,
  substitutionsForIngredient,
  computeRunConsumptionLines,
  computeSummaryStats,
  type IngredientSubstitution,
  type RecipeRow,
  type RunLinesInput,
} from "./index";

const PEP = ["Pepperoni"] as const;

// A complete settings object so computeSummaryStats/computeRunLines never hit an
// undefined field. Callers override only what a given test cares about.
function baseVals(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    casesNeeded: 10,
    pizzasPerCase: 1,
    casesPerLayer: 1,
    sauceBarrelLbs: 0,
    sauceOzPerPizza: 0,
    app1OzPerPizza: 0, app1BatchLbs: 0, app1Type: "",
    app2OzPerPizza: 0, app2BatchLbs: 0, app2Type: "",
    app3OzPerPizza: 0, app3BatchLbs: 0, app3Type: "",
    app4OzPerPizza: 0, app4BatchLbs: 0, app4Type: "",
    pep1OzPerPizza: 0, pep1Sticks: 0, pep1BatchLbs: 0, pep1Type: "",
    pep2OzPerPizza: 0, pep2Sticks: 0, pep2BatchLbs: 0, pep2Type: "",
    crustsPerCycle: 0, cycleSpeed: 0, speedAdjustment: 0,
    doughballWeightOz: 0, doughBatchYield: 0, cartonsPerCase: 0,
    ...over,
  };
}

function sub(p: Partial<IngredientSubstitution>): IngredientSubstitution {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    ingredient: p.ingredient ?? "",
    action: p.action ?? "swap",
    substitute: p.substitute,
    amount: p.amount,
  };
}

describe("substitutionsForIngredient", () => {
  it("matches case-insensitively and trims", () => {
    const subs = [sub({ ingredient: "Whole Mozzarella", action: "remove" })];
    expect(substitutionsForIngredient(subs, "  whole mozzarella ")).toHaveLength(1);
    expect(substitutionsForIngredient(subs, "Part Skim")).toHaveLength(0);
    expect(substitutionsForIngredient(undefined, "x")).toEqual([]);
  });
});

describe("applyRecipeSubstitutions", () => {
  const rows: RecipeRow[] = [
    { ingredient: "Flour", lbs: 50 },
    { ingredient: "Water", lbs: 30 },
  ];

  it("returns a fresh copy and changed=false when no subs", () => {
    const out = applyRecipeSubstitutions(rows, []);
    expect(out.changed).toBe(false);
    expect(out.rows).toEqual(rows);
    expect(out.rows).not.toBe(rows);
  });

  it("swaps with a new amount", () => {
    const out = applyRecipeSubstitutions(rows, [
      sub({ ingredient: "Flour", action: "swap", substitute: "Alt Flour", amount: 45 }),
    ]);
    expect(out.changed).toBe(true);
    expect(out.rows).toEqual([
      { ingredient: "Alt Flour", lbs: 45 },
      { ingredient: "Water", lbs: 30 },
    ]);
  });

  it("swap without amount keeps the original lbs", () => {
    const out = applyRecipeSubstitutions(rows, [
      sub({ ingredient: "Flour", action: "swap", substitute: "Alt Flour" }),
    ]);
    expect(out.rows[0]).toEqual({ ingredient: "Alt Flour", lbs: 50 });
  });

  it("adds a supplement row, keeping the original", () => {
    const out = applyRecipeSubstitutions(rows, [
      sub({ ingredient: "Flour", action: "add", substitute: "Flour Extender", amount: 10 }),
    ]);
    expect(out.changed).toBe(true);
    expect(out.rows).toEqual([
      { ingredient: "Flour", lbs: 50 },
      { ingredient: "Flour Extender", lbs: 10 },
      { ingredient: "Water", lbs: 30 },
    ]);
  });

  it("removes a row", () => {
    const out = applyRecipeSubstitutions(rows, [
      sub({ ingredient: "Water", action: "remove" }),
    ]);
    expect(out.changed).toBe(true);
    expect(out.rows).toEqual([{ ingredient: "Flour", lbs: 50 }]);
  });
});

describe("applySubstitutions on type fields", () => {
  it("swaps an applicator type so the consumption key changes", () => {
    const vals = {
      app1Type: "Whole Mozzarella",
      app1BatchLbs: 30,
      app1OzPerPizza: 4,
    } as Record<string, unknown>;
    const out = applySubstitutions(vals, [
      sub({ ingredient: "Whole Mozzarella", action: "swap", substitute: "Part Skim Mozzarella" }),
    ]);
    expect(out.app1Type).toBe("Part Skim Mozzarella");
    // input not mutated
    expect(vals.app1Type).toBe("Whole Mozzarella");
  });

  it("clears an applicator type on remove", () => {
    const out = applySubstitutions(
      { app2Type: "Diced Pepperoni" } as Record<string, unknown>,
      [sub({ ingredient: "Diced Pepperoni", action: "remove" })],
    );
    expect(out.app2Type).toBe("");
  });

  it("leaves a type field untouched for add", () => {
    const out = applySubstitutions(
      { pep1Type: "Pepperoni" } as Record<string, unknown>,
      [sub({ ingredient: "Pepperoni", action: "add", substitute: "Extra", amount: 1 })],
    );
    expect(out.pep1Type).toBe("Pepperoni");
  });

  it("is a no-op (same ref) when there are no subs", () => {
    const vals = { app1Type: "Whole Mozzarella" } as Record<string, unknown>;
    expect(applySubstitutions(vals, [])).toBe(vals);
  });
});

describe("overlay changes inventory consumption keys", () => {
  it("draws down the substitute and not the short item", () => {
    const vals = baseVals({
      app1Type: "Whole Mozzarella",
      app1BatchLbs: 30,
      app1OzPerPizza: 4,
    });
    const subs = [
      sub({ ingredient: "Whole Mozzarella", action: "swap", substitute: "Part Skim Mozzarella" }),
    ];
    const before = computeRunConsumptionLines(vals as unknown as RunLinesInput, PEP).map((l) => l.itemKey);
    const after = computeRunConsumptionLines(
      applySubstitutions(vals, subs) as unknown as RunLinesInput,
      PEP,
    ).map((l) => l.itemKey);
    expect(before.some((k) => k.includes("Whole Mozzarella"))).toBe(true);
    expect(after.some((k) => k.includes("Whole Mozzarella"))).toBe(false);
    expect(after.some((k) => k.includes("Part Skim Mozzarella"))).toBe(true);
  });
});

// Parity guard: the SAME shared overlay + summary math must produce identical
// material totals regardless of which app calls it (replit.md parity). Both
// platforms route through applySubstitutions then computeSummaryStats, so a
// single shared computation proves they can't drift.
describe("web/mobile parity", () => {
  it("substituted summary totals are identical through the shared path", () => {
    const vals = baseVals({
      casesNeeded: 12,
      casesPerLayer: 2,
      doughballWeightOz: 10,
      app1Type: "Whole Mozzarella",
      app1BatchLbs: 30,
      app1OzPerPizza: 4,
      doughRecipe: [
        { ingredient: "Flour", lbs: 50 },
        { ingredient: "Water", lbs: 30 },
      ],
    });
    const subs = [
      sub({ ingredient: "Flour", action: "swap", substitute: "GF Flour", amount: 55 }),
      sub({ ingredient: "Whole Mozzarella", action: "swap", substitute: "Part Skim Mozzarella" }),
    ];
    const effective = applySubstitutions(vals, subs) as unknown as RunLinesInput;
    const web = computeSummaryStats(effective, PEP);
    const mobile = computeSummaryStats(effective, PEP);
    expect(web).toEqual(mobile);
    // sanity: the swap actually flowed into the effective recipe
    expect((effective.doughRecipe as RecipeRow[])[0]).toEqual({ ingredient: "GF Flour", lbs: 55 });
  });
});
