import { describe, it, expect } from "vitest";
import {
  applyRecipeSubstitutions,
  applySubstitutions,
  substitutionsForIngredient,
  computeRunConsumptionLines,
  computeSummaryStats,
  computeCheesePull,
  computeCheesePerPizzaOz,
  aggregateRunDemand,
  computeTransferNeeds,
  computeReorderList,
  computeUseFirstList,
  type IngredientSubstitution,
  type LocationStock,
  type RecipeRow,
  type ReorderInput,
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

// A named bought/ready-made sauce (frontlineRecipeName set, no recipe rows) is
// consumed as-is by name in LBS; a mixed sauce recipe keeps generic "Sauce"
// batches even when a name is set.
describe("ready-made sauce consumption", () => {
  it("named sauce with no recipe rows consumes by name in lbs", () => {
    const vals = baseVals({
      frontlineRecipeName: "BBQ Sauce",
      sauceOzPerPizza: 4,
      sauceBarrelLbs: 100,
    });
    const lines = computeRunConsumptionLines(vals as unknown as RunLinesInput, PEP);
    const keys = lines.map((l) => l.itemKey);
    expect(keys).toContain("ingredient:BBQ Sauce:lbs");
    expect(keys).not.toContain("ingredient:Sauce:batches");
    // qty = sauceLbs = ((10 + 1 case/layer) pizzas * 4 oz) / 16 + 30 buffer
    const bbq = lines.find((l) => l.itemKey === "ingredient:BBQ Sauce:lbs");
    expect(bbq?.qty).toBeCloseTo((11 * 4) / 16 + 30, 5);
  });

  it("a mixed sauce recipe keeps generic Sauce batches even when named", () => {
    const vals = baseVals({
      frontlineRecipeName: "House Red",
      frontlineRecipe: [{ ingredient: "Tomato Paste", lbs: 50 }],
      sauceOzPerPizza: 4,
    });
    const keys = computeRunConsumptionLines(vals as unknown as RunLinesInput, PEP).map(
      (l) => l.itemKey,
    );
    expect(keys).toContain("ingredient:Sauce:batches");
    expect(keys.some((k) => k.includes("House Red"))).toBe(false);
  });

  it("named sauce with zero oz/pizza consumes nothing (no +30 phantom)", () => {
    const vals = baseVals({
      frontlineRecipeName: "Ranch",
      sauceOzPerPizza: 0,
      sauceBarrelLbs: 0,
    });
    const keys = computeRunConsumptionLines(vals as unknown as RunLinesInput, PEP).map(
      (l) => l.itemKey,
    );
    expect(keys.some((k) => k.includes("Ranch") || k.includes("Sauce"))).toBe(false);
  });

  it("unnamed empty-recipe sauce keeps legacy Sauce batches via barrel lbs", () => {
    const vals = baseVals({
      sauceOzPerPizza: 4,
      sauceBarrelLbs: 100,
    });
    const keys = computeRunConsumptionLines(vals as unknown as RunLinesInput, PEP).map(
      (l) => l.itemKey,
    );
    expect(keys).toContain("ingredient:Sauce:batches");
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

describe("aggregateRunDemand", () => {
  it("sums consumption quantities by item key across runs", () => {
    // Two runs both consuming packaging circles + shippers; demand must add up.
    const runA = baseVals({
      casesNeeded: 10,
      pizzasPerCase: 1,
      cartoned: "yes",
      circles: "12in",
      shipper: "Std",
      cartonsPerCase: 0,
    }) as unknown as RunLinesInput;
    const runB = baseVals({
      casesNeeded: 5,
      pizzasPerCase: 1,
      cartoned: "yes",
      circles: "12in",
      shipper: "Std",
      cartonsPerCase: 0,
    }) as unknown as RunLinesInput;
    const demand = aggregateRunDemand([runA, runB], PEP);
    const circles = demand.find((d) => d.key === "packaging:circles:12in");
    const shippers = demand.find((d) => d.key === "packaging:shippers:Std");
    expect(circles?.qty).toBe(15); // 10 + 5 pizzas
    expect(shippers?.qty).toBe(15); // 10 + 5 cases
  });

  it("returns an empty list for no runs", () => {
    expect(aggregateRunDemand([], PEP)).toEqual([]);
  });
});

describe("computeTransferNeeds", () => {
  const loc = (over: Partial<LocationStock>): LocationStock => ({
    locationId: over.locationId ?? 1,
    locationName: over.locationName ?? "Loc",
    isOnsite: over.isOnsite ?? false,
    onHand: over.onHand ?? 0,
  });

  it("flags an item whose onsite stock is short while another location holds stock", () => {
    const needs = computeTransferNeeds({
      demands: [{ key: "ingredient:Mozzarella:lbs", name: "Mozzarella", unit: "lbs", category: "ingredient", qty: 100 }],
      stockByKey: {
        "ingredient:Mozzarella:lbs": [
          loc({ locationId: 1, locationName: "Onsite", isOnsite: true, onHand: 40 }),
          loc({ locationId: 2, locationName: "Cold Storage", onHand: 80 }),
        ],
      },
    });
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({
      key: "ingredient:Mozzarella:lbs",
      needed: 100,
      onsite: 40,
      shortfall: 60,
      offsiteAvailable: 80,
      transferable: 60, // capped at the shortfall, not the 80 available
    });
    expect(needs[0].sources).toEqual([{ locationId: 2, locationName: "Cold Storage", onHand: 80 }]);
  });

  it("caps transferable at the offsite available when it is the binding constraint", () => {
    const needs = computeTransferNeeds({
      demands: [{ key: "k", name: "n", unit: "lbs", category: "ingredient", qty: 100 }],
      stockByKey: { k: [loc({ isOnsite: true, onHand: 10 }), loc({ locationId: 2, onHand: 25 })] },
    });
    expect(needs[0].transferable).toBe(25); // shortfall 90 > 25 offsite
  });

  it("does not flag when onsite already covers demand", () => {
    const needs = computeTransferNeeds({
      demands: [{ key: "k", name: "n", unit: "lbs", category: "ingredient", qty: 30 }],
      stockByKey: { k: [loc({ isOnsite: true, onHand: 50 }), loc({ locationId: 2, onHand: 100 })] },
    });
    expect(needs).toEqual([]);
  });

  it("does not flag a shortfall when no other location holds stock", () => {
    const needs = computeTransferNeeds({
      demands: [{ key: "k", name: "n", unit: "lbs", category: "ingredient", qty: 30 }],
      stockByKey: { k: [loc({ isOnsite: true, onHand: 5 })] },
    });
    expect(needs).toEqual([]);
  });

  it("treats a missing item as zero onsite (no offsite means no warning)", () => {
    expect(
      computeTransferNeeds({
        demands: [{ key: "missing", name: "n", unit: "lbs", category: "ingredient", qty: 10 }],
        stockByKey: {},
      }),
    ).toEqual([]);
  });

  it("sorts offsite sources largest-first", () => {
    const needs = computeTransferNeeds({
      demands: [{ key: "k", name: "n", unit: "lbs", category: "ingredient", qty: 100 }],
      stockByKey: {
        k: [
          loc({ isOnsite: true, onHand: 0 }),
          loc({ locationId: 2, locationName: "Small", onHand: 5 }),
          loc({ locationId: 3, locationName: "Big", onHand: 50 }),
        ],
      },
    });
    expect(needs[0].sources.map((s) => s.locationName)).toEqual(["Big", "Small"]);
  });
});

describe("computeReorderList", () => {
  const item = (over: Partial<ReorderInput>): ReorderInput => ({
    key: over.key ?? "ingredient:Mozzarella:lbs",
    name: over.name ?? "Mozzarella",
    unit: over.unit ?? "lbs",
    category: over.category ?? "ingredient",
    onHand: over.onHand ?? 0,
    reorderThreshold: over.reorderThreshold ?? 0,
  });

  it("flags an item at or below its threshold and suggests restoring to threshold", () => {
    const list = computeReorderList([
      item({ key: "k", name: "Cheese", onHand: 4, reorderThreshold: 10 }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      key: "k",
      onHand: 4,
      reorderThreshold: 10,
      demand: 0,
      projectedOnHand: 4,
      suggestedQty: 6, // 10 - 4
    });
  });

  it("flags an item exactly at threshold (dropped 'to or below') with a min suggestion of 1", () => {
    const list = computeReorderList([
      item({ key: "k", onHand: 10, reorderThreshold: 10 }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].suggestedQty).toBe(1);
  });

  it("does not flag an item comfortably above threshold", () => {
    expect(
      computeReorderList([item({ onHand: 50, reorderThreshold: 10 })]),
    ).toEqual([]);
  });

  it("never flags an item with a zero threshold (untracked)", () => {
    expect(
      computeReorderList([item({ onHand: 0, reorderThreshold: 0 })]),
    ).toEqual([]);
  });

  it("with no demand reduces to onHand <= reorderThreshold (matches the LOW badge)", () => {
    const items = [
      item({ key: "low", onHand: 5, reorderThreshold: 5 }), // == threshold → flagged
      item({ key: "ok", onHand: 6, reorderThreshold: 5 }), // above → not flagged
      item({ key: "off", onHand: 0, reorderThreshold: 0 }), // untracked
    ];
    expect(computeReorderList(items).map((r) => r.key)).toEqual(["low"]);
  });

  it("subtracts upcoming scheduled-run demand so an item fine today still surfaces", () => {
    // 20 on hand, threshold 8 → fine today, but 15 will be consumed by scheduled
    // runs, leaving a projected 5 (< 8) → flagged, suggest enough to cover demand
    // and restore to the threshold: 8 - (20 - 15) = 3.
    const list = computeReorderList(
      [item({ key: "k", onHand: 20, reorderThreshold: 8 })],
      { k: 15 },
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      demand: 15,
      projectedOnHand: 5,
      suggestedQty: 3,
    });
  });

  it("does not double-flag when demand keeps projected on-hand above threshold", () => {
    expect(
      computeReorderList(
        [item({ key: "k", onHand: 20, reorderThreshold: 8 })],
        { k: 5 }, // projected 15 > 8
      ),
    ).toEqual([]);
  });

  it("rounds the suggested quantity up to a whole unit", () => {
    const list = computeReorderList(
      [item({ key: "k", onHand: 2, reorderThreshold: 10 })],
      { k: 0.5 }, // projected 1.5, deficit 8.5 → ceil 9
    );
    expect(list[0].suggestedQty).toBe(9);
  });

  it("sorts most-urgent first (largest shortfall below threshold), then by name", () => {
    const list = computeReorderList([
      item({ key: "a", name: "Apples", onHand: 9, reorderThreshold: 10 }), // short 1
      item({ key: "b", name: "Bananas", onHand: 1, reorderThreshold: 10 }), // short 9
      item({ key: "c", name: "Cherries", onHand: 5, reorderThreshold: 10 }), // short 5
    ]);
    expect(list.map((r) => r.name)).toEqual(["Bananas", "Cherries", "Apples"]);
  });
});

describe("computeUseFirstList", () => {
  // Fixed "today" so the date arithmetic is deterministic regardless of when the
  // suite runs.
  const TODAY = new Date(2026, 5, 24); // 2026-06-24 (local)

  // Build an ISO date string `offset` whole days from TODAY.
  function dayOffset(offset: number): string {
    const d = new Date(2026, 5, 24 + offset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function uItem(over: {
    key: string;
    name?: string;
    unit?: string;
    lots: { qtyRemaining: number; expirationDate: string | null; locationId?: number | null }[];
  }) {
    return {
      key: over.key,
      name: over.name ?? over.key,
      unit: over.unit ?? "lbs",
      category: "ingredient" as const,
      lots: over.lots.map((l) => ({
        qtyRemaining: l.qtyRemaining,
        expirationDate: l.expirationDate,
        locationId: l.locationId ?? null,
      })),
    };
  }

  const LOCATIONS = [
    { id: 1, name: "Onsite (Line)", isOnsite: true },
    { id: 2, name: "Cold Storage", isOnsite: false },
  ];

  it("includes lots within the window plus already-expired, skips fresh and no-date", () => {
    const list = computeUseFirstList({
      items: [
        uItem({ key: "soon", lots: [{ qtyRemaining: 5, expirationDate: dayOffset(3) }] }),
        uItem({ key: "edge", lots: [{ qtyRemaining: 5, expirationDate: dayOffset(7) }] }),
        uItem({ key: "fresh", lots: [{ qtyRemaining: 5, expirationDate: dayOffset(30) }] }),
        uItem({ key: "expired", lots: [{ qtyRemaining: 5, expirationDate: dayOffset(-2) }] }),
        uItem({ key: "nodate", lots: [{ qtyRemaining: 5, expirationDate: null }] }),
      ],
      locations: LOCATIONS,
      soonDays: 7,
      today: TODAY,
    });
    expect(list.map((e) => e.key).sort()).toEqual(["edge", "expired", "soon"]);
  });

  it("skips lots with no stock remaining", () => {
    const list = computeUseFirstList({
      items: [uItem({ key: "empty", lots: [{ qtyRemaining: 0, expirationDate: dayOffset(1) }] })],
      locations: LOCATIONS,
      soonDays: 7,
      today: TODAY,
    });
    expect(list).toEqual([]);
  });

  it("orders first-expired-first-out (most overdue first, then soonest)", () => {
    const list = computeUseFirstList({
      items: [
        uItem({ key: "a", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(5) }] }),
        uItem({ key: "b", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(-3) }] }),
        uItem({ key: "c", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(0) }] }),
        uItem({ key: "d", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(2) }] }),
      ],
      locations: LOCATIONS,
      soonDays: 7,
      today: TODAY,
    });
    expect(list.map((e) => e.key)).toEqual(["b", "c", "d", "a"]);
  });

  it("prioritizes lots used by today's runs above the rest, FEFO within each group", () => {
    const list = computeUseFirstList({
      items: [
        uItem({ key: "today-late", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(6) }] }),
        uItem({ key: "other-soon", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(1) }] }),
        uItem({ key: "today-soon", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(2) }] }),
      ],
      locations: LOCATIONS,
      soonDays: 7,
      today: TODAY,
      todayItemKeys: ["today-late", "today-soon"],
    });
    // Today's items first (FEFO between them), then the rest.
    expect(list.map((e) => e.key)).toEqual(["today-soon", "today-late", "other-soon"]);
    expect(list.map((e) => e.usedToday)).toEqual([true, true, false]);
  });

  it("resolves location names; null locationId falls back to onsite", () => {
    const list = computeUseFirstList({
      items: [
        uItem({ key: "onsite", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(1), locationId: null }] }),
        uItem({ key: "cold", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(1), locationId: 2 }] }),
      ],
      locations: LOCATIONS,
      soonDays: 7,
      today: TODAY,
    });
    const byKey = Object.fromEntries(list.map((e) => [e.key, e.locationName]));
    expect(byKey).toEqual({ onsite: "Onsite (Line)", cold: "Cold Storage" });
  });

  it("flags days-until and expired correctly per lot", () => {
    const list = computeUseFirstList({
      items: [
        uItem({ key: "past", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(-4) }] }),
        uItem({ key: "future", lots: [{ qtyRemaining: 1, expirationDate: dayOffset(3) }] }),
      ],
      locations: LOCATIONS,
      soonDays: 7,
      today: TODAY,
    });
    const byKey = Object.fromEntries(list.map((e) => [e.key, e]));
    expect(byKey.past.daysUntilExpiry).toBe(-4);
    expect(byKey.past.expired).toBe(true);
    expect(byKey.future.daysUntilExpiry).toBe(3);
    expect(byKey.future.expired).toBe(false);
  });

  it("expands each item's lots into separate entries", () => {
    const list = computeUseFirstList({
      items: [
        uItem({
          key: "multi",
          lots: [
            { qtyRemaining: 2, expirationDate: dayOffset(1), locationId: null },
            { qtyRemaining: 3, expirationDate: dayOffset(4), locationId: 2 },
          ],
        }),
      ],
      locations: LOCATIONS,
      soonDays: 7,
      today: TODAY,
    });
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.qtyRemaining)).toEqual([2, 3]);
  });
});

