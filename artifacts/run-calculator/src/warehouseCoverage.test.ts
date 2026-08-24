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
      [run],
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
      [run],
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
      [run],
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
      [run],
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
      [{ ...run, app1Type: "Sauce", app1OzPerPizza: 1 }],
      [],
      [ingredient("sauce", "Sauce")],
    );
    expect(rows[0]).toMatchObject({ ingredientName: "Sauce", status: "missing", linkedProducts: [] });
  });
});