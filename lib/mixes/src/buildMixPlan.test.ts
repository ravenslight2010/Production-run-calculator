/**
 * buildMixPlan — pound-total math verification
 *
 * Confirms that the math path from applyMixPerPizza (spec-import perPizza
 * backfill) through buildMixPlan (lbs = perPizza-oz × pizzas ÷ 16) produces
 * correct pound totals. Task #634.
 */
import { describe, it, expect } from "vitest";
import {
  applyMixPerPizza,
  buildMixPlan,
  normalizeMix,
  OZ_PER_LB,
  type Mix,
  type MixScheduledRun,
} from "./index";

function makeMix(overrides: Partial<Mix> & { name: string }): Mix {
  return normalizeMix({
    id: overrides.id ?? overrides.name.toLowerCase().replace(/\s+/g, "-"),
    name: overrides.name,
    brand: overrides.brand ?? "Aldo's",
    flavor: overrides.flavor ?? "",
    batchSize: overrides.batchSize ?? 0,
    daysEarly: overrides.daysEarly ?? 0,
    amountAlreadyMade: overrides.amountAlreadyMade ?? 0,
    components: overrides.components ?? [],
    enabled: overrides.enabled !== false,
    notes: overrides.notes,
  })!;
}

function run(
  date: string,
  pizzas: number,
  brand = "Aldo's",
  flavor = "",
): MixScheduledRun {
  return { date, brand, flavor, pizzas, cases: 0 };
}

const TODAY = "2026-08-15";

// ── Core math: oz/pizza × pizzas ÷ 16 ─────────────────────────────────────

describe("buildMixPlan — perPizza pound totals", () => {
  it("computes lbs = perPizza(oz) × pizzas ÷ 16 for a single component", () => {
    const perPizzaOz = 2.0;
    const pizzas = 160;
    const expectedLbs = (perPizzaOz * pizzas) / OZ_PER_LB; // 20 lbs

    const mixes = [
      makeMix({
        name: "Veggie Mix",
        components: [{ ingredient: "Bell Peppers", perPizza: perPizzaOz }],
      }),
    ];
    const runs = [run(TODAY, pizzas)];

    const [group] = buildMixPlan({ mixes, runs, today: TODAY });
    expect(group).toBeDefined();
    const entry = group.runs[0].mixes[0];
    expect(entry.totalLbs).toBeCloseTo(expectedLbs, 8);
    expect(entry.components[0].lbs).toBeCloseTo(expectedLbs, 8);
  });

  it("sums multiple components correctly", () => {
    const pizzas = 200;
    const mixes = [
      makeMix({
        name: "White Fajita Mix",
        components: [
          { ingredient: "Mozzarella", perPizza: 2.5 },
          { ingredient: "Cheddar", perPizza: 1.5 },
        ],
      }),
    ];
    const runs = [run(TODAY, pizzas)];

    const [group] = buildMixPlan({ mixes, runs, today: TODAY });
    const entry = group.runs[0].mixes[0];

    const mozzLbs = (2.5 * pizzas) / OZ_PER_LB;
    const cheddLbs = (1.5 * pizzas) / OZ_PER_LB;
    expect(entry.components[0].lbs).toBeCloseTo(mozzLbs, 8);
    expect(entry.components[1].lbs).toBeCloseTo(cheddLbs, 8);
    expect(entry.totalLbs).toBeCloseTo(mozzLbs + cheddLbs, 8);
  });
});

// ── End-to-end: applyMixPerPizza → buildMixPlan ───────────────────────────

