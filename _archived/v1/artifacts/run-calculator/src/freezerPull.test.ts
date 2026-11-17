import { describe, it, expect } from "vitest";
import {
  normalizeFreezerPullItem,
  normalizeFreezerPullItems,
  daysUntil,
  buildFreezerPullPlan,
  DEFAULT_DAYS_EARLY,
  type FreezerPullItem,
  type FreezerScheduledRun,
} from "@workspace/freezer-pull";

// Tests live in the artifact (libs hold no tests). Exercise the pure
// freezer-pull model that both web and mobile feed into.

describe("normalizeFreezerPullItem", () => {
  it("defaults daysEarly to 3 and enabled to true", () => {
    const item = normalizeFreezerPullItem({ ingredient: "Premix" });
    expect(item).toMatchObject({
      ingredient: "Premix",
      daysEarly: DEFAULT_DAYS_EARLY,
      enabled: true,
    });
    expect(item?.id).toBeTruthy();
  });

  it("clamps negative daysEarly to 0 and truncates floats", () => {
    expect(normalizeFreezerPullItem({ ingredient: "A", daysEarly: -5 })?.daysEarly).toBe(0);
    expect(normalizeFreezerPullItem({ ingredient: "A", daysEarly: 2.9 })?.daysEarly).toBe(2);
  });

  it("coerces string daysEarly and respects enabled=false", () => {
    const item = normalizeFreezerPullItem({ ingredient: "A", daysEarly: "4", enabled: false });
    expect(item?.daysEarly).toBe(4);
    expect(item?.enabled).toBe(false);
  });

  it("drops entries with a blank ingredient", () => {
    expect(normalizeFreezerPullItem({ ingredient: "   " })).toBeNull();
    expect(normalizeFreezerPullItem({})).toBeNull();
    expect(normalizeFreezerPullItem(null)).toBeNull();
  });
});

describe("normalizeFreezerPullItems", () => {
  it("drops malformed entries and dedupes by ingredient (case-insensitive)", () => {
    const items = normalizeFreezerPullItems([
      { ingredient: "Premix", daysEarly: 2 },
      { ingredient: "premix", daysEarly: 5 },
      { ingredient: "" },
      null,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].daysEarly).toBe(5);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeFreezerPullItems(undefined)).toEqual([]);
    expect(normalizeFreezerPullItems({})).toEqual([]);
  });
});

describe("daysUntil", () => {
  it("counts whole calendar days regardless of timezone", () => {
    expect(daysUntil("2026-06-25", "2026-06-23")).toBe(2);
    expect(daysUntil("2026-06-23", "2026-06-23")).toBe(0);
    expect(daysUntil("2026-06-22", "2026-06-23")).toBe(-1);
  });
});

function item(ingredient: string, daysEarly: number, enabled = true): FreezerPullItem {
  return { id: ingredient, ingredient, daysEarly, enabled };
}

function run(date: string, brand: string, flavor: string, names: string[]): FreezerScheduledRun {
  return {
    date,
    brand,
    flavor,
    ingredients: names.map((name) => ({ name, quantity: "10", unit: "lbs" })),
  };
}

describe("buildFreezerPullPlan", () => {
  const today = "2026-06-23";

  it("includes a run only once it's within the item's window", () => {
    const items = [item("Sausage Mix", 3)];
    // 5 days out -> not yet; 3 days out -> due.
    const tooEarly = buildFreezerPullPlan({
      runs: [run("2026-06-28", "Acme", "Combo", ["Sausage Mix"])],
      freezerItems: items,
      today,
    });
    expect(tooEarly).toHaveLength(0);
    const due = buildFreezerPullPlan({
      runs: [run("2026-06-26", "Acme", "Combo", ["Sausage Mix"])],
      freezerItems: items,
      today,
    });
    expect(due).toHaveLength(1);
    expect(due[0].runs[0].items[0]).toMatchObject({
      name: "Sausage Mix",
      quantity: "10",
      unit: "lbs",
      daysEarly: 3,
    });
  });

  it("skips past runs and ones that don't use the ingredient", () => {
    const items = [item("Sausage Mix", 3)];
    const plan = buildFreezerPullPlan({
      runs: [
        run("2026-06-22", "Acme", "Old", ["Sausage Mix"]), // past
        run("2026-06-24", "Acme", "Cheese", ["Mozzarella"]), // no match
      ],
      freezerItems: items,
      today,
    });
    expect(plan).toHaveLength(0);
  });

  it("matches case-insensitively and ignores disabled items", () => {
    const plan = buildFreezerPullPlan({
      runs: [run("2026-06-24", "Acme", "Combo", ["sausage mix", "Pepperoni"])],
      freezerItems: [item("Sausage Mix", 3), item("Pepperoni", 3, false)],
      today,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].runs[0].items.map((i) => i.name)).toEqual(["sausage mix"]);
  });

  it("keeps the scaled dough ingredient quantity for a 336-case freezer pull", () => {
    const plan = buildFreezerPullPlan({
      runs: [
        {
          date: "2026-06-26",
          brand: "Hannaford",
          flavor: "4 Meat",
          ingredients: [
            // 11 scaled dough batches × 22 lb per batch, not the 22 lb
            // recipe input. The app's warehouse resolver owns this math; the
            // shared pull planner must preserve the formatted result verbatim.
            { name: "Malted Barley", quantity: "242.0", unit: "lbs" },
            { name: "malted barley", quantity: "242.0", unit: "lbs" },
            // Mix components are also already scaled from per-pizza ounces.
            { name: "Basil Pesto", quantity: "126.0", unit: "lbs" },
            { name: "Flour", quantity: "1804.0", unit: "lbs" },
          ],
        },
      ],
      freezerItems: [item("malted barley", 3), item("Basil Pesto", 3)],
      today,
    });

    expect(plan).toHaveLength(1);
    expect(plan[0].runs[0].items).toEqual([
      expect.objectContaining({
        name: "Malted Barley",
        quantity: "242.0",
        unit: "lbs",
        daysEarly: 3,
      }),
      expect.objectContaining({
        name: "Basil Pesto",
        quantity: "126.0",
        unit: "lbs",
        daysEarly: 3,
      }),
    ]);
    expect(plan[0].runs[0].items.filter((entry) => entry.name.toLowerCase() === "malted barley")).toHaveLength(1);
    expect(plan[0].runs[0].items.map((entry) => entry.name)).not.toContain("Flour");
  });

  it("groups multiple runs under the same date, sorted by date", () => {
    const items = [item("Sausage Mix", 5)];
    const plan = buildFreezerPullPlan({
      runs: [
        run("2026-06-27", "B", "y", ["Sausage Mix"]),
        run("2026-06-25", "A", "x", ["Sausage Mix"]),
        run("2026-06-25", "A", "z", ["Sausage Mix"]),
      ],
      freezerItems: items,
      today,
    });
    expect(plan.map((g) => g.date)).toEqual(["2026-06-25", "2026-06-27"]);
    expect(plan[0].runs).toHaveLength(2);
  });
});
