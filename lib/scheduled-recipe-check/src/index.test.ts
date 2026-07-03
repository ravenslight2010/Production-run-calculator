import { describe, it, expect } from "vitest";
import {
  profileHasRecipeData,
  findScheduledRecipeIssues,
  runFormHasRealData,
  decideSetupJump,
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

describe("runFormHasRealData", () => {
  it("is false for null/undefined/blank/default-shaped forms", () => {
    expect(runFormHasRealData(null)).toBe(false);
    expect(runFormHasRealData(undefined)).toBe(false);
    expect(runFormHasRealData({})).toBe(false);
    // Web DEFAULT_VALUES / mobile DEFAULT_SETTINGS shape: empty strings, empty
    // arrays, zero cases — plus non-signal numeric defaults like batch lbs.
    expect(
      runFormHasRealData({
        casesNeeded: 0,
        doughRecipe: [],
        frontlineRecipe: [],
        app1CheeseRecipe: [],
        app1Type: "",
        pep1Type: " ",
        dieType: "",
        doughRecipeName: "",
        frontlineRecipeName: "",
        pep1BatchLbs: 25,
        pizzasPerCase: 12,
        cartoned: "yes",
        allergen: "none",
      }),
    ).toBe(false);
  });

  it("is true when any recipe array has rows", () => {
    expect(runFormHasRealData({ doughRecipe: [{ ingredient: "Flour", lbs: 1 }] })).toBe(true);
    expect(runFormHasRealData({ app3CheeseRecipe: [{ ingredient: "Mozz", lbs: 2 }] })).toBe(true);
  });

  it("is true when any label/name field is set (unlike strict profileHasRecipeData)", () => {
    expect(runFormHasRealData({ app1Type: "Cheese" })).toBe(true);
    expect(runFormHasRealData({ dieType: "7 inch" })).toBe(true);
    expect(runFormHasRealData({ doughRecipeName: "Classic" })).toBe(true);
    expect(runFormHasRealData({ frontlineRecipeName: "Red Sauce" })).toBe(true);
    expect(runFormHasRealData({ pep2Type: "Cup" })).toBe(true);
  });

  it("is true when a case target has been entered", () => {
    expect(runFormHasRealData({ casesNeeded: 120 })).toBe(true);
    expect(runFormHasRealData({ casesNeeded: 0 })).toBe(false);
  });
});

describe("decideSetupJump", () => {
  const blank = { casesNeeded: 0, doughRecipe: [], app1Type: "" };
  const base = {
    currentBrand: "",
    currentFlavor: "",
    currentStarted: false,
    currentEnded: false,
    currentValues: blank as ProfileLike,
    runCount: 1,
    maxRuns: 30,
  };

  it("reuses the current run only when it is truly blank", () => {
    expect(decideSetupJump(base)).toBe("reuse-current");
  });

  it("never reuses a run that already has an identity", () => {
    expect(decideSetupJump({ ...base, currentBrand: "Acme" })).toBe("new-run");
    expect(decideSetupJump({ ...base, currentFlavor: "Cheese" })).toBe("new-run");
    // Whitespace-only identity is still blank
    expect(decideSetupJump({ ...base, currentBrand: "  " })).toBe("reuse-current");
  });

  it("never reuses a started or ended run — even an unnamed one", () => {
    expect(decideSetupJump({ ...base, currentStarted: true })).toBe("new-run");
    expect(decideSetupJump({ ...base, currentEnded: true })).toBe("new-run");
    expect(decideSetupJump({ ...base, currentStarted: true, currentEnded: true })).toBe("new-run");
  });

  it("never reuses a run whose form carries real data", () => {
    expect(
      decideSetupJump({ ...base, currentValues: { doughRecipe: [{ ingredient: "Flour" }] } }),
    ).toBe("new-run");
    expect(decideSetupJump({ ...base, currentValues: { app2Type: "Cheddar" } })).toBe("new-run");
    expect(decideSetupJump({ ...base, currentValues: { casesNeeded: 50 } })).toBe("new-run");
  });

  it("falls back to at-cap instead of clobbering when the day is full", () => {
    const configured = { ...base, currentBrand: "Acme", runCount: 30 };
    expect(decideSetupJump(configured)).toBe("at-cap");
    // One slot free → new run is fine
    expect(decideSetupJump({ ...configured, runCount: 29 })).toBe("new-run");
    // A blank current run is reusable even at the cap (no new run needed)
    expect(decideSetupJump({ ...base, runCount: 30 })).toBe("reuse-current");
  });
});
