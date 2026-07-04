// @vitest-environment jsdom
//
// Spec-sheet import "reuse existing recipe" (TASK #108, web-only). When a review
// item is marked referenceOnly it means the user picked one of their EXISTING
// saved recipes instead of creating one from the sheet. applySpecImport must:
//   (1) NOT overwrite the saved recipe (its rows stay exactly as-is),
//   (2) NOT register a duplicate name / re-add ingredients,
//   (3) still tie the EXISTING recipe's rows onto the import's profile.
// The picker helpers (existingRecipeNamesForImport / existingDieTypesForImport)
// only offer real, saved targets.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applySpecImport,
  saveDoughRecipePresets,
  loadDoughRecipePresets,
  saveFrontlineRecipePresets,
  saveCheeseRecipePresets,
  loadProfile,
  loadList,
  saveList,
  existingRecipeNamesForImport,
  existingDieTypesForImport,
} from "./storage";
import {
  DOUGH_RECIPE_NAMES_KEY,
  DOUGH_INGREDIENTS_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  MIX_RECIPE_NAMES_KEY,
  DIE_TYPES_KEY,
} from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";

beforeEach(() => {
  localStorage.clear();
});

describe("applySpecImport referenceOnly recipes", () => {
  it("keeps the existing dough recipe rows and does not overwrite from the sheet", () => {
    saveDoughRecipePresets({ "House Dough": { rows: [{ ingredient: "Flour", lbs: 50 }] } });
    saveList(DOUGH_RECIPE_NAMES_KEY, ["House Dough"]);

    const imp: ParsedSpecImport = {
      profiles: [{ brand: "Corner Booth", flavor: "PLAIN", applicators: [], pepperonis: [] }],
      recipes: [
        {
          kind: "dough",
          name: "House Dough",
          brand: "Corner Booth",
          flavor: "PLAIN",
          referenceOnly: true,
          // Sheet rows are intentionally DIFFERENT — must be ignored.
          rows: [{ ingredient: "Flour", lbs: 999 }, { ingredient: "Water", lbs: 30 }],
        },
      ],
    };
    applySpecImport(imp);

    // Library recipe untouched.
    expect(loadDoughRecipePresets()["House Dough"]).toEqual({ rows: [{ ingredient: "Flour", lbs: 50 }] });
    // No duplicate ingredient registered from the sheet.
    expect(loadList(DOUGH_INGREDIENTS_KEY, [])).not.toContain("Water");
  });

  it("ties the EXISTING recipe rows (not the sheet rows) onto the profile", () => {
    saveDoughRecipePresets({ "House Dough": { rows: [{ ingredient: "Flour", lbs: 50 }] } });
    saveList(DOUGH_RECIPE_NAMES_KEY, ["House Dough"]);

    const imp: ParsedSpecImport = {
      profiles: [{ brand: "Corner Booth", flavor: "PLAIN", applicators: [], pepperonis: [] }],
      recipes: [
        {
          kind: "dough",
          name: "House Dough",
          brand: "Corner Booth",
          flavor: "PLAIN",
          referenceOnly: true,
          rows: [{ ingredient: "Flour", lbs: 999 }],
        },
      ],
    };
    applySpecImport(imp);

    const prof = loadProfile("Corner Booth", "PLAIN") as Record<string, unknown> | null;
    expect(prof?.doughRecipeName).toBe("House Dough");
    expect(prof?.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 50 }]);
  });

  it("skips the profile tie (no empty recipe) when the linked recipe no longer exists", () => {
    const imp: ParsedSpecImport = {
      profiles: [{ brand: "Corner Booth", flavor: "PLAIN", applicators: [], pepperonis: [] }],
      recipes: [
        {
          kind: "dough",
          name: "Ghost Dough",
          brand: "Corner Booth",
          flavor: "PLAIN",
          referenceOnly: true,
          rows: [{ ingredient: "Flour", lbs: 5 }],
        },
      ],
    };
    applySpecImport(imp);

    const prof = loadProfile("Corner Booth", "PLAIN") as Record<string, unknown> | null;
    // Profile is created (from the import) but no empty dough recipe is attached.
    expect(prof?.doughRecipeName ?? "").toBe("");
    expect(prof?.doughRecipe ?? []).toEqual([]);
  });

  it("does not add a new name to the recipe name list for a reused recipe", () => {
    saveDoughRecipePresets({ "House Dough": { rows: [{ ingredient: "Flour", lbs: 50 }] } });
    saveList(DOUGH_RECIPE_NAMES_KEY, ["House Dough"]);

    applySpecImport({
      profiles: [{ brand: "Corner Booth", flavor: "PLAIN", applicators: [], pepperonis: [] }],
      recipes: [
        {
          kind: "dough",
          name: "House Dough",
          brand: "Corner Booth",
          flavor: "PLAIN",
          referenceOnly: true,
          rows: [{ ingredient: "Flour", lbs: 999 }],
        },
      ],
    });

    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toEqual(["House Dough"]);
  });
});

describe("existingRecipeNamesForImport", () => {
  it("lists only saved dough recipe names, sorted", () => {
    saveDoughRecipePresets({
      Zeta: { rows: [{ ingredient: "A", lbs: 1 }] },
      Alpha: { rows: [{ ingredient: "B", lbs: 1 }] },
    });
    expect(existingRecipeNamesForImport("dough")).toEqual(["Alpha", "Zeta"]);
  });

  it("lists only saved sauce recipe names", () => {
    saveFrontlineRecipePresets({ "Red Sauce": [{ ingredient: "Tomato", lbs: 10 }] });
    expect(existingRecipeNamesForImport("sauce")).toEqual(["Red Sauce"]);
  });

  it("splits cheese vs mix by which name list the name lives in", () => {
    saveCheeseRecipePresets({
      "Mozz Blend": [{ ingredient: "Mozzarella", lbs: 20 }],
      "White Fajita Mix": [{ ingredient: "Jack", lbs: 10 }],
    });
    saveList(CHEESE_RECIPE_NAMES_KEY, ["Mozz Blend"]);
    saveList(MIX_RECIPE_NAMES_KEY, ["White Fajita Mix"]);

    expect(existingRecipeNamesForImport("cheese")).toEqual(["Mozz Blend"]);
    expect(existingRecipeNamesForImport("mix")).toEqual(["White Fajita Mix"]);
  });

  it("omits names that have no saved ingredient rows", () => {
    saveList(CHEESE_RECIPE_NAMES_KEY, ["Ghost Cheese"]);
    expect(existingRecipeNamesForImport("cheese")).toEqual([]);
  });
});

describe("existingDieTypesForImport", () => {
  it("returns saved die types, unique and sorted", () => {
    saveList(DIE_TYPES_KEY, ["Zeta Die", "Alpha Die", "Zeta Die"]);
    const dies = existingDieTypesForImport();
    expect(dies).toEqual(["Alpha Die", "Zeta Die"]);
    // Unique.
    expect(new Set(dies).size).toBe(dies.length);
  });
});