describe("computeCheesePull", () => {
  it("returns no rows and zero total for an empty/undefined recipe", () => {
    expect(computeCheesePull(undefined, 5)).toEqual({ rows: [], totalLbs: 0 });
    expect(computeCheesePull([], 5)).toEqual({ rows: [], totalLbs: 0 });
  });

  it("scales each component by the batch count and sums the total", () => {
    const pull = computeCheesePull(
      [
        { ingredient: "Mozzarella", lbs: 30 },
        { ingredient: "Provolone", lbs: 10 },
      ],
      3,
    );
    expect(pull.rows).toEqual([
      { ingredient: "Mozzarella", lbs: 90 },
      { ingredient: "Provolone", lbs: 30 },
    ]);
    expect(pull.totalLbs).toBe(120);
  });

  it("assumes at least one batch when batches is 0 or negative", () => {
    const base = [{ ingredient: "Mozzarella", lbs: 25 }];
    expect(computeCheesePull(base, 0)).toEqual({
      rows: [{ ingredient: "Mozzarella", lbs: 25 }],
      totalLbs: 25,
    });
    expect(computeCheesePull(base, -4)).toEqual({
      rows: [{ ingredient: "Mozzarella", lbs: 25 }],
      totalLbs: 25,
    });
  });

  it("assumes at least one batch when batches is NaN/Infinity", () => {
    const base = [{ ingredient: "Mozzarella", lbs: 12 }];
    expect(computeCheesePull(base, NaN).totalLbs).toBe(12);
    expect(computeCheesePull(base, Infinity).totalLbs).toBe(12);
  });

  it("supports fractional batch counts", () => {
    const pull = computeCheesePull([{ ingredient: "Mozzarella", lbs: 40 }], 2.5);
    expect(pull.rows[0].lbs).toBe(100);
    expect(pull.totalLbs).toBe(100);
  });

  it("keeps blank rows index-aligned and coerces missing lbs to 0", () => {
    const pull = computeCheesePull(
      [
        { ingredient: "Mozzarella", lbs: 20 },
        { ingredient: "", lbs: 0 },
        { ingredient: "Cheddar" } as unknown as { ingredient: string; lbs: number },
      ],
      2,
    );
    expect(pull.rows).toEqual([
      { ingredient: "Mozzarella", lbs: 40 },
      { ingredient: "", lbs: 0 },
      { ingredient: "Cheddar", lbs: 0 },
    ]);
    expect(pull.totalLbs).toBe(40);
  });
});

