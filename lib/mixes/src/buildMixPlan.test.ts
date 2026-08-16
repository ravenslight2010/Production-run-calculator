/**
 * buildMixPlan — pound-total math verification
 *
 * Confirms that the math path from applyMixPerPizza (spec-import perPizza
 * backfill) through buildMixPlan (lbs = perPizza-oz × pizzas ÷ 16) produces
 * correct pound totals. Task #634.
 *
 * Also covers the prep-mix ingredientOzPerPizza lookup path so a silent
 * fallback (wrong key casing, missing profile data) produces detectable
 * wrong lbs rather than silently passing. Task #662.
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
    expect(entry.totalLbs).toBeCloseTo(expectedLbs * 1.15 + 20, 8); // +15% waste + 20 lb startup
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
    expect(entry.totalLbs).toBeCloseTo((mozzLbs + cheddLbs) * 1.15 + 20, 8); // +15% waste + 20 lb startup
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

    // buildMixPlan with perPizza=0 → component lbs=0, but the 20 lb startup buffer
    // still applies, so totalLbs=20 even before oz/pizza is filled in.
    const before = buildMixPlan({ mixes, runs: [run(TODAY, pizzas)], today: TODAY });
    const entryBefore = before[0]?.runs[0]?.mixes[0];
    expect(entryBefore?.totalLbs ?? 0).toBe(20); // startup buffer only

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
    expect(entryAfter.totalLbs).toBeCloseTo(expectedLbs * 1.15 + 20, 8); // +15% waste + 20 lb startup
    expect(entryAfter.components[0].lbs).toBeCloseTo(expectedLbs, 8);
  });

  it("remainingLbs subtracts amountAlreadyMade; batches = remainingLbs ÷ batchSize", () => {
    const pizzas = 160;
    const perPizzaOz = 2.0;
    const batchSize = 15; // lbs per batch
    const alreadyMade = 5; // lbs on hand

    const componentLbs = (perPizzaOz * pizzas) / OZ_PER_LB; // 20 lbs
    const totalLbs = componentLbs * 1.15 + 20; // +15% waste + 20 lb startup → 43 lbs
    const expectedRemaining = totalLbs - alreadyMade; // 38 lbs
    const expectedBatches = expectedRemaining / batchSize; // 38/15

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
    const componentLbs = (perPizzaOz * pizzas) / OZ_PER_LB; // 50 lbs
    const expectedLbs = componentLbs * 1.15 + 20; // +15% waste + 20 lb startup → 77.5 lbs

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

    // lbs = component lbs + 15% waste + 20 lb startup
    expect(entry.totalLbs).toBeCloseTo(expectedLbs, 8);
    // batch count = remainingLbs / batchSize = 77.5 / 25 = 3.1
    expect(entry.batches).toBeCloseTo(expectedLbs / 25, 8);
    // batchSize is echoed through
    expect(entry.batchSize).toBe(25);
  });

  it("after applyMixPerPizza fills perPizza, batchSize from premix still yields correct batch count", () => {
    const pizzas = 240;
    const perPizzaOz = 4.0;
    const batchSize = 30; // 30 lbs per batch (premix-origin)
    const componentLbs = (perPizzaOz * pizzas) / OZ_PER_LB; // 60 lbs
    const expectedLbs = componentLbs * 1.15 + 20; // +15% waste + 20 lb startup → 89 lbs
    const expectedBatches = expectedLbs / batchSize; // 89/30 batches

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
    expect(entry.totalLbs).toBeCloseTo(expectedLbs, 8); // component lbs + 15% waste + 20 lb startup
    expect(entry.batches).toBeCloseTo(expectedBatches, 8);
  });
});

// ── Prep mixes: ingredientOzPerPizza lookup ────────────────────────────────
//
// These tests guard the computeEntryFromComponentLbs path used for prep mixes.
// A prep mix collects lbs from every matching run's *profile* oz/pizza value
// (ingredientOzPerPizza) rather than the mix card's generic perPizza. If the
// lookup silently falls back (wrong key casing, missing entry) the plan shows
// wrong amounts with no visible error — these tests make that detectable.

function prepRun(
  date: string,
  pizzas: number,
  ingredients: string[],
  ingredientOzPerPizza: Record<string, number>,
  brand = "Aldo's",
  flavor = "",
): MixScheduledRun {
  return { date, brand, flavor, pizzas, cases: 0, ingredients, ingredientOzPerPizza };
}

function makePrepMix(overrides: Partial<Mix> & { name: string }): Mix {
  return normalizeMix({
    id: overrides.id ?? overrides.name.toLowerCase().replace(/\s+/g, "-"),
    name: overrides.name,
    brand: overrides.brand ?? "",
    flavor: overrides.flavor ?? "",
    batchSize: overrides.batchSize ?? 0,
    daysEarly: overrides.daysEarly ?? 0,
    amountAlreadyMade: overrides.amountAlreadyMade ?? 0,
    components: overrides.components ?? [],
    enabled: overrides.enabled !== false,
    isPrep: true,
  })!;
}

describe("buildMixPlan — prep mixes: ingredientOzPerPizza lookup", () => {
  it("two brands with different oz/pizza weights sum lbs from each run's profile value", () => {
    // Brand A uses 2.0 oz/pizza of "Garlic Mix"; Brand B uses 3.0 oz/pizza.
    // The mix card has a generic perPizza of 1.0 — it must NOT be used.
    const ingredientName = "Garlic Mix";
    const pizzasA = 100;
    const pizzasB = 80;
    const ozA = 2.0;
    const ozB = 3.0;

    const mixes = [
      makePrepMix({
        name: "Garlic Prep Mix",
        components: [{ ingredient: ingredientName, perPizza: 1.0 }], // generic fallback, should be ignored
      }),
    ];

    const runA = prepRun(TODAY, pizzasA, [ingredientName], { [ingredientName]: ozA }, "BrandA");
    const runB = prepRun(TODAY, pizzasB, [ingredientName], { [ingredientName]: ozB }, "BrandB");

    const [group] = buildMixPlan({ mixes, runs: [runA, runB], today: TODAY });
    expect(group).toBeDefined();
    expect(group.prepMixes).toHaveLength(1);

    const entry = group.prepMixes[0];
    const expectedLbs = (ozA * pizzasA) / OZ_PER_LB + (ozB * pizzasB) / OZ_PER_LB;
    // component lbs from each run's profile, not the generic 1.0 oz/pizza
    expect(entry.components[0].lbs).toBeCloseTo(expectedLbs, 8);
    // totalLbs = component lbs × 1.15 + 20 startup
    expect(entry.totalLbs).toBeCloseTo(expectedLbs * 1.15 + 20, 8);
  });

  it("a run with no ingredientOzPerPizza entry for the component falls back to mix card perPizza", () => {
    const ingredientName = "Herb Blend";
    const pizzas = 120;
    const fallbackOz = 2.5; // mix card generic value

    const mixes = [
      makePrepMix({
        name: "Herb Prep Mix",
        components: [{ ingredient: ingredientName, perPizza: fallbackOz }],
      }),
    ];

    // Run lists the ingredient but provides no ingredientOzPerPizza map.
    const r: MixScheduledRun = {
      date: TODAY,
      brand: "SomeBrand",
      flavor: "",
      pizzas,
      cases: 0,
      ingredients: [ingredientName],
      // ingredientOzPerPizza intentionally absent
    };

    const [group] = buildMixPlan({ mixes, runs: [r], today: TODAY });
    expect(group).toBeDefined();
    expect(group.prepMixes).toHaveLength(1);

    const entry = group.prepMixes[0];
    const expectedLbs = (fallbackOz * pizzas) / OZ_PER_LB;
    expect(entry.components[0].lbs).toBeCloseTo(expectedLbs, 8);
    expect(entry.missingAmounts).toBe(false);
  });

  it("ingredient key lookup is case-insensitive when the profile key differs in case", () => {
    // Mix component is "Garlic Salt"; profile stores it as "garlic salt" (all lowercase).
    const mixIngredient = "Garlic Salt";
    const profileKey = "garlic salt";
    const profileOz = 1.8;
    const pizzas = 200;

    const mixes = [
      makePrepMix({
        name: "Seasoning Prep Mix",
        components: [{ ingredient: mixIngredient, perPizza: 0.5 }], // fallback if CI lookup fails
      }),
    ];

    const r = prepRun(
      TODAY,
      pizzas,
      [mixIngredient],
      { [profileKey]: profileOz }, // key is lowercase, component is title-case
    );

    const [group] = buildMixPlan({ mixes, runs: [r], today: TODAY });
    expect(group).toBeDefined();
    expect(group.prepMixes).toHaveLength(1);

    const entry = group.prepMixes[0];
    const expectedLbs = (profileOz * pizzas) / OZ_PER_LB;
    // Must use the profile value (1.8 oz), not the fallback (0.5 oz)
    expect(entry.components[0].lbs).toBeCloseTo(expectedLbs, 8);
  });

  it("prep mix appears on a date only because one of several runs uses the ingredient", () => {
    // Run A uses the ingredient (Onion Mix); Run B does not.
    // The prep mix should appear and count only Run A's pizzas.
    const ingredientName = "Onion Mix";
    const pizzasA = 150;
    const pizzasB = 200;
    const oz = 2.0;

    const mixes = [
      makePrepMix({
        name: "Onion Prep Mix",
        components: [{ ingredient: ingredientName, perPizza: oz }],
      }),
    ];

    const runA = prepRun(TODAY, pizzasA, [ingredientName], { [ingredientName]: oz }, "BrandA");
    const runB = prepRun(TODAY, pizzasB, ["Bell Peppers"], { "Bell Peppers": 1.5 }, "BrandB");

    const [group] = buildMixPlan({ mixes, runs: [runA, runB], today: TODAY });
    expect(group).toBeDefined();
    expect(group.prepMixes).toHaveLength(1);

    const entry = group.prepMixes[0];
    // Only Run A contributes — Run B has no matching ingredient
    const expectedLbs = (oz * pizzasA) / OZ_PER_LB;
    expect(entry.components[0].lbs).toBeCloseTo(expectedLbs, 8);
    // Run B's pizzas must NOT inflate the total
    const wrongLbs = (oz * (pizzasA + pizzasB)) / OZ_PER_LB;
    expect(entry.components[0].lbs).not.toBeCloseTo(wrongLbs, 1);
  });
});

// ── missingAmounts + missingComponentIngredients ───────────────────────────

describe("buildMixPlan — prep-mix missingAmounts and missingComponentIngredients", () => {
  function makePrepMix(overrides: Partial<Mix> & { name: string }): Mix {
    return normalizeMix({
      id: overrides.id ?? overrides.name.toLowerCase().replace(/\s+/g, "-"),
      name: overrides.name,
      brand: overrides.brand ?? "",
      flavor: overrides.flavor ?? "",
      batchSize: overrides.batchSize ?? 0,
      daysEarly: overrides.daysEarly ?? 0,
      amountAlreadyMade: overrides.amountAlreadyMade ?? 0,
      components: overrides.components ?? [],
      enabled: true,
      isPrep: true,
    })!;
  }

  function prepRun(
    date: string,
    pizzas: number,
    ingredients: string[],
    ozMap?: Record<string, number>,
    brand = "BrandX",
  ): MixScheduledRun {
    const r: MixScheduledRun = { date, brand, flavor: "", pizzas, cases: 0, ingredients };
    if (ozMap) r.ingredientOzPerPizza = ozMap;
    return r;
  }

  it("missingAmounts=true and missingComponentIngredients lists ALL components when no run matches any ingredient (name mismatch)", () => {
    const mixes = [
      makePrepMix({
        name: "Veggie Prep",
        components: [
          { ingredient: "Bell Peppers", perPizza: 1.5 },
          { ingredient: "Onions", perPizza: 1.0 },
        ],
      }),
    ];
    // Run profile uses different names — no ingredient matches
    const r = prepRun(TODAY, 200, ["Green Peppers", "Yellow Onions"], {
      "Green Peppers": 1.5,
      "Yellow Onions": 1.0,
    });

    const plan = buildMixPlan({ mixes, runs: [r], today: TODAY });
    // Prep mix must still appear (not silently skipped)
    expect(plan).toHaveLength(1);
    expect(plan[0].prepMixes).toHaveLength(1);

    const entry = plan[0].prepMixes[0];
    expect(entry.missingAmounts).toBe(true);
    expect(entry.missingComponentIngredients).toEqual(["Bell Peppers", "Onions"]);
    // Pull quantities are 0; totalLbs is startup-only (20 lbs)
    expect(entry.components[0].lbs).toBe(0);
    expect(entry.components[1].lbs).toBe(0);
    expect(entry.totalLbs).toBeCloseTo(20, 8); // startup buffer only
  });

  it("missingAmounts=true and missingComponentIngredients lists only the unmatched component when match is partial", () => {
    const mixes = [
      makePrepMix({
        name: "Partial Prep",
        components: [
          { ingredient: "Pepperoni", perPizza: 2.0 },
          { ingredient: "Jalapenos", perPizza: 1.0 }, // name mismatch in run profile
        ],
      }),
    ];
    // Run profile has Pepperoni (matches) but calls the other ingredient "Jalapeños" (won't match)
    const r = prepRun(
      TODAY,
      100,
      ["Pepperoni", "Jalapeños"],
      { Pepperoni: 2.0, "Jalapeños": 1.0 },
    );

    const plan = buildMixPlan({ mixes, runs: [r], today: TODAY });
    expect(plan).toHaveLength(1);
    const entry = plan[0].prepMixes[0];

    expect(entry.missingAmounts).toBe(true);
    expect(entry.missingComponentIngredients).toEqual(["Jalapenos"]);
    // Pepperoni lbs are populated; Jalapenos lbs are 0
    const expectedPepLbs = (2.0 * 100) / OZ_PER_LB;
    expect(entry.components[0].lbs).toBeCloseTo(expectedPepLbs, 8);
    expect(entry.components[1].lbs).toBe(0);
  });

  it("missingAmounts=false and missingComponentIngredients absent when all components are matched", () => {
    const mixes = [
      makePrepMix({
        name: "Full Match Prep",
        components: [
          { ingredient: "Mushrooms", perPizza: 1.5 },
          { ingredient: "Olives", perPizza: 0.5 },
        ],
      }),
    ];
    const r = prepRun(TODAY, 120, ["Mushrooms", "Olives"], { Mushrooms: 1.5, Olives: 0.5 });

    const [group] = buildMixPlan({ mixes, runs: [r], today: TODAY });
    const entry = group.prepMixes[0];

    expect(entry.missingAmounts).toBe(false);
    expect(entry.missingComponentIngredients).toBeUndefined();
  });
});
