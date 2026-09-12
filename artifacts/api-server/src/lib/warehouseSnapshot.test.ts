import { describe, it, expect } from "vitest";
import {
  computeWarehouseSnapshot,
  buildDemandByKey,
  buildStockByKey,
  type WarehouseSnapshotItem,
  type WarehouseSnapshotLocation,
} from "./warehouseSnapshot";

const locations: WarehouseSnapshotLocation[] = [
  { id: 1, name: "Onsite", isOnsite: true },
  { id: 2, name: "Warehouse", isOnsite: false },
];

function item(overrides: Partial<WarehouseSnapshotItem> & { key: string }): WarehouseSnapshotItem {
  return {
    name: overrides.key.split(":")[1] ?? overrides.key,
    unit: "lbs",
    category: "ingredient",
    onHand: 0,
    reorderThreshold: 0,
    byLocation: [],
    lots: [],
    ...overrides,
  };
}

// A realistic scheduled-run value row, shaped like the brand-profile merge the
// route produces. computeRunLines keys demand by the APPLICATOR TYPE ("Cheese"
// -> ingredient:Cheese:batches) — the same keys the web inventory items use, so
// reorder/transfer matching can never drift between server and client.
const cheeseBaseRun = {
  casesNeeded: 10,
  pizzasPerCase: 6,
  casesPerLayer: 1,
  targetDoughballWeight: 5,
  doughBatchYield: 100,
  crustsPerCase: 12,
  cartonsPerCase: 6,
  doughRecipe: [],
  frontlineRecipe: [],
  app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 10 }],
  app2CheeseRecipe: [],
  app3CheeseRecipe: [],
  app4CheeseRecipe: [],
  app1Type: "Cheese",
  app1OzPerPizza: 8,
  app1BatchLbs: 0,
  app2Type: "",
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3Type: "",
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4Type: "",
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Type: "Pepperoni Stick",
  pep1OzPerPizza: 2,
  pep1Sticks: 2,
  pep1BatchLbs: 0,
  pep2Type: "",
  pep2OzPerPizza: 0,
  pep2Sticks: 0,
  pep2BatchLbs: 0,
  sauceOzPerPizza: 4,
  sauceBarrelLbs: 0,
  crustsPerCycle: 1,
  cycleSpeed: 10,
  speedAdjustment: 1,
};

describe("buildDemandByKey", () => {
  it("aggregates recipe ingredient demand across scheduled runs on computeRunLines keys", () => {
    const demand = buildDemandByKey([
      { ...cheeseBaseRun },
      { ...cheeseBaseRun, casesNeeded: 5 },
    ] as Array<Record<string, unknown>>);
    // 10 cases x 6 pizzas + 1 layer x 6 = 66 sauced pizzas; app1Lbs =
    // (66 * 8)/16 + 20 = 53; app1 recipe 10 lbs/batch -> 5.3 batches. Second run
    // (5 cases): (36 * 8)/16 + 20 = 38 -> 3.8 batches. Total 9.1.
    expect(demand["ingredient:Cheese:batches"]).toBeCloseTo(9.1, 5);
    // Pepperoni isn't in the web DEFAULT_PEP_TYPES list, so it tracks by lbs.
    expect(demand["ingredient:Pepperoni Stick:lbs"]).toBeGreaterThan(0);
  });
});

describe("computeWarehouseSnapshot", () => {
  it("returns empty lists for empty inputs", () => {
    const snapshot = computeWarehouseSnapshot({
      todayRunValues: [],
      scheduledRunValues: [],
      items: [],
      locations: [],
      soonDays: 7,
    });
    expect(snapshot.reorder).toEqual([]);
    expect(snapshot.useFirst).toEqual([]);
    expect(snapshot.transfer).toEqual([]);
  });

  it("flags an item whose on-hand drops below threshold after scheduled demand", () => {
    const cheese = item({
      key: "ingredient:Cheese:batches",
      name: "Cheese",
      unit: "batches",
      onHand: 30,
      reorderThreshold: 50,
      byLocation: [
        { locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 30 },
      ],
    });
    const snapshot = computeWarehouseSnapshot({
      todayRunValues: [],
      scheduledRunValues: [{ ...cheeseBaseRun } as Record<string, unknown>],
      items: [cheese],
      locations,
      soonDays: 7,
    });
    expect(snapshot.reorder.length).toBeGreaterThan(0);
    expect(snapshot.reorder[0].key).toBe("ingredient:Cheese:batches");
    expect(snapshot.reorder[0].projectedOnHand).toBeCloseTo(24.7, 5);
  });

  it("surfaces a transfer warning from today's run demand when onsite is short but warehouse has stock", () => {
    const cheese = item({
      key: "ingredient:Cheese:batches",
      name: "Cheese",
      unit: "batches",
      onHand: 80,
      reorderThreshold: 0,
      byLocation: [
        { locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 5 },
        { locationId: 2, locationName: "Warehouse", isOnsite: false, onHand: 75 },
      ],
    });
    const snapshot = computeWarehouseSnapshot({
      todayRunValues: [{ ...cheeseBaseRun } as Record<string, unknown>],
      scheduledRunValues: [],
      items: [cheese],
      locations,
      soonDays: 7,
    });
    expect(snapshot.transfer.length).toBeGreaterThan(0);
    expect(snapshot.transfer[0].key).toBe("ingredient:Cheese:batches");
    expect(snapshot.transfer[0].transferable).toBeGreaterThan(0);
    expect(snapshot.transfer[0].sources[0].locationName).toBe("Warehouse");
  });

  it("prioritizes expiring lots in the use-first list", () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const pepperoni = item({
      key: "ingredient:Pepperoni:lbs",
      onHand: 30,
      byLocation: [{ locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 30 }],
      lots: [
        { id: 1, locationId: 1, qtyRemaining: 15, expirationDate: later },
        { id: 2, locationId: 1, qtyRemaining: 15, expirationDate: soon },
      ],
    });
    const snapshot = computeWarehouseSnapshot({
      todayRunValues: [],
      scheduledRunValues: [],
      items: [pepperoni],
      locations,
      soonDays: 7,
    });
    expect(snapshot.useFirst.length).toBeGreaterThan(0);
    expect(snapshot.useFirst[0].expirationDate).toBe(soon);
  });
});

describe("buildStockByKey", () => {
  it("groups byLocation stock per item key", () => {
    const pepperoni = item({
      key: "ingredient:Pepperoni:lbs",
      byLocation: [
        { locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 10 },
        { locationId: 2, locationName: "Warehouse", isOnsite: false, onHand: 5 },
      ],
    });
    const stock = buildStockByKey([pepperoni]);
    expect(stock["ingredient:Pepperoni:lbs"]).toHaveLength(2);
    expect(stock["ingredient:Pepperoni:lbs"][0].isOnsite).toBe(true);
  });
});
