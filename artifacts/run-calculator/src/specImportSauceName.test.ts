// @vitest-environment jsdom
//
// Ready-made sauce name apply contract. A spec sheet can name a bought sauce
// (e.g. "BBQ Sauce") on a profile with no mixing recipe. applySpecImport must
// (a) set it as the profile's frontlineRecipeName when nothing is there yet,
// (b) never clobber an existing mixed sauce recipe or a name the user set, and
// (c) keep a name-only reference out of the recipe picker until real amounts
//     are imported or a manager creates the recipe.

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

  it("keeps a name-only sauce reference out of the Sauce Recipe dropdown", () => {
    applySpecImport(importWithSauce("BBQ Sauce"));
    expect(loadList(FRONTLINE_RECIPE_NAMES_KEY, [])).not.toContain("BBQ Sauce");
  });

  it("does NOT clobber an existing mixed sauce recipe or create an option", () => {
    saveProfile("Corner Booth", "BBQ CHICKEN", {
      ...DEFAULT_VALUES,
      frontlineRecipeName: "House Red Sauce",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 10 }],
    });
    applySpecImport(importWithSauce("BBQ Sauce"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.frontlineRecipeName).toBe("House Red Sauce");
    expect(prof?.frontlineRecipe).toEqual([{ ingredient: "Tomato", lbs: 10 }]);
    expect(loadList(FRONTLINE_RECIPE_NAMES_KEY, [])).not.toContain("BBQ Sauce");
  });

  it("leaves delete + merge tombstones intact because a name-only reference creates no picker option", () => {
    tombstoneDeleted("frontlineRecipeNames", "BBQ Sauce");
    saveMergedAway(["BBQ Sauce"]);
    applySpecImport(importWithSauce("BBQ Sauce"));
    expect(loadDeletedItems()["frontlineRecipeNames"] ?? []).toContain("bbq sauce");
    expect(loadMergedAway()).toContain("BBQ Sauce");
    expect(loadList(FRONTLINE_RECIPE_NAMES_KEY, [])).not.toContain("BBQ Sauce");
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

  it("hydrates rows from the SERVER pool when this device has no local preset", () => {
    applySpecImport(importWithSauce("Lucia Pizza Sauce"), undefined, {
      sauce: [
        {
          name: "Lucia Pizza Sauce",
          components: [
            { ingredient: "Tomato Paste", lbs: 30 },
            { ingredient: "Water", lbs: 20 },
          ],
        },
      ],
    });
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.frontlineRecipeName).toBe("Lucia Pizza Sauce");
    expect(prof?.frontlineRecipe).toEqual([
      { ingredient: "Tomato Paste", lbs: 30 },
      { ingredient: "Water", lbs: 20 },
    ]);
  });

  it("hydrates dough rows + doughball weight from the server pool", () => {
    applySpecImport(
      {
        profiles: [
          {
            brand: "Corner Booth",
            flavor: "BBQ CHICKEN",
            doughName: "CRB Dough",
            sauceOzPerPizza: 4,
            applicators: [{ type: "Chicken", ozPerPizza: 3 }],
            pepperonis: [],
          },
        ],
        recipes: [],
      },
      undefined,
      {
        dough: [
          {
            name: "CRB Dough",
            components: [{ ingredient: "Flour", lbs: 100 }],
            doughballWeightOz: 19,
          },
        ],
      },
    );
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.doughRecipeName).toBe("CRB Dough");
    expect(prof?.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 100 }]);
    expect(prof?.targetDoughballWeight).toBe(19);
  });

  it("snaps a variant spec dough name onto the pool family spelling (no phantom option)", () => {
    applySpecImport(
      {
        profiles: [
          {
            brand: "Corner Booth",
            flavor: "BBQ CHICKEN",
            doughName: '11" CRB recipe',
            sauceOzPerPizza: 4,
            applicators: [{ type: "Chicken", ozPerPizza: 3 }],
            pepperonis: [],
          },
        ],
        recipes: [],
      },
      undefined,
      {
        dough: [
          {
            name: "CRB Dough",
            components: [{ ingredient: "Flour", lbs: 100 }],
            doughballWeightOz: 19,
          },
        ],
      },
    );
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.doughRecipeName).toBe("CRB Dough");
    expect(prof?.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 100 }]);
    expect(loadList("run-calc-dough-recipe-names", [])).not.toContain('11" CRB recipe');
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

  it("uses live pool rows over stale mixed snapshots for an explicit forced correction", () => {
    saveProfile("Corner Booth", "BBQ CHICKEN", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
      frontlineRecipeName: "Mystic Pizza Sauce",
      frontlineRecipe: [{ ingredient: "Wrong Sauce", lbs: 10 }],
      doughRecipeName: "Wrong Dough",
      doughRecipe: [{ ingredient: "Wrong Flour", lbs: 10 }],
    });
    applySpecImport(
      {
        profiles: [{
          brand: "Corner Booth",
          flavor: "BBQ CHICKEN",
          sauceName: "Red Hot Pizza Sauce",
          doughName: "Corner Booth Dough",
          applicators: [],
          pepperonis: [],
        }],
        recipes: [],
      },
      undefined,
      {
        sauce: [{
          name: "Red Hot Pizza Sauce",
          components: [{ ingredient: "Garlic Sauce", lbs: 200 }],
        }],
        dough: [{
          name: "Corner Booth Dough",
          components: [{ ingredient: "Flour", lbs: 100 }],
          doughballWeightOz: 10,
        }],
      },
      undefined,
      new Set(["corner booth\u0000bbq chicken"]),
    );
    const profile = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(profile?.frontlineRecipeName).toBe("Red Hot Pizza Sauce");
    expect(profile?.frontlineRecipe).toEqual([{ ingredient: "Garlic Sauce", lbs: 200 }]);
    expect(profile?.doughRecipeName).toBe("Corner Booth Dough");
    expect(profile?.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 100 }]);
    expect(profile?.targetDoughballWeight).toBe(10);
  });
});
