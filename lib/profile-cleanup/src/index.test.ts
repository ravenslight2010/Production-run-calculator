import { describe, it, expect } from "vitest";
import {
  PROFILE_DELETE_PAIRS,
  PROFILE_REBUILD_OVERLAYS,
  PROFILE_REBUILD_DOUGHBALL_OZ,
  splitProfileKey,
  profileHasRecipeData,
  planProfileCleanup,
  brandsToRemoveAfterDeletes,
} from "./index";

describe("splitProfileKey", () => {
  it("splits on the first __ and keeps separators inside the flavor", () => {
    expect(splitProfileKey("lowe's__bbq chicken")).toEqual({ brand: "lowe's", flavor: "bbq chicken" });
    expect(splitProfileKey("fsd 7'' crb__m/l")).toEqual({ brand: "fsd 7'' crb", flavor: "m/l" });
    expect(splitProfileKey("lowe's__spinach & mushroom")).toEqual({ brand: "lowe's", flavor: "spinach & mushroom" });
  });
  it("returns null when there is no separator", () => {
    expect(splitProfileKey("nope")).toBeNull();
  });
});

describe("profileHasRecipeData", () => {
  it("is false for null / empty / dough-only profiles", () => {
    expect(profileHasRecipeData(null)).toBe(false);
    expect(profileHasRecipeData({})).toBe(false);
    // dough-only (a not-yet-filled profile) must count as NO recipe data
    expect(profileHasRecipeData({ doughRecipeName: "Standard Dough", doughRecipe: [{ lbs: 50 }] })).toBe(false);
  });
  it("is true for a die, sauce, applicator, or pepperoni", () => {
    expect(profileHasRecipeData({ dieType: "11\"" })).toBe(true);
    expect(profileHasRecipeData({ frontlineRecipeName: "BBQ Sauce" })).toBe(true);
    expect(profileHasRecipeData({ sauceOzPerPizza: 2.25 })).toBe(true);
    expect(profileHasRecipeData({ app1Type: "cheese" })).toBe(true);
    expect(profileHasRecipeData({ app3CheeseRecipeName: "Whole Mozzarella Cheese Mix" })).toBe(true);
    expect(profileHasRecipeData({ pep1Type: "Pepperoni Stick" })).toBe(true);
    expect(profileHasRecipeData({ pep1Sticks: 9 })).toBe(true);
  });
});

describe("data integrity", () => {
  it("every delete pair keeps the empty and twin distinct and well-formed", () => {
    for (const [emptyKey, twinKey] of PROFILE_DELETE_PAIRS) {
      expect(emptyKey).not.toBe(twinKey);
      expect(splitProfileKey(emptyKey)).not.toBeNull();
      expect(splitProfileKey(twinKey)).not.toBeNull();
    }
  });
  it("no key is both a delete-empty and a rebuild target", () => {
    const del = new Set(PROFILE_DELETE_PAIRS.map(([e]) => e));
    for (const key of Object.keys(PROFILE_REBUILD_OVERLAYS)) {
      expect(del.has(key)).toBe(false);
    }
  });
  it("every rebuild overlay carries recipe data and a doughball weight", () => {
    for (const [key, overlay] of Object.entries(PROFILE_REBUILD_OVERLAYS)) {
      expect(profileHasRecipeData(overlay as Record<string, unknown>)).toBe(true);
      expect(typeof PROFILE_REBUILD_DOUGHBALL_OZ[key]).toBe("number");
      expect(PROFILE_REBUILD_DOUGHBALL_OZ[key]).toBeGreaterThan(0);
    }
  });
  it("overlays never carry a platform-specific doughball field", () => {
    for (const overlay of Object.values(PROFILE_REBUILD_OVERLAYS)) {
      expect("targetDoughballWeight" in overlay).toBe(false);
      expect("doughballWeightOz" in overlay).toBe(false);
    }
  });
});

describe("planProfileCleanup", () => {
  it("deletes a blank whose populated twin exists", () => {
    const store: Record<string, Record<string, unknown>> = {
      "11\" lowe's__bbq chicken": { doughRecipeName: "Dough" }, // blank shell (dough only)
      "lowe's__bbq chicken": { dieType: "11\"", app1Type: "cheese" }, // populated twin
    };
    const { deleteKeys } = planProfileCleanup((k) => store[k] ?? null);
    expect(deleteKeys).toContain("11\" lowe's__bbq chicken");
  });
  it("never deletes when the empty side actually has recipe data", () => {
    const store: Record<string, Record<string, unknown>> = {
      "11\" lowe's__bbq chicken": { dieType: "11\"" }, // NOT blank
      "lowe's__bbq chicken": { app1Type: "cheese" },
    };
    const { deleteKeys } = planProfileCleanup((k) => store[k] ?? null);
    expect(deleteKeys).not.toContain("11\" lowe's__bbq chicken");
  });
  it("never deletes when the twin is missing or also blank", () => {
    const store: Record<string, Record<string, unknown>> = {
      "11\" lowe's__bbq chicken": {},
      // no twin
    };
    const { deleteKeys } = planProfileCleanup((k) => store[k] ?? null);
    expect(deleteKeys).not.toContain("11\" lowe's__bbq chicken");
  });
  it("rebuilds an existing dough-only profile but not a missing or already-filled one", () => {
    const store: Record<string, Record<string, unknown>> = {
      "fsd 7'' crb__cheese": { doughRecipeName: "Dough" }, // exists, dough only -> rebuild
      "fsd 7'' crb__pepperoni": { dieType: "7\"", app1Type: "Diced Pepperoni" }, // already filled -> skip
      // "fsd 7'' crb__m/l" missing entirely -> skip
    };
    const { rebuildKeys } = planProfileCleanup((k) => store[k] ?? null);
    expect(rebuildKeys).toContain("fsd 7'' crb__cheese");
    expect(rebuildKeys).not.toContain("fsd 7'' crb__pepperoni");
    expect(rebuildKeys).not.toContain("fsd 7'' crb__m/l");
  });
  it("is a no-op on already-cleaned data", () => {
    const { deleteKeys, rebuildKeys } = planProfileCleanup(() => null);
    expect(deleteKeys).toEqual([]);
    expect(rebuildKeys).toEqual([]);
  });
});

describe("brandsToRemoveAfterDeletes", () => {
  it("removes a brand only when every one of its flavors was deleted", () => {
    const brandFlavors = {
      "bobo's 12\"": ["deluxe", "alfredo", "breakfast"],
      "lowe's": ["bbq chicken", "margherita"],
    };
    const deleteKeys = [
      "bobo's 12\"__deluxe",
      "bobo's 12\"__alfredo",
      "bobo's 12\"__breakfast",
      "lowe's__margherita", // lowe's keeps bbq chicken
    ];
    expect(brandsToRemoveAfterDeletes(brandFlavors, deleteKeys)).toEqual(["bobo's 12\""]);
  });
  it("keeps a brand that still holds a left-alone no-source flavor", () => {
    const brandFlavors = {
      "11\" lowe's": ["bbq chicken", "red pepper hommus"], // hommus has no source, not deleted
    };
    const deleteKeys = ["11\" lowe's__bbq chicken"];
    expect(brandsToRemoveAfterDeletes(brandFlavors, deleteKeys)).toEqual([]);
  });
  it("matches brand names case-insensitively", () => {
    const brandFlavors = { "4Hands": ["chx club"] };
    const deleteKeys = ["4hands__chx club"];
    expect(brandsToRemoveAfterDeletes(brandFlavors, deleteKeys)).toEqual(["4Hands"]);
  });
});
