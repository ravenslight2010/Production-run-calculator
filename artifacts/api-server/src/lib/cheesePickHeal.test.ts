import { describe, it, expect } from "vitest";
import {
  shouldClearCheesePick,
  healCheesePicksInPayload,
  POISONED_CHEESE_ALIAS_PAIRS,
  ALWAYS_CLEAR_PICKS,
} from "./cheesePickHeal";

describe("shouldClearCheesePick", () => {
  it("clears the audited poison-output names regardless of brand", () => {
    expect(shouldClearCheesePick("Red Hot Cheese Mix", "Aldo's")).toBe(true);
    expect(shouldClearCheesePick("Lowe's Spinach Cheese Mix", "Lucia's")).toBe(true);
    expect(shouldClearCheesePick("  lowe's pepperoni cheese mix  ", "Basha's")).toBe(true);
    expect(shouldClearCheesePick("Cheeseburger Cheese Mix", "Lowe's")).toBe(true);
  });

  it("clears BBQ Chicken Cheese Mix only for non-Price-Chopper runs", () => {
    expect(shouldClearCheesePick("BBQ Chicken Cheese Mix", "Corner Booth")).toBe(true);
    expect(shouldClearCheesePick("BBQ Chicken Cheese Mix", "Price Chopper")).toBe(false);
    expect(shouldClearCheesePick("BBQ Chicken Cheese Mix", "price chopper")).toBe(false);
    // Unknown brand (run object missing) errs on clearing — the pick is only
    // legitimate on Price Chopper runs.
    expect(shouldClearCheesePick("BBQ Chicken Cheese Mix", undefined)).toBe(true);
  });

  it("keeps every non-poisoned pick", () => {
    expect(shouldClearCheesePick("Lucia's Six Cheese Mix", "Lucia's")).toBe(false);
    expect(shouldClearCheesePick("Corner Booth House Veggie Cheese Mix", "Corner Booth")).toBe(false);
    expect(shouldClearCheesePick("", "Lowe's")).toBe(false);
    expect(shouldClearCheesePick(undefined, "Lowe's")).toBe(false);
  });
});

describe("poison pair list", () => {
  it("is normalized lowercase (matches how the heal compares)", () => {
    for (const [ext, canon] of POISONED_CHEESE_ALIAS_PAIRS) {
      expect(ext).toBe(ext.toLowerCase().trim());
      expect(canon).toBe(canon.toLowerCase().trim());
      expect(ext).not.toBe(canon);
    }
  });

  it("every always-clear pick is a canonical of at least one poisoned pair", () => {
    const canonicals = new Set(POISONED_CHEESE_ALIAS_PAIRS.map(([, c]) => c));
    for (const pick of ALWAYS_CLEAR_PICKS) {
      // "Which wrong names ended up on runs" must stay in lockstep with
      // "which learned rows produced them".
      expect(canonicals.has(pick)).toBe(true);
    }
  });
});

