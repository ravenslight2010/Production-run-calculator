import { describe, expect, it } from "vitest";
import { recomputeCheeseSharesFromLbs } from "./dataHeals";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

function makeRecipe(
  components: Array<{ ingredient: string; lbs: number; ozPerPizza?: number; sharePct?: number }>,
): CheeseRecipe {
  return {
    id: "test-recipe",
    name: "Test Cheese Mix",
    brand: "TestBrand",
    flavors: [],
    components: components.map((c) => ({ lbs: 0, ...c })),
    cellulose: "",
    shredderSetting: "",
    notes: "",
    enabled: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as unknown as CheeseRecipe;
}

describe("recomputeCheeseSharesFromLbs", () => {
  // ── Core v1-already-ran recovery case ────────────────────────────────────
  it("fixes oz-derived sharePct even when ozPerPizza is already gone (v1 heal scenario)", () => {
    // v1 stripped ozPerPizza from production rows but left sharePct values that
    // were computed from oz proportions (20% / 80% oz split != 71% / 29% lbs split).
    // The heal must recompute sharePct from lbs regardless.
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 20, sharePct: 20 }, // wrong: was oz-derived
      { ingredient: "Provolone", lbs: 5, sharePct: 80 },   // wrong: was oz-derived
    ]);
    const result = recomputeCheeseSharesFromLbs(recipe);
    expect(result).not.toBeNull();
    const comps = result!.components;
    // sharePct recomputed from lbs: 20/(20+5)=80, 5/(20+5)=20
    expect(comps[0].sharePct).toBeCloseTo(80, 1);
    expect(comps[1].sharePct).toBeCloseTo(20, 1);
  });

  // ── Fresh DB (ozPerPizza still present) ──────────────────────────────────
  it("strips positive ozPerPizza and recomputes sharePct from lbs", () => {
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 20, ozPerPizza: 4, sharePct: 70 }, // oz-derived
      { ingredient: "Provolone",  lbs: 8,  ozPerPizza: 1.5, sharePct: 30 }, // oz-derived
    ]);
    const result = recomputeCheeseSharesFromLbs(recipe);
    expect(result).not.toBeNull();
    const comps = result!.components;
    expect(comps.every((c) => !("ozPerPizza" in c))).toBe(true);
    // sharePct from lbs: 20/28 ≈ 71.43, 8/28 ≈ 28.57
    expect(comps[0].sharePct).toBeCloseTo(71.43, 1);
    expect(comps[1].sharePct).toBeCloseTo(28.57, 1);
  });

  it("strips zero-valued ozPerPizza by property presence, not value", () => {
    // ozPerPizza: 0 is still invisible to managers and must be stripped.
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 20, ozPerPizza: 0 },
      { ingredient: "Provolone",  lbs: 8 },
    ]);
    const result = recomputeCheeseSharesFromLbs(recipe);
    expect(result).not.toBeNull();
    expect(result!.components.every((c) => !("ozPerPizza" in c))).toBe(true);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────
  it("returns null when sharePct already matches lbs proportions and no ozPerPizza present", () => {
    // After the heal has run, a second call should be a no-op.
    // Start with oz-derived (wrong) values so the first call changes them.
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 20, sharePct: 20 }, // oz-derived, wrong
      { ingredient: "Provolone",  lbs: 5,  sharePct: 80 }, // oz-derived, wrong
    ]);
    // First call: recomputes sharePct from lbs
    const first = recomputeCheeseSharesFromLbs(recipe);
    expect(first).not.toBeNull();
    expect(first!.components[0].sharePct).toBeCloseTo(80, 1);
    expect(first!.components[1].sharePct).toBeCloseTo(20, 1);
    // Second call: sharePct is now lbs-correct, no ozPerPizza → null (idempotent)
    const second = recomputeCheeseSharesFromLbs(first!);
    expect(second).toBeNull();
  });

  it("returns null when no ozPerPizza and no sharePct at all (nothing to do)", () => {
    // A recipe with no sharePct and no ozPerPizza has no usable basis to compute
    // shares — backfill will also produce nothing — so nothing changes.
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 0 },
      { ingredient: "Provolone",  lbs: 0 },
    ]);
    expect(recomputeCheeseSharesFromLbs(recipe)).toBeNull();
  });

  // ── No lbs basis ─────────────────────────────────────────────────────────
  it("strips ozPerPizza but preserves existing sharePct when all lbs are 0", () => {
    // Zero-lbs recipe: a spec-import stub whose sharePct was seeded from oz
    // proportions during import. The heal must strip ozPerPizza without
    // destroying those valid blend ratios — no lbs to recompute from.
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 0, ozPerPizza: 3, sharePct: 75 },
      { ingredient: "Provolone",  lbs: 0, ozPerPizza: 1, sharePct: 25 },
    ]);
    const result = recomputeCheeseSharesFromLbs(recipe);
    expect(result).not.toBeNull();
    const comps = result!.components;
    // ozPerPizza stripped
    expect(comps.every((c) => !("ozPerPizza" in c))).toBe(true);
    // sharePct preserved — it's the only basis for blend shares on a zero-lbs stub
    expect(comps[0].sharePct).toBe(75);
    expect(comps[1].sharePct).toBe(25);
  });

  it("strips ozPerPizza and leaves sharePct absent on zero-lbs recipe with no prior sharePct", () => {
    // No lbs and no sharePct: strip oz, nothing to restore.
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 0, ozPerPizza: 3 },
      { ingredient: "Provolone",  lbs: 0, ozPerPizza: 1 },
    ]);
    const result = recomputeCheeseSharesFromLbs(recipe);
    expect(result).not.toBeNull();
    const comps = result!.components;
    expect(comps.every((c) => !("ozPerPizza" in c))).toBe(true);
    // No sharePct was set before → stays absent
    expect(comps.every((c) => !("sharePct" in c) || (c.sharePct ?? 0) === 0)).toBe(true);
  });

  // ── No prior sharePct (fresh import) ─────────────────────────────────────
  it("sets sharePct from lbs when ozPerPizza present but sharePct was never set", () => {
    const recipe = makeRecipe([
      { ingredient: "Mozzarella", lbs: 15, ozPerPizza: 5 },
      { ingredient: "Parmesan",   lbs: 5,  ozPerPizza: 2 },
    ]);
    const result = recomputeCheeseSharesFromLbs(recipe);
    expect(result).not.toBeNull();
    const comps = result!.components;
    expect(comps.every((c) => !("ozPerPizza" in c))).toBe(true);
    // sharePct from lbs: 15/20 = 75, 5/20 = 25
    expect(comps[0].sharePct).toBeCloseTo(75, 1);
    expect(comps[1].sharePct).toBeCloseTo(25, 1);
  });
});
