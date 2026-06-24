import { describe, it, expect } from "vitest";
import {
  profileHasRecipeData,
  findScheduledRecipeIssues,
  type ProfileLike,
  type ScheduledRunRef,
} from "./index";

describe("profileHasRecipeData", () => {
  it("is false for null/undefined/blank profiles", () => {
    expect(profileHasRecipeData(null)).toBe(false);
    expect(profileHasRecipeData(undefined)).toBe(false);
    expect(profileHasRecipeData({})).toBe(false);
    expect(profileHasRecipeData({ doughRecipe: [], frontlineRecipe: [] })).toBe(false);
    expect(profileHasRecipeData({ app1Type: "", dieType: "   " })).toBe(false);
  });

  it("is true when any recipe array has rows", () => {
    expect(profileHasRecipeData({ doughRecipe: [{ ingredient: "Flour", lbs: 1 }] })).toBe(true);
    expect(profileHasRecipeData({ frontlineRecipe: [{ ingredient: "Sauce", lbs: 1 }] })).toBe(true);
    expect(profileHasRecipeData({ app2CheeseRecipe: [{ ingredient: "Mozz", lbs: 1 }] })).toBe(true);
  });

  it("is false when only labels are set but no recipe rows exist", () => {
    // Strict row-based rule: types/die/recipe-names without rows still produce
    // default demand, so they count as incomplete (not "has data").
    expect(profileHasRecipeData({ app1Type: "Cheese" })).toBe(false);
    expect(profileHasRecipeData({ dieType: "7 inch" })).toBe(false);
    expect(profileHasRecipeData({ doughRecipeName: "Classic" })).toBe(false);
    expect(profileHasRecipeData({ pep1Type: "Cup" })).toBe(false);
    expect(
      profileHasRecipeData({ dieType: "7 inch", doughRecipeName: "Classic", doughRecipe: [] }),
    ).toBe(false);
  });
});

describe("findScheduledRecipeIssues", () => {
  const withData: ProfileLike = { doughRecipe: [{ ingredient: "Flour", lbs: 1 }] };

  it("flags missing vs incomplete distinctly", () => {
    const runs: ScheduledRunRef[] = [
      { date: "2026-06-25", brand: "Acme", flavor: "Cheese", casesNeeded: 10 },
      { date: "2026-06-25", brand: "Beta", flavor: "Pep", casesNeeded: 5 },
      { date: "2026-06-25", brand: "Good", flavor: "Cheese", casesNeeded: 3 },
    ];
    const resolve = (brand: string): ProfileLike => {
      if (brand === "Acme") return null; // missing
      if (brand === "Beta") return {}; // exists but blank => incomplete
      return withData; // Good => no issue
    };
    const issues = findScheduledRecipeIssues(runs, resolve);
    expect(issues).toHaveLength(2);
    // missing sorts before incomplete
    expect(issues[0]).toMatchObject({ brand: "Acme", reason: "missing", totalCases: 10 });
    expect(issues[1]).toMatchObject({ brand: "Beta", reason: "incomplete", totalCases: 5 });
  });

  it("collapses repeats across days, summing cases and listing sorted dates", () => {
    const runs: ScheduledRunRef[] = [
      { date: "2026-06-27", brand: "Acme", flavor: "Cheese", casesNeeded: 4 },
      { date: "2026-06-25", brand: "Acme", flavor: "Cheese", casesNeeded: 6 },
      { date: "2026-06-25", brand: "Acme", flavor: "Cheese", casesNeeded: 2 },
    ];
    const issues = findScheduledRecipeIssues(runs, () => null);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      brand: "Acme",
      flavor: "Cheese",
      reason: "missing",
      totalCases: 12,
    });
    expect(issues[0].dates).toEqual(["2026-06-25", "2026-06-27"]);
  });

  it("missing trumps incomplete when a combo resolves both ways", () => {
    let call = 0;
    const runs: ScheduledRunRef[] = [
      { date: "2026-06-25", brand: "Acme", flavor: "Cheese", casesNeeded: 1 },
      { date: "2026-06-26", brand: "Acme", flavor: "Cheese", casesNeeded: 1 },
    ];
    const resolve = (): ProfileLike => (call++ === 0 ? {} : null);
    const issues = findScheduledRecipeIssues(runs, resolve);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe("missing");
  });

  it("ignores runs with a blank brand and treats flavor as optional", () => {
    const runs: ScheduledRunRef[] = [
      { date: "2026-06-25", brand: "", flavor: "Cheese", casesNeeded: 5 },
      { date: "2026-06-25", brand: "Solo", flavor: "", casesNeeded: 7 },
    ];
    const issues = findScheduledRecipeIssues(runs, () => null);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ brand: "Solo", flavor: "", reason: "missing", totalCases: 7 });
  });

  it("returns nothing when every profile has real data", () => {
    const runs: ScheduledRunRef[] = [
      { date: "2026-06-25", brand: "Acme", flavor: "Cheese", casesNeeded: 5 },
    ];
    expect(findScheduledRecipeIssues(runs, () => withData)).toEqual([]);
  });
});
