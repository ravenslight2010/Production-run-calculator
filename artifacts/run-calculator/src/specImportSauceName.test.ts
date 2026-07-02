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
