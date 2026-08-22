import { describe, it, expect } from "vitest";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  formatDiscrepanciesForPrompt,
  fmtLbs,
  reconcileSpecProfiles,
  toReconcileProfiles,
  formatProfileDiscrepanciesForPrompt,
  buildImportReview,
  type ReconcileRecipe,
  type ReconcileProfile,
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

describe("buildImportReview", () => {
  it("surfaces added, removed, and quantity-changed ingredient rows", () => {
    const review = buildImportReview({
      currentRecipes: [dough("Standard", [["Flour", 50], ["Sugar", 2]])],
      incomingRecipes: [dough("Standard", [["Flour", 48], ["Salt", 1]])],
    });
    expect(review.counts).toMatchObject({
      added: 1,
      removed: 1,
      "quantity-changed": 1,
    });
    expect(review.requiresExplicitConfirmation).toBe(true);
    expect(review.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "removed", requiresConfirmation: true }),
    ]));
  });

  it("requires confirmation for a material single-row quantity change but not a small adjustment", () => {
    const large = buildImportReview({
      currentRecipes: [dough("Standard", [["Flour", 50]])],
      incomingRecipes: [dough("Standard", [["Flour", 65]])],
    });
    const small = buildImportReview({
      currentRecipes: [dough("Standard", [["Flour", 50]])],
      incomingRecipes: [dough("Standard", [["Flour", 55]])],
    });
    expect(large.requiresExplicitConfirmation).toBe(true);
    expect(large.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "quantity-changed", requiresConfirmation: true }),
    ]));
    expect(small.requiresExplicitConfirmation).toBe(false);
  });

  it("requires confirmation before clearing a nonempty formula", () => {
    const review = buildImportReview({
      currentRecipes: [dough("Standard", [["Flour", 50]])],
      incomingRecipes: [dough("Standard", [])],
    });
    expect(review.counts["formula-cleared"]).toBe(1);
    expect(review.requiresExplicitConfirmation).toBe(true);
    expect(review.changes[0]).toMatchObject({
      kind: "formula-cleared",
      requiresConfirmation: true,
    });
  });

  it("requires confirmation for broad and ambiguous customer mappings", () => {
    const review = buildImportReview({
      currentRecipes: [],
      incomingRecipes: [],
      customerMappings: [
        { brand: "Acme", qualifier: "thin", flavors: [""] },
        { brand: "Acme", qualifier: "thick", flavors: [""] },
      ],
    });
    expect(review.counts["customer-remapped"]).toBe(3);
    expect(review.requiresExplicitConfirmation).toBe(true);
    expect(review.changes.some((change) => change.message.includes("ambiguous"))).toBe(true);
  });

  it("requires confirmation when a large set of profiles is removed", () => {
    const review = buildImportReview({
      currentRecipes: [],
      incomingRecipes: [],
      removedProfiles: Array.from({ length: 8 }, (_, i) => ({
        brand: "Acme",
        flavor: `Flavor ${i}`,
      })),
    });
    expect(review.counts.removed).toBe(8);
    expect(review.requiresExplicitConfirmation).toBe(true);
  });

  it("requires confirmation for a single selected profile deletion", () => {
    const review = buildImportReview({
      currentRecipes: [],
      incomingRecipes: [],
      removedProfiles: [{ brand: "Acme", flavor: "Thin" }],
    });
    expect(review.requiresExplicitConfirmation).toBe(true);
    expect(review.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: 'profile "Acme Thin"',
        requiresConfirmation: true,
      }),
    ]));
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

const prof = (over: Partial<ReconcileProfile> = {}): ReconcileProfile => ({
  brand: "Basha",
  flavor: "Original",
  dieType: "10 inch",
  sauceOzPerPizza: 4,
  applicators: [{ type: "Mozzarella", ozPerPizza: 4 }],
  pepperonis: [{ type: "Pepperoni", sticks: 2, ozPerPizza: 1.5 }],
  ...over,
});

