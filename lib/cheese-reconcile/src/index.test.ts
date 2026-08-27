import { describe, expect, it } from "vitest";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { applyCheeseRepairItem, reconcileCheeseRecipes } from "./index";

const recipe = (overrides: Partial<CheeseRecipe> = {}): CheeseRecipe => ({
  id: "cheese-1",
  name: "Mozz Blend",
  brand: "Acme",
  flavors: ["Pepperoni"],
  shredderSetting: "3",
  cellulose: "1%",
  notes: "manager note",
  components: [{ ingredient: "Mozzarella", lbs: 100, sharePct: 50 }],
  enabled: false,
  ...overrides,
});

describe("reconcileCheeseRecipes", () => {
  it("reports component, assignment, and metadata drift while preserving operational fields", () => {
    const current = recipe();
    const source = recipe({
      components: [{ ingredient: "Mozzarella", lbs: 110 }, { ingredient: "Cheddar", lbs: 5 }],
      flavors: ["Cheese"],
      shredderSetting: "4",
      cellulose: "2%",
      notes: "",
      enabled: true,
    });
    const out = reconcileCheeseRecipes({ currentRecipes: [current], sourceRecipes: [source] });
    expect(out.items[0]?.status).toBe("drift");
    expect(out.discrepancies.map((d) => d.type)).toEqual([
      "amount-mismatch", "missing-component", "assignment-mismatch", "metadata-mismatch", "metadata-mismatch",
    ]);
    expect(out.items[0]?.suggestedRecipe).toMatchObject({ enabled: false, notes: "manager note" });
    expect(out.items[0]?.suggestedRecipe?.components[0]?.sharePct).toBe(50);
  });

  it("creates missing recipes, flags ambiguity, and never emits current-only deletion", () => {
    const out = reconcileCheeseRecipes({
      currentRecipes: [
        recipe({ id: "a", name: "Same", components: [] }),
        recipe({ id: "b", name: "Same", components: [] }),
        recipe({ id: "current-only", name: "Only Here" }),
      ],
      sourceRecipes: [recipe({ id: "new", name: "New Blend" }), recipe({ id: "source-same", name: "Same" })],
    });
    expect(out.items.map((i) => i.status)).toEqual(["new", "ambiguous"]);
    expect(out.items.some((i) => i.recipeName === "Only Here")).toBe(false);
  });

  it("rejects stale apply and preserves operational state", () => {
    const current = recipe();
    const out = reconcileCheeseRecipes({
      currentRecipes: [current],
      sourceRecipes: [recipe({ components: [{ ingredient: "Mozzarella", lbs: 110 }] })],
    });
    const item = out.items[0]!;
    expect(() => applyCheeseRepairItem([{ ...current, components: [{ ingredient: "Mozzarella", lbs: 101 }] }], item)).toThrow(/changed/);
    const saved = applyCheeseRepairItem([current], item);
    expect(saved[0]).toMatchObject({ enabled: false, notes: "manager note", components: [{ lbs: 110 }] });
  });
});