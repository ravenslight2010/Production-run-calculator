// @vitest-environment jsdom
//
// Unified setup editing ("edit once, updates everywhere") — pure-logic guards:
//
// 1. mergeProfileIntoOpenForm overlays a freshly saved profile onto the OPEN
//    run form without clobbering per-run inputs (cases needed), progress
//    fields of a started run, or the run's brand/flavor identity — and
//    returns the SAME reference when nothing differs so callers skip the
//    reset/stamp/push dance (no spurious sync stamps).
// 2. refreshProfilesFromNamedRecipes fans a changed shared dough/sauce recipe
//    out to every SAVED profile linked by name (case-insensitive), as a
//    targeted merge that never blanks other profile data and never creates a
//    profile that doesn't exist.
// 3. recipeRowsEqual / normalizeRecipeRowsForCompare drive both the drift
//    indicator and the "did the pool actually change" decision.

import { describe, it, expect, beforeEach } from "vitest";
import {
  mergeProfileIntoOpenForm,
  refreshProfilesFromNamedRecipes,
  recipeRowsEqual,
  normalizeRecipeRowsForCompare,
} from "./storage";
import { PROFILE_KEY, DEFAULT_VALUES, type FormValues } from "./types";

const BRAND = "Corner Booth";
const FLAVOR = "MEAT LOVER";

function seedProfile(brand: string, flavor: string, extra: Partial<FormValues>): void {
  localStorage.setItem(
    PROFILE_KEY(brand, flavor),
    JSON.stringify({ ...DEFAULT_VALUES, ...extra }),
  );
}

function readProfile(brand: string, flavor: string): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PROFILE_KEY(brand, flavor)) ?? "null");
}

beforeEach(() => localStorage.clear());

describe("normalizeRecipeRowsForCompare / recipeRowsEqual", () => {
  it("drops blank rows, trims names, coerces lbs", () => {
    expect(
      normalizeRecipeRowsForCompare([
        { ingredient: "  Flour ", lbs: "50" as unknown as number },
        { ingredient: "", lbs: 10 },
        { ingredient: "Salt", lbs: Number.NaN },
      ]),
    ).toEqual([
      { ingredient: "Flour", lbs: 50 },
      { ingredient: "Salt", lbs: 0 },
    ]);
  });

  it("compares case-insensitively on ingredient names, order-sensitively on rows", () => {
    const a = [{ ingredient: "Flour", lbs: 50 }, { ingredient: "Salt", lbs: 2 }];
    expect(recipeRowsEqual(a, [{ ingredient: "flour", lbs: 50 }, { ingredient: "SALT", lbs: 2 }])).toBe(true);
    expect(recipeRowsEqual(a, [{ ingredient: "Salt", lbs: 2 }, { ingredient: "Flour", lbs: 50 }])).toBe(false);
    expect(recipeRowsEqual(a, [{ ingredient: "Flour", lbs: 51 }, { ingredient: "Salt", lbs: 2 }])).toBe(false);
    expect(recipeRowsEqual(a, a.slice(0, 1))).toBe(false);
  });

  it("ignores trailing blank '+ Add' rows on either side", () => {
    const a = [{ ingredient: "Flour", lbs: 50 }];
    expect(recipeRowsEqual(a, [...a, { ingredient: "", lbs: 0 }])).toBe(true);
  });
});

describe("mergeProfileIntoOpenForm", () => {
  it("overlays profile-owned fields but keeps per-run, progress, and identity fields", () => {
    const current: FormValues = {
      ...DEFAULT_VALUES,
      brand: BRAND,
      flavor: FLAVOR,
      casesNeeded: 480, // per-run
      skidsDone: 3, // progress
      casesDone: 120, // progress
      doughRecipeName: "Old Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 40 }],
      sauceOzPerPizza: 5,
    };
    const profile: FormValues = {
      ...DEFAULT_VALUES,
      casesNeeded: 0,
      skidsDone: 0,
      casesDone: 0,
      doughRecipeName: "New Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 55 }],
      sauceOzPerPizza: 6,
    };
    const merged = mergeProfileIntoOpenForm(current, profile);
    expect(merged).not.toBe(current);
    expect(merged.doughRecipeName).toBe("New Dough");
    expect(merged.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 55 }]);
    expect(merged.sauceOzPerPizza).toBe(6);
    // Untouched by the profile overlay:
    expect(merged.casesNeeded).toBe(480);
    expect(merged.skidsDone).toBe(3);
    expect(merged.casesDone).toBe(120);
    expect(merged.brand).toBe(BRAND);
    expect(merged.flavor).toBe(FLAVOR);
    // Input is never mutated.
    expect(current.doughRecipeName).toBe("Old Dough");
  });

  it("returns the SAME reference when nothing profile-owned differs", () => {
    const current: FormValues = {
      ...DEFAULT_VALUES,
      casesNeeded: 480,
      skidsDone: 2,
      doughRecipeName: "Same Dough",
    };
    const profile: FormValues = {
      ...DEFAULT_VALUES,
      casesNeeded: 999, // per-run — must not count as a difference
      skidsDone: 0, // progress — must not count as a difference
      doughRecipeName: "Same Dough",
    };
    expect(mergeProfileIntoOpenForm(current, profile)).toBe(current);
  });
});

