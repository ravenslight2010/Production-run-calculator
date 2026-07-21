import { describe, it, expect } from "vitest";
import {
  BRAND_FAN_TARGETS,
  findFanTarget,
  healFanPoisonedValues,
  type DoughPoolRow,
} from "./brandFanHeal";

const pool: DoughPoolRow[] = [
  {
    name: "CRB Dough",
    components: [
      { ingredient: "ADM WHEAT FLOUR", lbs: 200 },
      { ingredient: "WATER", lbs: 97.4 },
      { ingredient: "SUNFLOWER OIL", lbs: 16 },
    ],
  },
  { name: "Malted Barley Dough", components: [{ ingredient: "ADM WHEAT FLOUR", lbs: 200 }] },
  { name: "Naan Dough", components: [{ ingredient: "FLOUR", lbs: 100 }] },
];

describe("brand-fan heal targets", () => {
  it("has unique brand__flavor keys", () => {
    const keys = BRAND_FAN_TARGETS.map((t) => `${t.brand}__${t.flavor}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("finds targets case-insensitively (dayState.runs casing)", () => {
    expect(findFanTarget("Lucia's Craft", "FOUR CHEESE MELTDOWN")?.dough).toBe(
      "CRB Dough",
    );
    expect(findFanTarget("Hannaford", "BBQ CHICKEN")?.weightOz).toBe(7.6);
    expect(findFanTarget("Lowe's 7in", "PEPPERONI")).toBeUndefined();
  });
});

describe("healFanPoisonedValues", () => {
  const target = findFanTarget("hannaford", "bbq chicken")!;

  it("fixes a fanned dough name: name, rows, weight, yield", () => {
    const healed = healFanPoisonedValues(
      {
        doughRecipeName: "Malted Barley Dough",
        doughRecipe: [{ ingredient: "MALTED BARLEY", lbs: 22 }],
        targetDoughballWeight: 13.8,
        doughBatchYield: 376,
        casesNeeded: 120,
      },
      target,
      pool,
    );
    expect(healed).not.toBeNull();
    expect(healed!.doughRecipeName).toBe("CRB Dough");
    expect(healed!.targetDoughballWeight).toBe(7.6);
    expect(healed!.doughBatchYield).toBe(0);
    expect((healed!.doughRecipe as unknown[]).length).toBe(3);
    // untouched fields survive
    expect(healed!.casesNeeded).toBe(120);
  });

  it("fixes a pool-root weight on a correct dough name without touching rows", () => {
    const rows = [{ ingredient: "SUNFLOWER OIL", lbs: 16 }];
    const healed = healFanPoisonedValues(
      { doughRecipeName: "CRB Dough", doughRecipe: rows, targetDoughballWeight: 5.7 },
      target,
      pool,
    );
    expect(healed).not.toBeNull();
    expect(healed!.targetDoughballWeight).toBe(7.6);
    expect(healed!.doughRecipe).toBe(rows);
  });

  it("no-ops on already-correct values", () => {
    expect(
      healFanPoisonedValues(
        { doughRecipeName: "CRB Dough", targetDoughballWeight: 7.6 },
        target,
        pool,
      ),
    ).toBeNull();
  });

  it("no-ops on a manager-picked different dough (not a known poison)", () => {
    expect(
      healFanPoisonedValues(
        { doughRecipeName: "Sriracha Dough", targetDoughballWeight: 12 },
        target,
        pool,
      ),
    ).toBeNull();
  });

  it("no-ops on a non-poison weight for the right dough", () => {
    expect(
      healFanPoisonedValues(
        { doughRecipeName: "CRB Dough", targetDoughballWeight: 8.25 },
        target,
        pool,
      ),
    ).toBeNull();
  });

  it("heals tikka masala to Naan with weight 0 (unset)", () => {
    const t = findFanTarget("hannaford", "chicken tikka masala")!;
    const healed = healFanPoisonedValues(
      { doughRecipeName: "Malted Barley Dough", targetDoughballWeight: 13.8 },
      t,
      pool,
    );
    expect(healed!.doughRecipeName).toBe("Naan Dough");
    expect(healed!.targetDoughballWeight).toBe(0);
  });

  it("heals Lowe's supreme off the purchased Pedone crust name", () => {
    const t = findFanTarget("lowe's", "supreme")!;
    const healed = healFanPoisonedValues(
      { doughRecipeName: 'Pedone Crust 7"x12" Oval', targetDoughballWeight: 0 },
      t,
      pool,
    );
    expect(healed!.doughRecipeName).toBe("Malted Barley Dough");
    expect(healed!.targetDoughballWeight).toBe(7.8);
  });
});