describe("healCheesePicksInPayload", () => {
  const NOW = 1_800_000_000_000;

  function payload() {
    return {
      dayState: {
        runs: [
          { id: "r1", brand: "Lucia's", flavor: "SPINACH" },
          { id: "r2", brand: "Price Chopper", flavor: "BBQ CHICKEN" },
          { id: "r3", brand: "Corner Booth", flavor: "BBQ CHICKEN" },
        ],
      },
      runValues: {
        r1: {
          app1CheeseRecipeName: "Lowe's Spinach Cheese Mix",
          app1CheeseRecipe: [{ ingredient: "Whole Mozzarella", lbs: 100 }],
          app2CheeseRecipeName: "Lucia's Six Cheese Mix",
          app2CheeseRecipe: [{ ingredient: "Romano", lbs: 5 }],
          cases: "120",
        },
        r2: {
          app1CheeseRecipeName: "BBQ Chicken Cheese Mix",
          app1CheeseRecipe: [{ ingredient: "Whole Mozzarella", lbs: 90 }],
        },
        r3: {
          app3CheeseRecipeName: "BBQ Chicken Cheese Mix",
          app3CheeseRecipe: [{ ingredient: "Whole Mozzarella", lbs: 90 }],
        },
      },
      runValuesUpdatedAt: { r1: 111, r2: 222, r3: 333 },
      somethingElse: { keep: true },
    };
  }

  it("clears poisoned picks + rows, bumps only healed stamps, keeps the rest", () => {
    const input = payload();
    const { data, changed, clearedPicks } = healCheesePicksInPayload(input, NOW);
    expect(changed).toBe(true);
    expect(clearedPicks).toBe(2); // r1 app1 + r3 app3

    const d = data as ReturnType<typeof payload>;
    // r1: poisoned Lowe's pick cleared, legitimate Lucia's pick untouched.
    expect(d.runValues.r1.app1CheeseRecipeName).toBe("");
    expect(d.runValues.r1.app1CheeseRecipe).toEqual([]);
    expect(d.runValues.r1.app2CheeseRecipeName).toBe("Lucia's Six Cheese Mix");
    expect(d.runValues.r1.app2CheeseRecipe).toEqual([{ ingredient: "Romano", lbs: 5 }]);
    expect(d.runValues.r1.cases).toBe("120");
    // r2: Price Chopper legitimately keeps its BBQ blend.
    expect(d.runValues.r2.app1CheeseRecipeName).toBe("BBQ Chicken Cheese Mix");
    // r3: same name on another customer is cleared.
    expect(d.runValues.r3.app3CheeseRecipeName).toBe("");
    expect(d.runValues.r3.app3CheeseRecipe).toEqual([]);
    // Stamps: healed runs bumped strictly past now, untouched run keeps its stamp.
    expect(d.runValuesUpdatedAt).toEqual({ r1: NOW + 1, r2: 222, r3: NOW + 1 });
    // Unrelated payload fields survive.
    expect(d.somethingElse).toEqual({ keep: true });
    // Non-mutating: the input object was not modified.
    expect(input.runValues.r1.app1CheeseRecipeName).toBe("Lowe's Spinach Cheese Mix");
    expect(input.runValuesUpdatedAt.r1).toBe(111);
  });

  it("bumps stamps monotonically past a future-dated stored stamp", () => {
    // A clock-skewed client may have stamped the poisoned value AHEAD of the
    // server clock. The healed stamp must still be strictly newer, or that
    // client's stale re-push would win strict-LWW and resurrect the bad pick.
    const future = NOW + 999_999;
    const input = {
      dayState: { runs: [{ id: "r1", brand: "Lucia's" }] },
      runValues: {
        r1: { app1CheeseRecipeName: "Lowe's Spinach Cheese Mix", app1CheeseRecipe: [] },
      },
      runValuesUpdatedAt: { r1: future },
    };
    const { data, changed } = healCheesePicksInPayload(input, NOW);
    expect(changed).toBe(true);
    const stamps = (data as typeof input).runValuesUpdatedAt;
    expect(stamps.r1).toBe(future + 1);
  });

  it("returns the same object unchanged when nothing is poisoned", () => {
    const clean = {
      dayState: { runs: [{ id: "r1", brand: "Lucia's" }] },
      runValues: { r1: { app1CheeseRecipeName: "Lucia's Six Cheese Mix" } },
      runValuesUpdatedAt: { r1: 1 },
    };
    const res = healCheesePicksInPayload(clean, NOW);
    expect(res.changed).toBe(false);
    expect(res.clearedPicks).toBe(0);
    expect(res.data).toBe(clean);
  });

  it("tolerates malformed payloads", () => {
    for (const bad of [null, undefined, 42, "x", [], { runValues: null }, { runValues: [] }]) {
      const res = healCheesePicksInPayload(bad, NOW);
      expect(res.changed).toBe(false);
      expect(res.data).toBe(bad);
    }
  });
});
