/**
 * Unit tests for the null-match guard in commitSauceGuideImport /
 * commitDoughGuideImport.
 *
 * The guard refuses to apply a row when BOTH wasNullBrand AND wasNullRecipe
 * are true — meaning neither the brand nor the recipe had a confident match.
 * Applying such a row would silently write a wrong recipe to every brand
 * profile.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { commitSauceGuideImport, commitDoughGuideImport } from "./recipeGuideImport";

// jsdom localStorage is available but empty by default.
// Clear it before each test so tests are isolated.
beforeEach(() => {
  localStorage.clear();
});

// ─── commitSauceGuideImport ───────────────────────────────────────────────────

describe("commitSauceGuideImport — null-match guard", () => {
  it("skips a row where both wasNullBrand and wasNullRecipe are true", () => {
    const result = commitSauceGuideImport([
      {
        brand: "Acme",
        flavors: [],
        recipeName: "Mystery Sauce",
        ozPerPizza: 3.5,
        wasNullBrand: true,
        wasNullRecipe: true,
      },
    ]);
    expect(result.rowsApplied).toBe(0);
    expect(result.profilesUpdated).toBe(0);
    expect(result.rowsSkippedBothUnmatched).toBe(1);
  });

  it("applies a row where brand was matched (wasNullBrand false) even if recipe was not matched", () => {
    const result = commitSauceGuideImport([
      {
        brand: "Acme",
        flavors: [],
        recipeName: "Mystery Sauce",
        ozPerPizza: 3.5,
        wasNullBrand: false,
        wasNullRecipe: true,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });

  it("applies a row where recipe was matched (wasNullRecipe false) even if brand was not matched", () => {
    const result = commitSauceGuideImport([
      {
        brand: "Acme",
        flavors: [],
        recipeName: "House Red",
        ozPerPizza: 4,
        wasNullBrand: true,
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });

  it("applies a row where both were matched", () => {
    const result = commitSauceGuideImport([
      {
        brand: "Acme",
        flavors: [],
        recipeName: "House Red",
        ozPerPizza: 3,
        wasNullBrand: false,
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });

  it("counts multiple skipped rows correctly", () => {
    const result = commitSauceGuideImport([
      {
        brand: "Acme",
        flavors: [],
        recipeName: "Mystery Sauce",
        ozPerPizza: 3.5,
        wasNullBrand: true,
        wasNullRecipe: true,
      },
      {
        brand: "Bizco",
        flavors: [],
        recipeName: "Unknown Sauce",
        ozPerPizza: 2.5,
        wasNullBrand: true,
        wasNullRecipe: true,
      },
      {
        brand: "GoodBrand",
        flavors: [],
        recipeName: "Marinara",
        ozPerPizza: 4,
        wasNullBrand: false,
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(2);
  });

  it("still skips a both-null row even when brand string is non-empty (manually resolved UI value)", () => {
    // The flags represent the ORIGINAL match state, not whether the manager
    // subsequently typed something in.  A row flagged wasNullBrand+wasNullRecipe
    // must be refused regardless of what brand/recipe strings are present.
    const result = commitSauceGuideImport([
      {
        brand: "Manually Typed Brand",
        flavors: [],
        recipeName: "Manually Typed Recipe",
        ozPerPizza: 3.5,
        wasNullBrand: true,
        wasNullRecipe: true,
      },
    ]);
    expect(result.rowsApplied).toBe(0);
    expect(result.rowsSkippedBothUnmatched).toBe(1);
  });

  it("does not count a skipped-due-to-empty-brand row as rowsSkippedBothUnmatched", () => {
    const result = commitSauceGuideImport([
      {
        brand: "",          // filtered by the existing empty-brand guard
        flavors: [],
        recipeName: "House Red",
        ozPerPizza: 3,
        wasNullBrand: false,
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(0);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });
});

// ─── commitDoughGuideImport ───────────────────────────────────────────────────

describe("commitDoughGuideImport — null-match guard", () => {
  it("skips a row where both wasNullBrand and wasNullRecipe are true", () => {
    const result = commitDoughGuideImport([
      {
        brand: "Acme",
        flavors: [],
        doughRecipeName: "Unknown Dough",
        wasNullBrand: true,
        wasNullRecipe: true,
      },
    ]);
    expect(result.rowsApplied).toBe(0);
    expect(result.profilesUpdated).toBe(0);
    expect(result.rowsSkippedBothUnmatched).toBe(1);
  });

  it("applies a row where brand was matched even if recipe was not", () => {
    const result = commitDoughGuideImport([
      {
        brand: "Acme",
        flavors: [],
        doughRecipeName: "Unknown Dough",
        wasNullBrand: false,
        wasNullRecipe: true,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });

  it("applies a row where recipe was matched even if brand was not", () => {
    const result = commitDoughGuideImport([
      {
        brand: "Acme",
        flavors: [],
        doughRecipeName: "CRB Thin",
        wasNullBrand: true,
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });

  it("applies a row where both were matched", () => {
    const result = commitDoughGuideImport([
      {
        brand: "Acme",
        flavors: [],
        doughRecipeName: "CRB Thin",
        wasNullBrand: false,
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });

  it("counts multiple skipped rows correctly", () => {
    const result = commitDoughGuideImport([
      {
        brand: "Acme",
        flavors: [],
        doughRecipeName: "Unknown Dough A",
        wasNullBrand: true,
        wasNullRecipe: true,
      },
      {
        brand: "Bizco",
        flavors: [],
        doughRecipeName: "Unknown Dough B",
        wasNullBrand: true,
        wasNullRecipe: true,
      },
      {
        brand: "GoodBrand",
        flavors: [],
        doughRecipeName: "CRB Thick",
        wasNullBrand: false,
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(1);
    expect(result.rowsSkippedBothUnmatched).toBe(2);
  });

  it("returns zero rowsSkippedBothUnmatched when all rows have at least one confident match", () => {
    const result = commitDoughGuideImport([
      {
        brand: "Acme",
        flavors: [],
        doughRecipeName: "CRB Thin",
        wasNullBrand: false,
        wasNullRecipe: false,
      },
      {
        brand: "Bizco",
        flavors: [],
        doughRecipeName: "Alt Dough",
        wasNullBrand: true,   // brand not matched but recipe was
        wasNullRecipe: false,
      },
    ]);
    expect(result.rowsApplied).toBe(2);
    expect(result.rowsSkippedBothUnmatched).toBe(0);
  });
});
