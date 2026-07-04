import { describe, it, expect } from "vitest";
import {
  normalizeMix,
  normalizeMixComponent,
  normalizeMixes,
  daysUntil,
  buildMixPlan,
  DEFAULT_DAYS_EARLY,
  type Mix,
  type MixScheduledRun,
} from "@workspace/mixes";

// Tests live in the artifact (libs hold no tests). Exercise the pure mixes
// model that both web and mobile feed into.

describe("normalizeMixComponent", () => {
  it("trims the ingredient and clamps perPizza to >= 0", () => {
    expect(normalizeMixComponent({ ingredient: " Onions ", perPizza: 0.05 })).toEqual({
      ingredient: "Onions",
      perPizza: 0.05,
    });
    expect(normalizeMixComponent({ ingredient: "A", perPizza: -3 })?.perPizza).toBe(0);
    expect(normalizeMixComponent({ ingredient: "A", perPizza: "0.2" })?.perPizza).toBe(0.2);
  });

  it("drops components with a blank ingredient", () => {
    expect(normalizeMixComponent({ ingredient: "  " })).toBeNull();
    expect(normalizeMixComponent({})).toBeNull();
    expect(normalizeMixComponent(null)).toBeNull();
  });
});

describe("normalizeMix", () => {
  it("defaults daysEarly to 0, enabled to true, and numbers to clamped values", () => {
    const mix = normalizeMix({ name: "Veggie Mix", batchSize: 40 });
    expect(mix).toMatchObject({
      name: "Veggie Mix",
      daysEarly: DEFAULT_DAYS_EARLY,
      batchSize: 40,
      amountAlreadyMade: 0,
      enabled: true,
      components: [],
    });
    expect(mix?.id).toBeTruthy();
  });

  it("clamps negatives, truncates daysEarly, and respects enabled=false", () => {
    const mix = normalizeMix({
      name: "M",
      batchSize: -5,
      daysEarly: 2.9,
      amountAlreadyMade: -2,
      enabled: false,
    });
    expect(mix?.batchSize).toBe(0);
    expect(mix?.daysEarly).toBe(2);
    expect(mix?.amountAlreadyMade).toBe(0);
    expect(mix?.enabled).toBe(false);
  });

  it("drops malformed components and blank names", () => {
    expect(normalizeMix({ name: "  " })).toBeNull();
    const mix = normalizeMix({
      name: "M",
      components: [{ ingredient: "A", perPizza: 1 }, { ingredient: "" }, null],
    });
    expect(mix?.components).toEqual([{ ingredient: "A", perPizza: 1 }]);
  });
});

describe("normalizeMixes", () => {
  it("drops malformed entries and collapses duplicate ids onto the last", () => {
    const mixes = normalizeMixes([
      { id: "x", name: "First", batchSize: 1 },
      { id: "x", name: "Second", batchSize: 2 },
      { name: "" },
      null,
    ]);
    expect(mixes).toHaveLength(1);
    expect(mixes[0].name).toBe("Second");
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeMixes(undefined)).toEqual([]);
    expect(normalizeMixes({})).toEqual([]);
  });
});

describe("daysUntil", () => {
  it("counts whole calendar days regardless of timezone", () => {
    expect(daysUntil("2026-06-25", "2026-06-23")).toBe(2);
    expect(daysUntil("2026-06-23", "2026-06-23")).toBe(0);
    expect(daysUntil("2026-06-22", "2026-06-23")).toBe(-1);
  });
});

function mix(over: Partial<Mix> & { name: string }): Mix {
  return {
    id: over.id ?? over.name,
    name: over.name,
    brand: over.brand ?? "",
    flavor: over.flavor ?? "",
    batchSize: over.batchSize ?? 0,
    daysEarly: over.daysEarly ?? 0,
    amountAlreadyMade: over.amountAlreadyMade ?? 0,
    components: over.components ?? [],
    enabled: over.enabled ?? true,
    ...(over.notes ? { notes: over.notes } : {}),
  };
}

function run(date: string, brand: string, flavor: string, pizzas: number, cases = 0): MixScheduledRun {
  return { date, brand, flavor, pizzas, cases };
}

