/**
 * missingAmounts flag — spec-import skips oz/pizza values
 *
 * A spec import can detect a mix's component ingredient names but leave every
 * perPizza value at 0 (amounts are entered by the manager later). The
 * `missingAmounts` flag on MixPlanEntry must fire in that case so the UI
 * can warn the manager. Task #642.
 *
 * Three cases:
 *   1. All components have perPizza === 0  → missingAmounts === true
 *   2. At least one component has perPizza  > 0  → missingAmounts === false
 *   3. amountAlreadyMade covers the total (positive perPizza)
 *      → missingAmounts === false (amounts are present, just already on-hand)
 */
import { describe, it, expect } from "vitest";
import { buildMixPlan, normalizeMix, type Mix, type MixScheduledRun } from "./index";

function makeMix(overrides: Partial<Mix> & { name: string }): Mix {
  return normalizeMix({
    id: overrides.id ?? overrides.name.toLowerCase().replace(/\s+/g, "-"),
    name: overrides.name,
    brand: overrides.brand ?? "Aldo's",
    flavor: overrides.flavor ?? "",
    batchSize: overrides.batchSize ?? 50,
    daysEarly: overrides.daysEarly ?? 0,
    amountAlreadyMade: overrides.amountAlreadyMade ?? 0,
    components: overrides.components ?? [],
    enabled: overrides.enabled !== false,
  })!;
}

function run(date: string, pizzas: number, brand = "Aldo's", flavor = ""): MixScheduledRun {
  return { date, brand, flavor, pizzas, cases: 0 };
}

const TODAY = "2026-08-18";

describe("missingAmounts flag", () => {
  it("is true when all components have perPizza === 0 (spec import skipped amounts)", () => {
    // Simulates a spec sheet that named the ingredients but left every oz/pizza blank.
    const mix = makeMix({
      name: "Veggie Blend",
      components: [
        { ingredient: "Bell Peppers", perPizza: 0 },
        { ingredient: "Mushrooms", perPizza: 0 },
        { ingredient: "Onions", perPizza: 0 },
      ],
    });

    const groups = buildMixPlan({ mixes: [mix], runs: [run(TODAY, 200)], today: TODAY });
    expect(groups).toHaveLength(1);
    const entry = groups[0].runs[0].mixes[0];
    expect(entry.missingAmounts).toBe(true);
  });

  it("is false when at least one component has a positive perPizza", () => {
    // Even one filled-in amount is enough — the mix has usable math.
    const mix = makeMix({
      name: "Veggie Blend",
      components: [
        { ingredient: "Bell Peppers", perPizza: 1.5 },
        { ingredient: "Mushrooms", perPizza: 0 },
      ],
    });

    const groups = buildMixPlan({ mixes: [mix], runs: [run(TODAY, 200)], today: TODAY });
    expect(groups).toHaveLength(1);
    const entry = groups[0].runs[0].mixes[0];
    expect(entry.missingAmounts).toBe(false);
  });

  it("is false when amountAlreadyMade >= totalLbs and perPizza values are positive", () => {
    // Manager already made enough — remainingLbs will be 0, but the amounts
    // (perPizza) ARE present so missingAmounts must stay false.
    const pizzas = 100;
    const perPizzaOz = 2.0; // 2 oz × 100 pizzas ÷ 16 = 12.5 lbs component
    // totalLbs = 12.5 + 15% waste + 20 startup ≈ 34.375 lbs
    const mix = makeMix({
      name: "Herb Mix",
      amountAlreadyMade: 100, // well above any realistic totalLbs
      components: [{ ingredient: "Basil", perPizza: perPizzaOz }],
    });

    const groups = buildMixPlan({ mixes: [mix], runs: [run(TODAY, pizzas)], today: TODAY });
    expect(groups).toHaveLength(1);
    const entry = groups[0].runs[0].mixes[0];
    expect(entry.remainingLbs).toBe(0);    // sanity: fully covered
    expect(entry.missingAmounts).toBe(false);
  });
});
