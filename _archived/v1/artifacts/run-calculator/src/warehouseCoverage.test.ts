import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES } from "./types";
import {
  computeWarehouseCoverage,
  type InventoryItem,
  type ProductionIngredient,
} from "./inventoryShared";

const ingredient = (id: string, name: string): ProductionIngredient => ({
  id,
  name,
  mergedInto: null,
  enabled: true,
});

const item = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: 1,
  key: "ingredient:Cheese:lbs",
  category: "ingredient",
  name: "Cheese",
  unit: "lbs",
  reorderThreshold: 0,
  createdAt: "",
  updatedAt: "",
  onHand: 0,
  lots: [],
  byLocation: [],
  productionIngredientId: null,
  conversionFactor: null,
  conversionConfirmed: false,
  consumptionPriority: 0,
  ...overrides,
});

const run = {
  ...DEFAULT_VALUES,
  casesNeeded: 1,
  pizzasPerCase: 10,
  app1Type: "Cheese",
  app1OzPerPizza: 1,
} as typeof DEFAULT_VALUES;

describe("computeWarehouseCoverage", () => {
  it("groups linked products and sums confirmed converted onsite stock", () => {
    const rows = computeWarehouseCoverage(
      [{ values: run }],
      [
        item({
          id: 1,
          name: "Case cheese",
          productionIngredientId: "cheese",
          conversionFactor: 10,
          conversionConfirmed: true,
          onHand: 1,
          byLocation: [{ locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 1 }],
        }),
        item({
          id: 2,
          name: "Backup cheese",
          productionIngredientId: "cheese",
          conversionFactor: 10,
          conversionConfirmed: true,
          onHand: 2,
          byLocation: [{ locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 2 }],
        }),
      ],
      [ingredient("cheese", "Cheese")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ingredientName: "Cheese", linkedProducts: [{ id: 1 }, { id: 2 }], status: "covered" });
    expect(rows[0].covered).toBe(30);
  });

  it("identifies capped transferable stock by source location for an onsite shortfall", () => {
    const rows = computeWarehouseCoverage(
      [{ values: run }],
      [
        item({
          productionIngredientId: "cheese",
          conversionFactor: 10,
          conversionConfirmed: true,
          onHand: 1,
          byLocation: [
            { locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 1 },
            { locationId: 2, locationName: "Cold Storage", isOnsite: false, onHand: 0.4 },
          ],
        }),
        item({
          id: 2,
          productionIngredientId: "cheese",
          conversionFactor: 10,
          conversionConfirmed: true,
          onHand: 0,
          byLocation: [
            { locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 0 },
            { locationId: 3, locationName: "Overflow", isOnsite: false, onHand: 0.5 },
          ],
        }),
      ],
      [ingredient("cheese", "Cheese")],
    );
    expect(rows[0]).toMatchObject({
      covered: 10,
      status: "short",
      transferable: 9,
      transferSources: [
        { locationId: 3, locationName: "Overflow", quantity: 5 },
        { locationId: 2, locationName: "Cold Storage", quantity: 4 },
      ],
    });
  });

  it("does not report transfer stock when onsite coverage is sufficient", () => {
    const rows = computeWarehouseCoverage(
      [{ values: run }],
      [item({
        productionIngredientId: "cheese",
        conversionFactor: 10,
        conversionConfirmed: true,
        onHand: 10,
        byLocation: [
          { locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 10 },
          { locationId: 2, locationName: "Cold Storage", isOnsite: false, onHand: 20 },
        ],
      })],
      [ingredient("cheese", "Cheese")],
    );
    expect(rows[0]).toMatchObject({ covered: 100, status: "covered", transferable: 0, transferSources: [] });
  });

  it("distinguishes missing links, unconfirmed conversions, and shortages", () => {
    const rows = computeWarehouseCoverage(
      [{ values: run }],
      [
        item({ id: 1, name: "Unconfirmed", productionIngredientId: "cheese", onHand: 100 }),
        item({ id: 2, name: "Short cheese", productionIngredientId: "cheese", conversionFactor: 1, conversionConfirmed: true, onHand: 1 }),
      ],
      [ingredient("cheese", "Cheese"), ingredient("pep", "Pepperoni"), ingredient("sauce", "Sauce")],
    );
    expect(rows.find((row) => row.ingredientName === "Cheese")?.status).toBe("conversion");
    expect(rows.find((row) => row.ingredientName === "Cheese")?.linkedProducts).toHaveLength(2);
  });

  it("reports a required catalog ingredient without a linked product", () => {
    const rows = computeWarehouseCoverage(
      [{ values: { ...run, app1Type: "Sauce", app1OzPerPizza: 1 } }],
      [],
      [ingredient("sauce", "Sauce")],
    );
    expect(rows[0]).toMatchObject({ ingredientName: "Sauce", status: "missing", linkedProducts: [] });
  });

  it("replaces a run's local lines with server lines when the run id matches", () => {
    const sources = [
      { runId: "run-server", values: run },
      { runId: "run-local", values: run },
    ];
    const items = [
      item({
        productionIngredientId: "cheese",
        conversionFactor: 10,
        conversionConfirmed: true,
        onHand: 3,
        byLocation: [{ locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 3 }],
      }),
    ];
    const ingredients = [ingredient("cheese", "Cheese")];
    const localOnly = computeWarehouseCoverage(sources, items, ingredients);
    // Two identical runs: each contributes the same local quantity.
    const perRunLocal = localOnly[0].needed / 2;
    const withServer = computeWarehouseCoverage(sources, items, ingredients, {
      // Server-canonical lines: 4 lbs of cheese for the server-backed run.
      "run-server": [{ itemKey: "ingredient:Cheese:lbs", qty: 4 }],
    });
    expect(withServer).toHaveLength(1);
    // run-local keeps its local derivation; run-server uses the server value.
    expect(withServer[0].needed).toBe(perRunLocal + 4);
    expect(withServer[0].covered).toBe(30);
  });

  it("ignores server lines for a run id with no matching source", () => {
    const sources = [{ runId: "run-a", values: run }];
    const ingredients = [ingredient("cheese", "Cheese")];
    const localOnly = computeWarehouseCoverage(sources, [], ingredients);
    const withServer = computeWarehouseCoverage(sources, [], ingredients, {
      "run-other": [{ itemKey: "ingredient:Cheese:lbs", qty: 999 }],
    });
    expect(withServer).toEqual(localOnly);
  });
});
