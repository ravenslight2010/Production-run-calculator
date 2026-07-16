// @vitest-environment jsdom
//
// Ready-made sauce name apply contract. A spec sheet can name a bought sauce
// (e.g. "BBQ Sauce") on a profile with no mixing recipe. applySpecImport must
// (a) set it as the profile's frontlineRecipeName when nothing is there yet,
// (b) never clobber an existing mixed sauce recipe or a name the user set, and
// (c) register the name as a selectable Sauce Recipe option — otherwise the
// import looks like it silently dropped the sauce.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applySpecImport,
  loadProfile,
  saveProfile,
  loadList,
  DEFAULT_VALUES,
  tombstoneDeleted,
  loadDeletedItems,
  loadMergedAway,
  saveMergedAway,
} from "./storage";
import { FRONTLINE_RECIPE_NAMES_KEY } from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";

beforeEach(() => {
  localStorage.clear();
});

function importWithSauce(sauceName: string): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: "Corner Booth",
        flavor: "BBQ CHICKEN",
        sauceOzPerPizza: 4.5,
        sauceName,
        applicators: [{ type: "Chicken", ozPerPizza: 3 }],
        pepperonis: [],
      },
    ],
    recipes: [],
  };
}

describe("applySpecImport ready-made sauce name", () => {
  it("sets the profile's frontlineRecipeName when the profile has no sauce yet", () => {
    applySpecImport(importWithSauce("BBQ Sauce"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.frontlineRecipeName).toBe("BBQ Sauce");
  });

  it("registers the sauce name as a Sauce Recipe dropdown option", () => {
    applySpecImport(importWithSauce("BBQ Sauce"));
    expect(loadList(FRONTLINE_RECIPE_NAMES_KEY, [])).toContain("BBQ Sauce");
  });

  it("does NOT clobber an existing mixed sauce recipe, but still registers the option", () => {
    saveProfile("Corner Booth", "BBQ CHICKEN", {
      ...DEFAULT_VALUES,
      frontlineRecipeName: "House Red Sauce",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 10 }],
    });
    applySpecImport(importWithSauce("BBQ Sauce"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.frontlineRecipeName).toBe("House Red Sauce");
    expect(prof?.frontlineRecipe).toEqual([{ ingredient: "Tomato", lbs: 10 }]);
    expect(loadList(FRONTLINE_RECIPE_NAMES_KEY, [])).toContain("BBQ Sauce");
  });

  it("clears delete + merge tombstones so the sync receive-side filters can't strip the name back out", () => {
    tombstoneDeleted("frontlineRecipeNames", "BBQ Sauce");
    saveMergedAway(["BBQ Sauce"]);
    applySpecImport(importWithSauce("BBQ Sauce"));
    expect(loadDeletedItems()["frontlineRecipeNames"] ?? []).not.toContain("bbq sauce");
    expect(loadMergedAway()).not.toContain("BBQ Sauce");
    expect(loadList(FRONTLINE_RECIPE_NAMES_KEY, [])).toContain("BBQ Sauce");
  });
});

describe("applySpecImport library-row hydration for named dough/sauce", () => {
  it("hydrates frontlineRecipe rows from an existing library sauce when the import carries no sauce recipe", async () => {
    const { saveFrontlineRecipePresets } = await import("./storage");
    saveFrontlineRecipePresets({
      "Lucia Pizza Sauce": [
        { ingredient: "Tomato Paste", lbs: 30 },
        { ingredient: "Water", lbs: 20 },
      ],
    });
    applySpecImport(importWithSauce("Lucia Pizza Sauce"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.frontlineRecipeName).toBe("Lucia Pizza Sauce");
    expect(prof?.frontlineRecipe).toEqual([
      { ingredient: "Tomato Paste", lbs: 30 },
      { ingredient: "Water", lbs: 20 },
    ]);
  });

  it("hydrates doughRecipe rows and doughball weight from an existing library dough", async () => {
    const { saveDoughRecipePresets } = await import("./storage");
    saveDoughRecipePresets({
      "CRB Dough": {
        rows: [{ ingredient: "Flour", lbs: 500 }],
        doughballWeightOz: 11,
      },
    });
    applySpecImport({
      profiles: [
        {
          brand: "Corner Booth",
          flavor: "PEPPERONI",
          doughName: "CRB Dough",
          sauceOzPerPizza: 4,
          applicators: [{ type: "Pepperoni", ozPerPizza: 2 }],
          pepperonis: [],
        },
      ],
      recipes: [],
    });
    const prof = loadProfile("Corner Booth", "PEPPERONI");
    expect(prof?.doughRecipeName).toBe("CRB Dough");
    expect(prof?.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 500 }]);
    expect(prof?.targetDoughballWeight).toBe(11);
  });

  it("does not clobber a profile's existing mixed sauce rows with library rows", () => {
    saveProfile("Corner Booth", "BBQ CHICKEN", {
      ...DEFAULT_VALUES,
      frontlineRecipeName: "Lucia Pizza Sauce",
      frontlineRecipe: [{ ingredient: "Custom Base", lbs: 12 }],
    });
    applySpecImport(importWithSauce("Lucia Pizza Sauce"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.frontlineRecipe).toEqual([{ ingredient: "Custom Base", lbs: 12 }]);
  });
});