describe("reconcileSpecProfiles", () => {
  it("reports no discrepancies when profiles match exactly", () => {
    const p = prof();
    expect(reconcileSpecProfiles({ specProfiles: [p], currentProfiles: [p] })).toEqual([]);
  });

  it("flags a profile the current library is missing", () => {
    const out = reconcileSpecProfiles({ specProfiles: [prof()], currentProfiles: [] });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("missing-profile");
  });

  it("matches profiles case-insensitively by brand+flavor", () => {
    const spec = prof({ brand: "Basha", flavor: "Original" });
    const cur = prof({ brand: "basha", flavor: "ORIGINAL" });
    expect(reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [cur] })).toEqual([]);
  });

  it("flags die and sauce mismatches", () => {
    const spec = prof({ dieType: "10 inch", sauceOzPerPizza: 4 });
    const cur = prof({ dieType: "12 inch", sauceOzPerPizza: 5 });
    const out = reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [cur] });
    const types = out.map((d) => d.type).sort();
    expect(types).toEqual(["die-mismatch", "sauce-mismatch"]);
  });

  it("ignores die/sauce when the spec sheet does not specify them", () => {
    const spec = prof({ dieType: undefined, sauceOzPerPizza: undefined });
    const cur = prof({ dieType: "anything", sauceOzPerPizza: 99 });
    expect(reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [cur] })).toEqual([]);
  });

  it("compares applicators by slot: type mismatch and amount mismatch", () => {
    const spec = prof({
      applicators: [
        { type: "Mozzarella", ozPerPizza: 4 },
        { type: "Cheddar", ozPerPizza: 2 },
      ],
    });
    const curType = prof({
      applicators: [
        { type: "Provolone", ozPerPizza: 4 },
        { type: "Cheddar", ozPerPizza: 2 },
      ],
    });
    const t = reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [curType] });
    expect(t).toHaveLength(1);
    expect(t[0].type).toBe("applicator-type-mismatch");
    expect(t[0].field).toBe("applicator 1");

    const curOz = prof({
      applicators: [
        { type: "Mozzarella", ozPerPizza: 6 },
        { type: "Cheddar", ozPerPizza: 2 },
      ],
    });
    const a = reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [curOz] });
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("applicator-amount-mismatch");
  });

  it("only checks applicator slots the spec sheet fills", () => {
    const spec = prof({ applicators: [{ type: "Mozzarella", ozPerPizza: 4 }] });
    const cur = prof({
      applicators: [
        { type: "Mozzarella", ozPerPizza: 4 },
        { type: "Extra Cheese", ozPerPizza: 3 },
      ],
    });
    expect(reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [cur] })).toEqual([]);
  });

  it("compares pepperonis by slot for type and amount", () => {
    const spec = prof({ pepperonis: [{ type: "Pepperoni", sticks: 2, ozPerPizza: 1.5 }] });
    const curType = prof({ pepperonis: [{ type: "Sausage", sticks: 2, ozPerPizza: 1.5 }] });
    const t = reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [curType] });
    expect(t).toHaveLength(1);
    expect(t[0].type).toBe("pepperoni-type-mismatch");

    const curAmt = prof({ pepperonis: [{ type: "Pepperoni", sticks: 3, ozPerPizza: 2 }] });
    const a = reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [curAmt] });
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("pepperoni-amount-mismatch");
  });

  it("respects the numeric tolerance for floating-point noise", () => {
    const spec = prof({ sauceOzPerPizza: 4 });
    const cur = prof({ sauceOzPerPizza: 4.0005 });
    expect(reconcileSpecProfiles({ specProfiles: [spec], currentProfiles: [cur] })).toEqual([]);
  });
});

describe("toReconcileProfiles", () => {
  it("normalizes a saved spec sheet's profile array and drops malformed entries", () => {
    const out = toReconcileProfiles([
      {
        brand: "Basha",
        flavor: "Original",
        dieType: "10 inch",
        sauceOzPerPizza: 4,
        applicators: [{ type: "Mozzarella", ozPerPizza: 4 }],
        pepperonis: [{ type: "Pepperoni", sticks: 2, ozPerPizza: 1.5 }],
        extra: "ignored",
      },
      { brand: "", flavor: "Nope", applicators: [], pepperonis: [] },
      { flavor: "NoBrand", applicators: [], pepperonis: [] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].brand).toBe("Basha");
    expect(out[0].applicators).toEqual([{ type: "Mozzarella", ozPerPizza: 4 }]);
    expect(out[0].dieType).toBe("10 inch");
  });

  it("omits die/sauce when absent and returns [] for non-array input", () => {
    const out = toReconcileProfiles([{ brand: "B", flavor: "F", applicators: [], pepperonis: [] }]);
    expect(out[0].dieType).toBeUndefined();
    expect(out[0].sauceOzPerPizza).toBeUndefined();
    expect(toReconcileProfiles(null)).toEqual([]);
    expect(toReconcileProfiles({})).toEqual([]);
  });
});

describe("formatProfileDiscrepanciesForPrompt", () => {
  it("renders one line per profile discrepancy", () => {
    const out = reconcileSpecProfiles({ specProfiles: [prof()], currentProfiles: [] });
    expect(formatProfileDiscrepanciesForPrompt(out)).toBe(
      '- [profile] The profile "Basha Original" is on the spec sheet but isn\'t set up in your current profiles.',
    );
  });
});
