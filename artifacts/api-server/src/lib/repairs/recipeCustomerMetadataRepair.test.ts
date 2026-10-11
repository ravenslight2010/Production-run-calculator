import { describe, expect, it } from "vitest";
import {
  cheeseRecipesTable,
  doughRecipesTable,
  mixesTable,
  sauceRecipesTable,
} from "@workspace/db";
import { recipeCustomerMetadataCleanupRepair } from "./recipeCustomerMetadataRepair";

describe("recipe customer metadata cleanup", () => {
  it("reports inspected and changed rows for every pool while preserving other fields", async () => {
    const rows = new Map<unknown, unknown[]>([
      [doughRecipesTable, [{
        id: "dough-1",
        scope: "live",
        name: "Dough",
        brand: " Bobo ",
        flavors: [" Flavor ", "flavor"],
        components: [{ ingredient: "Flour", lbs: 10 }],
        doughballVariants: [{
          label: "Standard",
          customers: [{ brand: " Bobo ", flavor: " Flavor " }, { brand: "bobo", flavor: "flavor"}],
        }],
      }]],
      [sauceRecipesTable, [{
        id: "sauce-1",
        scope: "live",
        name: "Sauce",
        brand: null,
        flavors: ["Stray"],
        components: [{ ingredient: "Tomato", lbs: 5 }],
      }]],
      [cheeseRecipesTable, [{
        id: "cheese-1",
        scope: "live",
        name: "Cheese",
        brand: " Bobo ",
        flavors: ["All Varieties", " Pepperoni ", "pepperoni"],
        components: [{ ingredient: "Cheese", lbs: 3 }],
      }]],
      [mixesTable, [{
        id: "mix-1",
        scope: "live",
        name: "Mix",
        brand: " Bobo ",
        flavor: " Flavor ",
        components: [{ ingredient: "Salt", lbs: 1 }],
      }]],
    ]);
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          for: async () => rows.get(table) ?? [],
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ table, values });
          },
        }),
      }),
    };

    const result = await recipeCustomerMetadataCleanupRepair.execute(tx as never);

    expect(result).toEqual({
      inspectedRows: 4,
      changedRows: 4,
      byPool: {
        dough: { inspected: 1, changed: 1 },
        sauce: { inspected: 1, changed: 1 },
        cheese: { inspected: 1, changed: 1 },
        mix: { inspected: 1, changed: 1 },
      },
    });
    expect(updates).toHaveLength(4);
    expect(updates.find(({ table }) => table === doughRecipesTable)?.values).toMatchObject({
      brand: "Bobo",
      flavors: ["Flavor"],
      doughballVariants: [{
        label: "Standard",
        customers: [{ brand: "Bobo", flavor: "Flavor" }],
      }],
    });
    expect(updates.find(({ table }) => table === sauceRecipesTable)?.values)
      .toMatchObject({ brand: "", flavors: [] });
    expect(updates.find(({ table }) => table === cheeseRecipesTable)?.values)
      .toMatchObject({ brand: "Bobo", flavors: ["Pepperoni"] });
    expect(updates.find(({ table }) => table === mixesTable)?.values)
      .toMatchObject({ brand: "Bobo", flavor: "Flavor" });
    for (const update of updates) {
      expect(update.values).toHaveProperty("updatedAt");
      expect(update.values).not.toHaveProperty("name");
      expect(update.values).not.toHaveProperty("components");
    }
  });
});