describe("applyMixPerPizza → buildMixPlan — spec-import end-to-end", () => {
  it("a mix that had perPizza=0 (pre-#632) produces 0 lbs; after spec-import fill it produces real pounds", () => {
    const pizzas = 120;
    const perPizzaOz = 3.0;

    // Simulate the state BEFORE spec-import filled in perPizza
    const mixes: Mix[] = [
      makeMix({
        name: "Taco Mix",
        components: [{ ingredient: "Seasoned Beef", perPizza: 0 }],
      }),
    ];

    // buildMixPlan with perPizza=0 → 0 lbs (no plan returned)
    const before = buildMixPlan({ mixes, runs: [run(TODAY, pizzas)], today: TODAY });
    // Mix has a component but perPizza=0, so totalLbs=0. buildMixPlan still
    // returns an entry (it doesn't filter on lbs>0), but lbs will be 0.
    const entryBefore = before[0]?.runs[0]?.mixes[0];
    expect(entryBefore?.totalLbs ?? 0).toBe(0);

    // Now simulate spec-import filling in perPizza via applyMixPerPizza
    const updates = [
      {
        name: "Taco Mix",
        brand: "Aldo's",
        components: [{ ingredient: "Seasoned Beef", perPizza: perPizzaOz }],
      },
    ];
    const { next, updated } = applyMixPerPizza(mixes, updates);
    expect(updated).toBe(1);

    // buildMixPlan now produces the correct pound total
    const after = buildMixPlan({ mixes: next, runs: [run(TODAY, pizzas)], today: TODAY });
    expect(after).toHaveLength(1);
    const entryAfter = after[0].runs[0].mixes[0];
    const expectedLbs = (perPizzaOz * pizzas) / OZ_PER_LB;
    expect(entryAfter.totalLbs).toBeCloseTo(expectedLbs, 8);
    expect(entryAfter.components[0].lbs).toBeCloseTo(expectedLbs, 8);
  });

  it("remainingLbs subtracts amountAlreadyMade; batches = remainingLbs ÷ batchSize", () => {
    const pizzas = 160;
    const perPizzaOz = 2.0;
    const batchSize = 15; // lbs per batch
    const alreadyMade = 5; // lbs on hand

    const totalLbs = (perPizzaOz * pizzas) / OZ_PER_LB; // 20 lbs
    const expectedRemaining = totalLbs - alreadyMade; // 15 lbs
    const expectedBatches = expectedRemaining / batchSize; // 1.0

    const mixes = [
      makeMix({
        name: "Ranch Mix",
        batchSize,
        amountAlreadyMade: alreadyMade,
        components: [{ ingredient: "Ranch Seasoning", perPizza: perPizzaOz }],
      }),
    ];
    const [group] = buildMixPlan({ mixes, runs: [run(TODAY, pizzas)], today: TODAY });
    const entry = group.runs[0].mixes[0];
    expect(entry.totalLbs).toBeCloseTo(totalLbs, 8);
    expect(entry.remainingLbs).toBeCloseTo(expectedRemaining, 8);
    expect(entry.batches).toBeCloseTo(expectedBatches, 8);
  });
});

// ── Edge: spec-import perPizza + premix-sheet batchSize are consistent ─────

describe("buildMixPlan — spec perPizza + premix batchSize consistency", () => {
  it("premix batchSize controls batch count but does NOT change lbs (lbs scale from perPizza alone)", () => {
    const pizzas = 320;
    const perPizzaOz = 2.5;
    const expectedLbs = (perPizzaOz * pizzas) / OZ_PER_LB; // 50 lbs

    // Simulate a mix that received perPizza from a spec import AND batchSize
    // from a premix-sheet import (the premix importer sets perBatchLbs on
    // components + batchSize on the mix, but perPizza may have come earlier
    // from spec import). The two sources are independent: lbs must still be
    // perPizza × pizzas ÷ 16, regardless of batchSize.
    const mixes = [
      makeMix({
        name: "Spicy Mix",
        batchSize: 25, // 25 lbs per batch (from premix sheet)
        components: [
          // perPizza came from spec import; perBatchLbs came from premix sheet
          { ingredient: "Peppers", perPizza: perPizzaOz, perBatchLbs: 12.5 },
        ],
      }),
    ];
    const [group] = buildMixPlan({ mixes, runs: [run(TODAY, pizzas)], today: TODAY });
    const entry = group.runs[0].mixes[0];

    // lbs must derive solely from perPizza
    expect(entry.totalLbs).toBeCloseTo(expectedLbs, 8);
    // batch count = remainingLbs / batchSize = 50 / 25 = 2
    expect(entry.batches).toBeCloseTo(expectedLbs / 25, 8);
    // batchSize is echoed through
    expect(entry.batchSize).toBe(25);
  });

  it("after applyMixPerPizza fills perPizza, batchSize from premix still yields correct batch count", () => {
    const pizzas = 240;
    const perPizzaOz = 4.0;
    const batchSize = 30; // 30 lbs per batch (premix-origin)
    const expectedLbs = (perPizzaOz * pizzas) / OZ_PER_LB; // 60 lbs
    const expectedBatches = expectedLbs / batchSize; // 2 batches

    // Mix starts with perPizza=0 (pre-spec-import state), batchSize already set
    const existing = [
      makeMix({
        name: "Cheese Blend",
        batchSize,
        components: [
          { ingredient: "Mozzarella", perPizza: 0, perBatchLbs: 15 },
          { ingredient: "Provolone", perPizza: 0, perBatchLbs: 15 },
        ],
      }),
    ];

    // Spec import fills in perPizza (task #632)
    const { next } = applyMixPerPizza(existing, [
      {
        name: "Cheese Blend",
        brand: "Aldo's",
        components: [
          { ingredient: "Mozzarella", perPizza: 2.5 },
          { ingredient: "Provolone", perPizza: 1.5 },
        ],
      },
    ]);

    const [group] = buildMixPlan({ mixes: next, runs: [run(TODAY, pizzas)], today: TODAY });
    const entry = group.runs[0].mixes[0];

    const mozzLbs = (2.5 * pizzas) / OZ_PER_LB;
    const provLbs = (1.5 * pizzas) / OZ_PER_LB;
    expect(entry.components[0].lbs).toBeCloseTo(mozzLbs, 8);
    expect(entry.components[1].lbs).toBeCloseTo(provLbs, 8);
    expect(entry.totalLbs).toBeCloseTo(expectedLbs, 8);
    expect(entry.batches).toBeCloseTo(expectedBatches, 8);
  });
});
