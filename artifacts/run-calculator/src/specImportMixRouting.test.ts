// @vitest-environment jsdom
//
// Spec-sheet import mix routing. The AI importer only knows dough/sauce/cheese,
// so pre-blended topping mixes ("White Fajita Mix") arrive as kind:"cheese".
// applySpecImport must register such a name under the MIX category (with its
// ingredient rows in the shared preset map) instead of Cheese: (a) names with
// the standalone word "mix" that don't mention cheese, (b) names already in the
// user Mix list — while genuine cheese recipes ("Aldo's Cheese Mix", "Cheese
// Blend") keep landing under Cheese. Mix-routed recipes must NOT be tied onto
// the profile's cheese applicator slots: mixes are Mixes-screen master-data
// (per-pizza oz), and writing them to app{n}CheeseRecipeName made a recipe the
// user reclassified to "mix" still show up as cheese on the run's Cheese card.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applySpecImport,
  specImportCheeseRecipeIsMix,
  specImportRecipeDisplayKind,
  loadCheeseRecipePresets,
  loadProfile,
  loadList,
  saveList,
  loadDeletedItems,
  tombstoneDeleted,
} from "./storage";
import {
  CHEESE_RECIPE_NAMES_KEY,
  MIX_RECIPE_NAMES_KEY,
  CHEESE_INGREDIENTS_KEY,
  INGREDIENT_TYPES_KEY,
} from "./types";
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
    // "blend" (like "mix") marks a multi-ingredient non-cheese name as a mix.
    expect(specImportCheeseRecipeIsMix("Premixed Blend", none, 3)).toBe(true);
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
  it("defaults a multi-ingredient blend with NO cheese-ish component to mix (no mix/blend word needed)", () => {
    expect(
      specImportCheeseRecipeIsMix("Italian Beef & Gravy", none, 2, ["Italian Beef", "Gravy"]),
    ).toBe(true);
    // Any cheese-ish component keeps it under Cheese.
    expect(
      specImportCheeseRecipeIsMix("Gyro Topping", none, 2, ["Gyro Meat", "Feta"]),
    ).toBe(false);
    // A cheese-mentioning NAME still never routes to mix.
    expect(
      specImportCheeseRecipeIsMix("Cheese Topping", none, 2, ["Beef", "Gravy"]),
    ).toBe(false);
    // Without component names the old behavior is unchanged.
    expect(specImportCheeseRecipeIsMix("Italian Beef & Gravy", none, 2)).toBe(false);
  });
});

