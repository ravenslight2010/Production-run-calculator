// @vitest-environment jsdom
//
// Spec-sheet import mix routing. The AI importer only knows dough/sauce/cheese,
// so pre-blended topping mixes ("White Fajita Mix") arrive as kind:"cheese".
// applySpecImport must register such a name under the MIX category (with its
// ingredient rows in the shared preset map) instead of Cheese: (a) names with
// the standalone word "mix" that don't mention cheese, (b) names already in the
// user Mix list — while genuine cheese recipes ("Aldo's Cheese Mix", "Cheese
// Blend") keep landing under Cheese. Applicator-slot profile ties are identical
// for both categories.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applySpecImport,
  specImportCheeseRecipeIsMix,
  loadCheeseRecipePresets,
  loadProfile,
  loadList,
  saveList,
  loadDeletedItems,
  tombstoneDeleted,
} from "./storage";
import { CHEESE_RECIPE_NAMES_KEY, MIX_RECIPE_NAMES_KEY, CHEESE_INGREDIENTS_KEY } from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";

beforeEach(() => {
  localStorage.clear();
});

function importWithCheeseKindRecipe(name: string): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: "Corner Booth",
        flavor: "FAJITA",
        applicators: [{ type: "Blend", ozPerPizza: 3 }],
        pepperonis: [],
      },
    ],
    recipes: [
      {
        kind: "cheese",
        name,
        brand: "Corner Booth",
        flavor: "FAJITA",
        app: 1,
        rows: [
          { ingredient: "Monterey Jack", lbs: 20 },
          { ingredient: "Green Peppers", lbs: 5 },
        ],
      },
    ],
  };
}

describe("specImportCheeseRecipeIsMix", () => {
  const none = new Set<string>();
  it("classifies standalone-word 'mix' names without 'cheese' as mixes (2+ ingredients)", () => {
    expect(specImportCheeseRecipeIsMix("White Fajita Mix", none, 2)).toBe(true);
    expect(specImportCheeseRecipeIsMix("Garlic Chicken Mix", none, 5)).toBe(true);
    expect(specImportCheeseRecipeIsMix("Club Mix (With Chicken)", none, 3)).toBe(true);
  });
  it("keeps cheese-mentioning and non-mix names as cheese", () => {
    expect(specImportCheeseRecipeIsMix("Aldo's Cheese Mix", none, 3)).toBe(false);
    expect(specImportCheeseRecipeIsMix("Cheese Blend", none, 3)).toBe(false);
    expect(specImportCheeseRecipeIsMix("Premixed Blend", none, 3)).toBe(false);
    expect(specImportCheeseRecipeIsMix("", none, 3)).toBe(false);
  });
  it("does NOT make a mix out of a single-ingredient recipe, whatever its label", () => {
    expect(specImportCheeseRecipeIsMix("White Fajita Mix", none, 1)).toBe(false);
    expect(specImportCheeseRecipeIsMix("Garlic Chicken Mix", none, 0)).toBe(false);
  });
  it("treats any name already in the user Mix list as a mix (even single-ingredient)", () => {
    const userMixes = new Set(["lucia's morning melt parisian"]);
    expect(specImportCheeseRecipeIsMix("Lucia's Morning Melt Parisian", userMixes, 2)).toBe(true);
    expect(specImportCheeseRecipeIsMix("Lucia's Morning Melt Parisian", userMixes, 1)).toBe(true);
  });
});

describe("applySpecImport mix routing", () => {
  it("registers a mix-named recipe under Mix (not Cheese) with its ingredients in the shared preset map", () => {
    applySpecImport(importWithCheeseKindRecipe("White Fajita Mix"));
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).toContain("White Fajita Mix");
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).not.toContain("White Fajita Mix");
    expect(loadCheeseRecipePresets()["White Fajita Mix"]).toEqual([
      { ingredient: "Monterey Jack", lbs: 20 },
      { ingredient: "Green Peppers", lbs: 5 },
    ]);
  });

  it("still ties the mix to the profile's applicator slot like a cheese recipe", () => {
    applySpecImport(importWithCheeseKindRecipe("White Fajita Mix"));
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    expect(prof?.app1CheeseRecipeName).toBe("White Fajita Mix");
    expect(prof?.app1CheeseRecipe).toEqual([
      { ingredient: "Monterey Jack", lbs: 20 },
      { ingredient: "Green Peppers", lbs: 5 },
    ]);
  });

  it("keeps a genuine cheese recipe under Cheese", () => {
    applySpecImport(importWithCheeseKindRecipe("Aldo's Cheese Mix"));
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toContain("Aldo's Cheese Mix");
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).not.toContain("Aldo's Cheese Mix");
  });

  it("routes a cheese-mentioning name to Mix when the user already keeps it in the Mix list", () => {
    saveList(MIX_RECIPE_NAMES_KEY, ["Aldo's Cheese Mix"]);
    applySpecImport(importWithCheeseKindRecipe("Aldo's Cheese Mix"));
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).toContain("Aldo's Cheese Mix");
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).not.toContain("Aldo's Cheese Mix");
  });

  it("clears the MIX deletion tombstone (not cheese) so sync can't strip the re-imported name", () => {
    tombstoneDeleted("mixRecipeNames", "White Fajita Mix");
    applySpecImport(importWithCheeseKindRecipe("White Fajita Mix"));
    const deleted = loadDeletedItems();
    expect(deleted["mixRecipeNames"] ?? []).not.toContain("white fajita mix");
  });

  it("files a single-ingredient 'mix'-named recipe under Cheese, not Mix", () => {
    const parsed = importWithCheeseKindRecipe("Diced Red Fajita Mix");
    parsed.recipes[0].rows = [{ ingredient: "Diced Red Peppers", lbs: 12 }];
    applySpecImport(parsed);
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toContain("Diced Red Fajita Mix");
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).not.toContain("Diced Red Fajita Mix");
  });

  it("does not cross-populate name lists when one import carries both a cheese recipe and a mix", () => {
    const parsed = importWithCheeseKindRecipe("White Fajita Mix");
    parsed.recipes.push({
      kind: "cheese",
      name: "Cheese Blend",
      brand: "Corner Booth",
      flavor: "FAJITA",
      app: 2,
      rows: [{ ingredient: "Mozzarella", lbs: 30 }],
    });
    applySpecImport(parsed);
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).toEqual(["White Fajita Mix"]);
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toEqual(["Cheese Blend"]);
    expect(loadCheeseRecipePresets()["Cheese Blend"]).toEqual([
      { ingredient: "Mozzarella", lbs: 30 },
    ]);
  });

  it("registers the mix's ingredients into the cheese ingredient pool", () => {
    applySpecImport(importWithCheeseKindRecipe("White Fajita Mix"));
    const cheeseIng = loadList(CHEESE_INGREDIENTS_KEY, []);
    expect(cheeseIng).toContain("Monterey Jack");
    expect(cheeseIng).toContain("Green Peppers");
  });
});
