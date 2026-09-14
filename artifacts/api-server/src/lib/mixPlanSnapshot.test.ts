import { describe, it, expect } from "vitest";
import type { Mix } from "@workspace/mixes";
import { computeMixPlanSnapshot, toMixScheduledRun } from "./mixPlanSnapshot";

// A realistic resolved run: 10 cases x 6 pizzas + 1 layer x 6 = 66 sauced
// pizzas; app1 "Cheese" at 8 oz/pizza with a 10 lb/batch Mozzarella recipe.
const cheeseRunValues = {
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
  pep1Type: "",
  pep1OzPerPizza: 0,
  pep1Sticks: 0,
  pep1BatchLbs: 0,
  pep2Type: "",
  pep2OzPerPizza: 0,
  pep2Sticks: 0,
  pep2BatchLbs: 0,
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  crustsPerCycle: 1,
  cycleSpeed: 10,
  speedAdjustment: 1,
};

function mix(over: Partial<Mix> & { id: string; name: string; brand: string; flavor: string }): Mix {
  return {
    scope: "live",
    batchSize: 50,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components: [{ ingredient: "Mozzarella", perPizza: 8 }],
    enabled: true,
    isPrep: false,
    ...over,
  };
}

const mozzarellaMix = mix({
  id: "mix-1",
  name: "Mozzarella Mix",
  brand: "Pizza Co",
  flavor: "Cheese",
});

describe("toMixScheduledRun", () => {
  it("computes pizzas/cases and per-ingredient oz from a resolved run", () => {
    const run = toMixScheduledRun({
      date: "2026-09-12",
      brand: "Pizza Co",
      flavor: "Cheese",
      values: cheeseRunValues,
    });
    expect(run.pizzas).toBe(66); // totalPizzasForSauce = 60 + 6 startup buffer
    expect(run.cases).toBe(10);
    expect(run.ingredients).toContain("Mozzarella");
    // The whole 8 oz/pizza maps to the single Mozzarella recipe row.
    expect(run.ingredientOzPerPizza["Mozzarella"]).toBeCloseTo(8, 5);
  });
});

describe("computeMixPlanSnapshot", () => {
  it("returns an empty plan for empty inputs", () => {
    const plan = computeMixPlanSnapshot({
      liveRuns: [],
      scheduledRuns: [],
      mixes: [],
      makeDay: "2026-09-12",
    });
    expect(plan).toEqual([]);
  });

  it("builds a make-day plan with batches and pull-for-mix math", () => {
    const plan = computeMixPlanSnapshot({
      liveRuns: [],
      scheduledRuns: [
        {
          date: "2026-09-12",
          brand: "Pizza Co",
          flavor: "Cheese",
          values: cheeseRunValues,
        },
      ],
      mixes: [mozzarellaMix],
      makeDay: "2026-09-12",
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].date).toBe("2026-09-12");
    expect(plan[0].daysUntil).toBe(0);
    expect(plan[0].runs).toHaveLength(1);
    const entry = plan[0].runs[0].mixes[0];
    expect(entry.name).toBe("Mozzarella Mix");
    // Component lbs = 8 oz/pizza × 66 pizzas / 16 = 33 lbs.
    expect(entry.components[0].lbs).toBeCloseTo(33, 5);
    // totalLbs = 33 lbs + 15% waste + 20 lb startup.
    expect(entry.totalLbs).toBeCloseTo(33 * 1.15 + 20, 5);
    // remainingLbs == totalLbs when nothing was already made.
    expect(entry.remainingLbs).toBeCloseTo(entry.totalLbs, 5);
    expect(entry.batches).toBeCloseTo(entry.remainingLbs / 50, 5);
  });

  it("subtracts amountAlreadyMade once and honors the make-ahead window", () => {
    const madeMix = mix({
      id: "mix-2",
      name: "Mozzarella Mix (made)",
      brand: "Pizza Co",
      flavor: "Cheese",
      amountAlreadyMade: 25,
      daysEarly: 3,
    });
    const plan = computeMixPlanSnapshot({
      liveRuns: [],
      scheduledRuns: [
        {
          date: "2026-09-15",
          brand: "Pizza Co",
          flavor: "Cheese",
          values: cheeseRunValues,
        },
      ],
      mixes: [madeMix],
      makeDay: "2026-09-12",
    });
    expect(plan).toHaveLength(1);
    const entry = plan[0].runs[0].mixes[0];
    expect(entry.amountAlreadyMade).toBe(25);
    expect(entry.remainingLbs).toBeCloseTo(Math.max(0, entry.totalLbs - 25), 5);
  });

  it("skips runs outside the mix's days-early window", () => {
    const todayOnlyMix = mix({
      id: "mix-3",
      name: "Same-Day Mix",
      brand: "Pizza Co",
      flavor: "Cheese",
      daysEarly: 0,
    });
    // Run 4 days out, mix is same-day -> excluded.
    const plan = computeMixPlanSnapshot({
      liveRuns: [],
      scheduledRuns: [
        {
          date: "2026-09-16",
          brand: "Pizza Co",
          flavor: "Cheese",
          values: cheeseRunValues,
        },
      ],
      mixes: [todayOnlyMix],
      makeDay: "2026-09-12",
    });
    expect(plan).toEqual([]);
  });
});
