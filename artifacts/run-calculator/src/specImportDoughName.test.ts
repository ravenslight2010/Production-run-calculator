// @vitest-environment jsdom
//
// Spec-sheet dough NAME apply contract (mirror of specImportSauceName.test.ts).
// A spec sheet can name a product's dough/crust (e.g. "Ultra Thin Dough") even
// when no dough mixing recipe exists yet. applySpecImport must
// (a) set it as the profile's doughRecipeName when nothing is there yet,
// (b) never clobber an existing mixed dough recipe or a name the user set,
// (c) register the name as a selectable Dough Recipe option, and
// (d) when the actual dough recipe imports LATER, re-link its rows/weight onto
//     every already-saved profile pointing at that name (loose-key match) —
//     that re-link is the whole point of capturing the type up front.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applySpecImport,
  loadProfile,
  saveProfile,
  loadList,
  loadBrandFlavors,
  saveBrandFlavors,
  DEFAULT_VALUES,
  tombstoneDeleted,
  loadDeletedItems,
  loadMergedAway,
  saveMergedAway,
} from "./storage";
import { DOUGH_RECIPE_NAMES_KEY } from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";

beforeEach(() => {
  localStorage.clear();
});

function importWithDough(doughName: string): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: "Corner Booth",
        flavor: "BBQ CHICKEN",
        doughName,
        applicators: [{ type: "Chicken", ozPerPizza: 3 }],
        pepperonis: [],
      },
    ],
    recipes: [],
  };
}

describe("applySpecImport named dough (no recipe yet)", () => {
  it("sets the profile's doughRecipeName when the profile has no dough yet", () => {
    applySpecImport(importWithDough("Ultra Thin Dough"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.doughRecipeName).toBe("Ultra Thin Dough");
  });

  it("registers the dough name as a Dough Recipe dropdown option", () => {
    applySpecImport(importWithDough("Ultra Thin Dough"));
    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toContain("Ultra Thin Dough");
  });

  it("does NOT clobber an existing mixed dough recipe, but still registers the option", () => {
    saveProfile("Corner Booth", "BBQ CHICKEN", {
      ...DEFAULT_VALUES,
      // dieType makes the profile "real" — a dough-only profile is
      // intentionally never persisted (ghost-profile guard).
      dieType: "12 inch",
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
    });
    applySpecImport(importWithDough("Ultra Thin Dough"));
    const prof = loadProfile("Corner Booth", "BBQ CHICKEN");
    expect(prof?.doughRecipeName).toBe("House Dough");
    expect(prof?.doughRecipe).toEqual([{ ingredient: "Flour", lbs: 50 }]);
    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toContain("Ultra Thin Dough");
  });

  it("clears delete + merge tombstones so the sync receive-side filters can't strip the name back out", () => {
    tombstoneDeleted("doughRecipeNames", "Ultra Thin Dough");
    saveMergedAway(["Ultra Thin Dough"]);
    applySpecImport(importWithDough("Ultra Thin Dough"));
    expect(loadDeletedItems()["doughRecipeNames"] ?? []).not.toContain("ultra thin dough");
    expect(loadMergedAway()).not.toContain("Ultra Thin Dough");
    expect(loadList(DOUGH_RECIPE_NAMES_KEY, [])).toContain("Ultra Thin Dough");
  });
});

describe("later dough recipe import re-links by name", () => {
  const DOUGH_ROWS = [
    { ingredient: "Flour", lbs: 100 },
    { ingredient: "Water", lbs: 60 },
  ];

  it("attaches the recipe's rows/weight to every saved profile whose doughRecipeName matches (loose key)", () => {
    // Step 1: spec import assigns only the dough TYPE to two products of
    // DIFFERENT brands (so the same-brand fallback can't explain the tie).
    applySpecImport(importWithDough("Ultra Thin Dough"));
    // The re-link pass walks the brand/flavor registry, and dough-only
    // profiles are never persisted (ghost-profile guard) — so the second
    // product is registered and carries a dieType, as any real profile would.
    saveBrandFlavors({ ...loadBrandFlavors(), Lowes: ["Pepperoni"] });
    saveProfile("Lowes", "Pepperoni", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
      // Loose-key variant spelling — the re-link must match it anyway and
      // canonicalize onto the recipe's name.
      doughRecipeName: "ultra-thin dough",
    });

    // Step 2: a later import carries the actual dough recipe under a third
    // brand with no explicit targets.
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Ultra Thin Dough",
          brand: "Silverline",
          flavor: "",
          rows: DOUGH_ROWS,
          doughballOz: 12,
        },
      ],
    } as unknown as ParsedSpecImport);

    for (const [brand, flavor] of [
      ["Corner Booth", "BBQ CHICKEN"],
      ["Lowes", "Pepperoni"],
    ] as const) {
      const prof = loadProfile(brand, flavor);
      expect(prof?.doughRecipeName, `${brand}/${flavor}`).toBe("Ultra Thin Dough");
      expect(prof?.doughRecipe, `${brand}/${flavor}`).toEqual(DOUGH_ROWS);
      expect(prof?.targetDoughballWeight, `${brand}/${flavor}`).toBe(12);
    }
  });

  it("does not touch saved profiles pointing at a DIFFERENT dough name", () => {
    saveBrandFlavors({ ...loadBrandFlavors(), Lowes: ["Cheese"] });
    saveProfile("Lowes", "Cheese", {
      ...DEFAULT_VALUES,
      dieType: "12 inch",
      doughRecipeName: "Sourdough Base",
    });
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Ultra Thin Dough",
          brand: "Silverline",
          flavor: "",
          rows: DOUGH_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    const prof = loadProfile("Lowes", "Cheese");
    expect(prof?.doughRecipeName).toBe("Sourdough Base");
    expect((prof?.doughRecipe ?? []).length).toBe(0);
  });

  it("re-links a SAUCE recipe onto saved profiles whose frontlineRecipeName matches", () => {
    saveBrandFlavors({ ...loadBrandFlavors(), Lowes: ["Pepperoni"] });
    saveProfile("Lowes", "Pepperoni", {
      ...DEFAULT_VALUES,
      frontlineRecipeName: "Hot Buffalo Sauce",
    });
    const SAUCE_ROWS = [{ ingredient: "Tomato", lbs: 30 }];
    applySpecImport({
      profiles: [],
      recipes: [
        {
          kind: "sauce",
          name: "Hot Buffalo Sauce",
          brand: "Silverline",
          flavor: "",
          rows: SAUCE_ROWS,
        },
      ],
    } as unknown as ParsedSpecImport);
    const prof = loadProfile("Lowes", "Pepperoni");
    expect(prof?.frontlineRecipeName).toBe("Hot Buffalo Sauce");
    expect(prof?.frontlineRecipe).toEqual(SAUCE_ROWS);
  });
});