describe("specImportRecipeDisplayKind", () => {
  it("returns the parse kind for dough/sauce and heuristic-based mix/cheese for cheese", () => {
    const rows = [
      { ingredient: "A", lbs: 1 },
      { ingredient: "B", lbs: 2 },
    ];
    expect(specImportRecipeDisplayKind({ kind: "dough", name: "Thin Crust", rows })).toBe("dough");
    expect(specImportRecipeDisplayKind({ kind: "cheese", name: "White Fajita Mix", rows })).toBe("mix");
    expect(specImportRecipeDisplayKind({ kind: "cheese", name: "Cheese Blend", rows })).toBe("cheese");
  });

  it("forcedCategory beats both the heuristic and the user Mix list", () => {
    saveList(MIX_RECIPE_NAMES_KEY, ["cheese blend"]);
    const rows = [
      { ingredient: "A", lbs: 1 },
      { ingredient: "B", lbs: 2 },
    ];
    expect(
      specImportRecipeDisplayKind({ kind: "cheese", name: "Cheese Blend", forcedCategory: "cheese", rows }),
    ).toBe("cheese");
    expect(
      specImportRecipeDisplayKind({ kind: "cheese", name: "Cheese Blend", forcedCategory: "mix", rows }),
    ).toBe("mix");
    // No override: a cheese-mentioning name stays cheese even when a junk
    // same-named entry sits in the user Mix list (crossover-poison guard).
    expect(specImportRecipeDisplayKind({ kind: "cheese", name: "Cheese Blend", rows })).toBe("cheese");
  });

  it("defaults a cheese-kind blend with no cheese-ish component to mix, keeping override + userNamed guards", () => {
    const meatRows = [
      { ingredient: "Italian Beef", lbs: 0 },
      { ingredient: "Gravy", lbs: 0 },
    ];
    expect(
      specImportRecipeDisplayKind({ kind: "cheese", name: "Italian Beef & Gravy", rows: meatRows }),
    ).toBe("mix");
    // Review-time override stays authoritative.
    expect(
      specImportRecipeDisplayKind({
        kind: "cheese",
        name: "Italian Beef & Gravy",
        forcedCategory: "cheese",
        rows: meatRows,
      }),
    ).toBe("cheese");
    // A user-typed rename never re-categorizes.
    expect(
      specImportRecipeDisplayKind({
        kind: "cheese",
        name: "Italian Beef & Gravy",
        userNamed: true,
        rows: meatRows,
      }),
    ).toBe("cheese");
    // Cheese-ish components keep it cheese.
    expect(
      specImportRecipeDisplayKind({
        kind: "cheese",
        name: "Gyro Topping",
        rows: [
          { ingredient: "Gyro Meat", lbs: 0 },
          { ingredient: "Feta", lbs: 0 },
        ],
      }),
    ).toBe("cheese");
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

  it("does NOT tie a mix onto the profile's cheese applicator slot", () => {
    applySpecImport(importWithCheeseKindRecipe("White Fajita Mix"));
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    expect(prof?.app1CheeseRecipeName ?? "").toBe("");
    expect(prof?.app1CheeseRecipe ?? []).toEqual([]);
  });

  it("does NOT tie a recipe the user reclassified to 'mix' onto the cheese slot", () => {
    // The user's review pick (forcedCategory) must win end-to-end: no cheese
    // card tie, name under Mix, not Cheese.
    const parsed = importWithCheeseKindRecipe("Aldo's Cheese Mix");
    parsed.recipes[0].forcedCategory = "mix";
    applySpecImport(parsed);
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    expect(prof?.app1CheeseRecipeName ?? "").toBe("");
    expect(prof?.app1CheeseRecipe ?? []).toEqual([]);
  });

  it("still ties a genuine cheese recipe onto the profile's applicator slot", () => {
    applySpecImport(importWithCheeseKindRecipe("Cheese Blend"));
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    expect(prof?.app1CheeseRecipeName).toBe("Cheese Blend");
    expect(prof?.app1CheeseRecipe).toEqual([
      { ingredient: "Monterey Jack", lbs: 20 },
      { ingredient: "Green Peppers", lbs: 5 },
    ]);
  });

  it("keeps a USER-RENAMED cheese recipe's typed name verbatim on the profile tie", () => {
    const parsed = importWithCheeseKindRecipe("My Special Blend 2");
    parsed.recipes[0].userNamed = true;
    applySpecImport(parsed);
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    // Without the userNamed flag the tie-time cleaner would strip the trailing
    // "2"; the user's typed name must survive exactly.
    expect(prof?.app1CheeseRecipeName).toBe("My Special Blend 2");
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toContain("My Special Blend 2");
  });

  it("keeps a genuine cheese recipe under Cheese", () => {
    applySpecImport(importWithCheeseKindRecipe("Aldo's Cheese Mix"));
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toContain("Aldo's Cheese Mix");
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).not.toContain("Aldo's Cheese Mix");
  });

  it("keeps a cheese-mentioning name as CHEESE even when a junk same-named entry sits in the Mix list", () => {
    // A past misroute can leave a cheese blend duplicated into the Mixes pool;
    // honoring that entry would flip the blend to "Mix" forever. The cheese
    // word wins: the recipe lands under Cheese and ties onto the cheese slot.
    saveList(MIX_RECIPE_NAMES_KEY, ["Aldo's Cheese Mix"]);
    applySpecImport(importWithCheeseKindRecipe("Aldo's Cheese Mix"));
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toContain("Aldo's Cheese Mix");
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    expect(prof?.app1CheeseRecipeName).toBe("Aldo's Cheese Mix");
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

  it("forcedCategory:'mix' overrides the heuristic: a cheese-looking name routes to Mix", () => {
    const parsed = importWithCheeseKindRecipe("Aldo's Cheese Mix");
    parsed.recipes[0].forcedCategory = "mix";
    applySpecImport(parsed);
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).toContain("Aldo's Cheese Mix");
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).not.toContain("Aldo's Cheese Mix");
  });

  it("forcedCategory:'cheese' overrides the heuristic AND the user Mix list", () => {
    saveList(MIX_RECIPE_NAMES_KEY, ["white fajita mix"]);
    const parsed = importWithCheeseKindRecipe("White Fajita Mix");
    parsed.recipes[0].forcedCategory = "cheese";
    applySpecImport(parsed);
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toContain("White Fajita Mix");
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).not.toContain("White Fajita Mix");
  });

  it("places a mix onto an applicator slot typed with the mix's name: 'Mix' type + name link + rows", () => {
    const parsed = importWithCheeseKindRecipe("White Fajita Mix");
    parsed.profiles[0].applicators = [{ type: "White Fajita Mix", ozPerPizza: 3 }];
    applySpecImport(parsed);
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    expect(prof?.app1Type).toBe("Mix");
    expect(prof?.app1CheeseRecipeName).toBe("White Fajita Mix");
    expect(prof?.app1CheeseRecipe).toEqual([
      { ingredient: "Monterey Jack", lbs: 20 },
      { ingredient: "Green Peppers", lbs: 5 },
    ]);
    // The raw mix name must NOT leak into the shared Type dropdown.
    expect(loadList(INGREDIENT_TYPES_KEY, [])).not.toContain("White Fajita Mix");
  });

  it("with multiple 'Mix' slots, ties only onto matching-or-blank ones (prelinked other mixes untouched)", () => {
    const parsed = importWithCheeseKindRecipe("White Fajita Mix");
    parsed.profiles[0].applicators = [
      { type: "Mix", ozPerPizza: 2 }, // blank link → filled
      { type: "White Fajita Mix", ozPerPizza: 3 }, // matches → re-typed + filled
    ];
    applySpecImport(parsed);
    const prof = loadProfile("Corner Booth", "FAJITA") as Record<string, unknown> | null;
    expect(prof?.app1Type).toBe("Mix");
    expect(prof?.app1CheeseRecipeName).toBe("White Fajita Mix");
    expect(prof?.app2Type).toBe("Mix");
    expect(prof?.app2CheeseRecipeName).toBe("White Fajita Mix");
  });

  it("registers the mix's ingredients into the cheese ingredient pool", () => {
    applySpecImport(importWithCheeseKindRecipe("White Fajita Mix"));
    const cheeseIng = loadList(CHEESE_INGREDIENTS_KEY, []);
    expect(cheeseIng).toContain("Monterey Jack");
    expect(cheeseIng).toContain("Green Peppers");
  });
});
