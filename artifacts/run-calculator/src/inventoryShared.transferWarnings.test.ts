import { describe, expect, it } from "vitest";
import { computeTransferNeeds, type LocationStock } from "@workspace/inventory-math";
import { buildStockByKey, type InventoryItem } from "./inventoryShared";

const item = (key: string, byLocation: LocationStock[]): InventoryItem => ({
  id: 1,
  key,
  category: "ingredient",
  name: key,
  unit: "lbs",
  reorderThreshold: 0,
  createdAt: "",
  updatedAt: "",
  onHand: byLocation.reduce((total, location) => total + location.onHand, 0),
  lots: [],
  byLocation,
  productionIngredientId: null,
  conversionFactor: null,
  conversionConfirmed: false,
  consumptionPriority: 0,
});

const location = (overrides: Partial<LocationStock>): LocationStock => ({
  locationId: 1,
  locationName: "Onsite",
  isOnsite: true,
  onHand: 0,
  ...overrides,
});

describe("buildStockByKey", () => {
  it("preserves reserved and ordinary keys for transfer calculations", () => {
    const stockByKey = buildStockByKey([
      item("__proto__", [
        location({ onHand: 2 }),
        location({ locationId: 2, locationName: "Cold Storage", isOnsite: false, onHand: 8 }),
      ]),
      item("constructor", [
        location({ onHand: 1 }),
        location({ locationId: 3, locationName: "Overflow", isOnsite: false, onHand: 4 }),
      ]),
      item("ingredient:Cheese:lbs", [
        location({ onHand: 3 }),
        location({ locationId: 4, locationName: "Warehouse", isOnsite: false, onHand: 7 }),
      ]),
    ]);

    expect(Object.getPrototypeOf(stockByKey)).toBeNull();
    expect(Object.keys(stockByKey)).toEqual([
      "__proto__",
      "constructor",
      "ingredient:Cheese:lbs",
    ]);

    const needs = computeTransferNeeds({
      demands: [
        { key: "__proto__", name: "Proto", unit: "lbs", category: "ingredient", qty: 6 },
        { key: "constructor", name: "Constructor", unit: "lbs", category: "ingredient", qty: 3 },
        { key: "ingredient:Cheese:lbs", name: "Cheese", unit: "lbs", category: "ingredient", qty: 9 },
      ],
      stockByKey,
    });

    expect(needs.map(({ key, onsite, offsiteAvailable, transferable }) => ({
      key,
      onsite,
      offsiteAvailable,
      transferable,
    }))).toEqual([
      { key: "__proto__", onsite: 2, offsiteAvailable: 8, transferable: 4 },
      { key: "constructor", onsite: 1, offsiteAvailable: 4, transferable: 2 },
      { key: "ingredient:Cheese:lbs", onsite: 3, offsiteAvailable: 7, transferable: 6 },
    ]);
  });

  it("treats a missing reserved key as empty stock", () => {
    const stockByKey = buildStockByKey([]);

    expect(() => computeTransferNeeds({
      demands: [
        { key: "toString", name: "Missing", unit: "lbs", category: "ingredient", qty: 1 },
      ],
      stockByKey,
    })).not.toThrow();
    expect(computeTransferNeeds({
      demands: [
        { key: "toString", name: "Missing", unit: "lbs", category: "ingredient", qty: 1 },
      ],
      stockByKey,
    })).toEqual([]);
  });
});
