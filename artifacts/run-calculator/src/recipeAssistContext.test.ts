// Unit coverage for the shared recipe-assistant context builder
// (@workspace/recipe-apply -> buildRecipeAssistContext). The web and mobile
// apps both call this single function to shape the current run's recipes, the
// known ingredient pool, and run context into the POST /ai/recipe-assistant wire
// payload, so locking its behavior here locks it for BOTH platforms (replit.md
// parity) — the inline copies can no longer drift.
//
// What is asserted:
//  - recipe fields are emitted under the six stable RECIPE_FIELD_IDS, in the
//    fixed dough -> sauce -> cheese order, with the right kind per field.
//  - empty / all-blank recipes are dropped; rows are trimmed and weights coerced
//    to finite numbers (>=0).
//  - ingredient names are trimmed and de-duplicated case-insensitively (the
//    last spelling wins) and omitted entirely when none remain.
//  - context is filtered to non-blank strings and strictly-positive numbers, and
//    omitted entirely when nothing meaningful is present.

import { describe, it, expect } from "vitest";
import {
  buildRecipeAssistContext,
  RECIPE_FIELD_IDS,
  type RecipeAssistContext,
  type RecipeAssistSourceSettings,
} from "@workspace/recipe-apply";

const EMPTY_CONTEXT: RecipeAssistContext = {};

describe("buildRecipeAssistContext (shared web+mobile)", () => {
  it("emits recipes under the six stable field ids in dough->sauce->cheese order", () => {
    const settings: RecipeAssistSourceSettings = {
      doughRecipeName: "Classic Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
      frontlineRecipeName: "House Sauce",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 10 }],
      app1CheeseRecipeName: "Mozz",
      app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 5 }],
      app2CheeseRecipeName: "Blend",
      app2CheeseRecipe: [{ ingredient: "Provolone", lbs: 3 }],
      app3CheeseRecipeName: "Top",
      app3CheeseRecipe: [{ ingredient: "Parmesan", lbs: 1 }],
      app4CheeseRecipeName: "Finish",
      app4CheeseRecipe: [{ ingredient: "Romano", lbs: 1 }],
    };
    const out = buildRecipeAssistContext(settings, [], EMPTY_CONTEXT);
    expect(out.recipes.map((r) => r.id)).toEqual([...RECIPE_FIELD_IDS]);
    expect(out.recipes.map((r) => r.kind)).toEqual([
      "dough",
      "sauce",
      "cheese",
      "cheese",
      "cheese",
      "cheese",
    ]);
  });

  it("drops empty / all-blank recipes and trims + coerces rows", () => {
    const settings: RecipeAssistSourceSettings = {
      doughRecipeName: "  Dough  ",
      doughRecipe: [
        { ingredient: " Flour ", lbs: 50 },
        { ingredient: "Water", lbs: "30" as unknown as number },
        { ingredient: "   ", lbs: 9 },
        { ingredient: "Yeast", lbs: Number.NaN },
      ],
      frontlineRecipe: [{ ingredient: "   ", lbs: 5 }], // all-blank -> dropped
      app1CheeseRecipe: [], // empty -> dropped
    };
    const out = buildRecipeAssistContext(settings, [], EMPTY_CONTEXT);
    expect(out.recipes).toEqual([
      {
        id: "doughRecipe",
        kind: "dough",
        name: "Dough",
        rows: [
          { ingredient: "Flour", lbs: 50 },
          { ingredient: "Water", lbs: 30 },
          { ingredient: "Yeast", lbs: 0 },
        ],
      },
    ]);
  });

  it("trims and case-insensitively de-duplicates ingredient names (last wins)", () => {
    const out = buildRecipeAssistContext(
      {},
      ["  Mozzarella ", "mozzarella", "Tomato", "  ", "TOMATO"],
      EMPTY_CONTEXT,
    );
    expect(out.ingredientNames).toEqual(["mozzarella", "TOMATO"]);
  });

  it("omits ingredientNames entirely when none remain", () => {
    const out = buildRecipeAssistContext({}, ["   ", ""], EMPTY_CONTEXT);
    expect(out.ingredientNames).toBeUndefined();
  });

  it("keeps only non-blank strings and strictly-positive numbers in context", () => {
    const out = buildRecipeAssistContext({}, [], {
      brand: "  Acme  ",
      flavor: "   ",
      casesNeeded: 12,
      pizzasPerCase: 0,
      doughballWeightOz: -3,
    });
    expect(out.context).toEqual({ brand: "Acme", casesNeeded: 12 });
  });

  it("omits context entirely when nothing meaningful is present", () => {
    const out = buildRecipeAssistContext({}, [], {
      flavor: "   ",
      casesNeeded: 0,
      pizzasPerCase: Number.NaN,
    });
    expect(out.context).toBeUndefined();
  });
});