describe("computeCheesePerPizzaOz", () => {
  it("returns no rows and zero total for an empty/undefined recipe", () => {
    expect(computeCheesePerPizzaOz(undefined, 2.9)).toEqual({ rows: [], totalOz: 0 });
    expect(computeCheesePerPizzaOz([], 2.9)).toEqual({ rows: [], totalOz: 0 });
  });

  it("splits the applicator oz/pizza across components by their batch share", () => {
    const res = computeCheesePerPizzaOz(
      [
        { ingredient: "Whole Mozzarella", lbs: 40 },
        { ingredient: "Provolone", lbs: 10 },
      ],
      3,
    );
    // 40/50 and 10/50 of 3 oz.
    expect(res.rows[0]).toBeCloseTo(2.4, 10);
    expect(res.rows[1]).toBeCloseTo(0.6, 10);
    expect(res.totalOz).toBeCloseTo(3, 10);
  });

  it("total always equals ozPerPizza when the batch has weight", () => {
    const res = computeCheesePerPizzaOz(
      [
        { ingredient: "A", lbs: 33 },
        { ingredient: "B", lbs: 17 },
        { ingredient: "C", lbs: 7 },
      ],
      2.9,
    );
    expect(res.totalOz).toBeCloseTo(2.9, 10);
  });

  it("yields all-zero rows when the batch has no weight", () => {
    const res = computeCheesePerPizzaOz(
      [
        { ingredient: "A", lbs: 0 },
        { ingredient: "B", lbs: 0 },
      ],
      2.9,
    );
    expect(res.rows).toEqual([0, 0]);
    expect(res.totalOz).toBe(0);
  });

  it("coerces a missing/negative/NaN oz to 0 and stays index-aligned", () => {
    expect(computeCheesePerPizzaOz([{ ingredient: "A", lbs: 10 }], -5).rows).toEqual([0]);
    expect(computeCheesePerPizzaOz([{ ingredient: "A", lbs: 10 }], NaN).rows).toEqual([0]);
    const res = computeCheesePerPizzaOz(
      [
        { ingredient: "A", lbs: 10 },
        { ingredient: "" } as unknown as { ingredient: string; lbs: number },
      ],
      4,
    );
    expect(res.rows.length).toBe(2);
  });
});