describe("buildMixPlan", () => {
  const today = "2026-06-23";

  it("scales components by pizzas (oz→lbs ÷16), sums total lbs, and computes batches", () => {
    const m = mix({
      name: "Veggie Mix",
      brand: "Acme",
      flavor: "Combo",
      batchSize: 40,
      // per-pizza values are ounces; 1000 pizzas → (oz × 1000) / 16 lbs.
      components: [
        { ingredient: "Onions", perPizza: 0.8 }, // 0.8 * 1000 / 16 = 50 lbs
        { ingredient: "Peppers", perPizza: 0.48 }, // 0.48 * 1000 / 16 = 30 lbs
      ],
    });
    const plan = buildMixPlan({
      runs: [run("2026-06-23", "Acme", "Combo", 1000, 100)],
      mixes: [m],
      today,
    });
    expect(plan).toHaveLength(1);
    const entry = plan[0].runs[0].mixes[0];
    expect(entry.components).toEqual([
      { ingredient: "Onions", lbs: 50 },
      { ingredient: "Peppers", lbs: 30 },
    ]);
    expect(entry.totalLbs).toBe(80);
    expect(entry.remainingLbs).toBe(80);
    expect(entry.batches).toBe(2);
    expect(plan[0].runs[0].pizzas).toBe(1000);
    expect(plan[0].runs[0].cases).toBe(100);
  });

  it("subtracts amountAlreadyMade from remaining lbs and batches", () => {
    const m = mix({
      name: "M",
      brand: "Acme",
      flavor: "Combo",
      batchSize: 40,
      amountAlreadyMade: 40,
      // 1.28 oz/pizza * 1000 / 16 = 80 lbs total.
      components: [{ ingredient: "Onions", perPizza: 1.28 }],
    });
    const entry = buildMixPlan({
      runs: [run("2026-06-23", "Acme", "Combo", 1000)],
      mixes: [m],
      today,
    })[0].runs[0].mixes[0];
    expect(entry.totalLbs).toBe(80);
    expect(entry.remainingLbs).toBe(40);
    expect(entry.batches).toBe(1);
  });

  it("reports zero batches when batchSize is 0", () => {
    const m = mix({
      name: "M",
      brand: "Acme",
      flavor: "Combo",
      batchSize: 0,
      // 0.8 oz/pizza * 100 / 16 = 5 lbs total.
      components: [{ ingredient: "Onions", perPizza: 0.8 }],
    });
    const entry = buildMixPlan({
      runs: [run("2026-06-23", "Acme", "Combo", 100)],
      mixes: [m],
      today,
    })[0].runs[0].mixes[0];
    expect(entry.totalLbs).toBe(5);
    expect(entry.batches).toBe(0);
  });

  it("includes a run only within the mix's days-early window", () => {
    const m = mix({ name: "M", brand: "Acme", flavor: "Combo", daysEarly: 2, components: [{ ingredient: "A", perPizza: 1 }] });
    // 5 days out -> not yet
    expect(
      buildMixPlan({ runs: [run("2026-06-28", "Acme", "Combo", 10)], mixes: [m], today }),
    ).toHaveLength(0);
    // 2 days out -> due
    expect(
      buildMixPlan({ runs: [run("2026-06-25", "Acme", "Combo", 10)], mixes: [m], today }),
    ).toHaveLength(1);
  });

  it("skips past runs, non-matching products, and disabled mixes", () => {
    const plan = buildMixPlan({
      runs: [
        run("2026-06-22", "Acme", "Combo", 10), // past
        run("2026-06-24", "Other", "Combo", 10), // brand mismatch
        run("2026-06-24", "Acme", "Combo", 10), // matches the disabled mix only
      ],
      mixes: [mix({ name: "M", brand: "Acme", flavor: "Combo", enabled: false, components: [{ ingredient: "A", perPizza: 1 }] })],
      today,
    });
    expect(plan).toHaveLength(0);
  });

  it("matches brand+flavor case-insensitively", () => {
    const m = mix({ name: "M", brand: "Acme", flavor: "Combo", components: [{ ingredient: "A", perPizza: 1 }] });
    const plan = buildMixPlan({
      runs: [run("2026-06-23", "acme", "combo", 10)],
      mixes: [m],
      today,
    });
    expect(plan).toHaveLength(1);
  });

  it("groups runs by date sorted ascending and supports multiple mixes per run", () => {
    const m1 = mix({ name: "M1", brand: "Acme", flavor: "Combo", daysEarly: 5, components: [{ ingredient: "A", perPizza: 1 }] });
    const m2 = mix({ name: "M2", brand: "Acme", flavor: "Combo", daysEarly: 5, components: [{ ingredient: "B", perPizza: 2 }] });
    const plan = buildMixPlan({
      runs: [
        run("2026-06-27", "Acme", "Combo", 10),
        run("2026-06-25", "Acme", "Combo", 10),
      ],
      mixes: [m1, m2],
      today,
    });
    expect(plan.map((g) => g.date)).toEqual(["2026-06-25", "2026-06-27"]);
    expect(plan[0].runs[0].mixes.map((m) => m.name)).toEqual(["M1", "M2"]);
  });

  it("aggregates same-day same-product runs into one card and subtracts amountAlreadyMade once", () => {
    const m = mix({
      name: "M",
      brand: "Acme",
      flavor: "Combo",
      batchSize: 40,
      amountAlreadyMade: 40,
      // 1.28 oz/pizza * 1000 / 16 = 80 lbs total.
      components: [{ ingredient: "Onions", perPizza: 1.28 }],
    });
    const plan = buildMixPlan({
      runs: [
        run("2026-06-23", "Acme", "Combo", 600, 60),
        run("2026-06-23", "Acme", "Combo", 400, 40),
      ],
      mixes: [m],
      today,
    });
    expect(plan).toHaveLength(1);
    // One grouped card for the product, not one per run.
    expect(plan[0].runs).toHaveLength(1);
    const planRun = plan[0].runs[0];
    expect(planRun.pizzas).toBe(1000);
    expect(planRun.cases).toBe(100);
    const entry = planRun.mixes[0];
    // total = 1.28 * 1000 / 16 = 80 lbs; amountAlreadyMade subtracted ONCE => 40 remaining, 1 batch.
    expect(entry.totalLbs).toBeCloseTo(80);
    expect(entry.remainingLbs).toBeCloseTo(40);
    expect(entry.batches).toBeCloseTo(1);
    expect(entry.components[0].lbs).toBeCloseTo(80);
  });
});