describe("refreshProfilesFromNamedRecipes", () => {
  const NEW_ROWS = [
    { ingredient: "Flour", lbs: 60 },
    { ingredient: "Water", lbs: 30 },
  ];

  it("rewrites linked profiles by name (case-insensitive) and reports them", () => {
    seedProfile(BRAND, FLAVOR, {
      doughRecipeName: "house dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 40 }],
      sauceOzPerPizza: 7, // unrelated field must survive
    });
    seedProfile("Other Brand", "CHEESE", {
      doughRecipeName: "Different Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 10 }],
    });
    const touched = refreshProfilesFromNamedRecipes("dough", [
      { name: "House Dough", rows: NEW_ROWS, doughballWeightOz: 19 },
    ]);
    expect(touched).toEqual([
      { brand: BRAND.toLowerCase(), flavor: FLAVOR.toLowerCase() },
    ]);
    const updated = readProfile(BRAND, FLAVOR);
    expect(updated.doughRecipe).toEqual(NEW_ROWS);
    expect(updated.targetDoughballWeight).toBe(19);
    expect(updated.sauceOzPerPizza).toBe(7);
    // The unlinked profile is untouched.
    expect(readProfile("Other Brand", "CHEESE").doughRecipe).toEqual([
      { ingredient: "Flour", lbs: 10 },
    ]);
  });

  it("updates sauce profiles via frontlineRecipeName and never touches dough fields", () => {
    seedProfile(BRAND, FLAVOR, {
      frontlineRecipeName: "Red Sauce",
      frontlineRecipe: [{ ingredient: "Tomato Paste", lbs: 100 }],
      doughRecipe: [{ ingredient: "Flour", lbs: 40 }],
      targetDoughballWeight: 18,
    });
    const rows = [{ ingredient: "Tomato Paste", lbs: 120 }];
    const touched = refreshProfilesFromNamedRecipes("sauce", [{ name: "red sauce", rows }]);
    expect(touched).toHaveLength(1);
    const updated = readProfile(BRAND, FLAVOR);
    expect(updated.frontlineRecipe).toEqual(rows);
    expect(updated.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 40 }]);
    expect(updated.targetDoughballWeight).toBe(18);
  });

  it("no-ops when the stored rows already match (no spurious profile stamps)", () => {
    seedProfile(BRAND, FLAVOR, {
      doughRecipeName: "House Dough",
      doughRecipe: NEW_ROWS,
      targetDoughballWeight: 19,
    });
    const before = localStorage.getItem(PROFILE_KEY(BRAND, FLAVOR));
    const touched = refreshProfilesFromNamedRecipes("dough", [
      { name: "House Dough", rows: NEW_ROWS, doughballWeightOz: 19 },
    ]);
    expect(touched).toEqual([]);
    expect(localStorage.getItem(PROFILE_KEY(BRAND, FLAVOR))).toBe(before);
  });

  it("leaves a manager-typed doughball weight alone when the pool has none (0/unset)", () => {
    seedProfile(BRAND, FLAVOR, {
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 40 }],
      targetDoughballWeight: 21,
    });
    refreshProfilesFromNamedRecipes("dough", [{ name: "House Dough", rows: NEW_ROWS }]);
    const updated = readProfile(BRAND, FLAVOR);
    expect(updated.doughRecipe).toEqual(NEW_ROWS);
    expect(updated.targetDoughballWeight).toBe(21);
  });

  it("never creates a profile that doesn't exist and skips profiles with no link", () => {
    seedProfile(BRAND, FLAVOR, { doughRecipe: [{ ingredient: "Flour", lbs: 40 }] }); // no doughRecipeName
    const touched = refreshProfilesFromNamedRecipes("dough", [
      { name: "House Dough", rows: NEW_ROWS },
    ]);
    expect(touched).toEqual([]);
    expect(readProfile(BRAND, FLAVOR).doughRecipe).toEqual([{ ingredient: "Flour", lbs: 40 }]);
    // Only the one seeded profile key exists.
    const profileKeys = Object.keys(localStorage).filter(
      (k) => k.startsWith("run-calc-profile-") && !k.includes("::"),
    );
    expect(profileKeys).toHaveLength(1);
  });

  it("survives an unreadable profile blob without blocking the fan-out", () => {
    localStorage.setItem("run-calc-profile-bad__blob", "{not json");
    seedProfile(BRAND, FLAVOR, {
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 40 }],
    });
    const touched = refreshProfilesFromNamedRecipes("dough", [
      { name: "House Dough", rows: NEW_ROWS },
    ]);
    expect(touched).toHaveLength(1);
    expect(readProfile(BRAND, FLAVOR).doughRecipe).toEqual(NEW_ROWS);
  });
});
