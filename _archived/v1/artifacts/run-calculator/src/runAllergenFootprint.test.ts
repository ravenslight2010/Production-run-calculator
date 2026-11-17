import { describe, expect, it } from "vitest";
import { allergenSequenceWarnings } from "@workspace/allergen";
import { DEFAULT_VALUES } from "./types";
import { collectRunAllergenComponents } from "./runAllergenFootprint";

describe("collectRunAllergenComponents", () => {
  it("selects configured dough, Sauce, cheese/mix recipes, and selected pepperoni types", () => {
    const values = {
      ...DEFAULT_VALUES,
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", ingredientId: "flour", lbs: 25 }],
      frontlineRecipeName: "Red Sauce",
      frontlineRecipe: [{ ingredient: "Tomatoes", lbs: 10 }],
      app1Type: "cheese",
      app1CheeseRecipeName: "Cheese Blend",
      app1CheeseRecipe: [{ ingredient: "Milk", ingredientId: "milk", lbs: 5 }],
      app2Type: "mix",
      app2CheeseRecipe: [],
      pep1Type: "Pepperoni",
      pep1TypeB: "Pepperoni Stick - Natural",
    };

    expect(collectRunAllergenComponents(values)).toEqual([
      {
        label: "Dough",
        configured: true,
        ingredients: [{ ingredient: "Flour", ingredientId: "flour" }],
      },
      {
        label: "Frontline (Sauce)",
        configured: true,
        ingredients: [{ ingredient: "Tomatoes", ingredientId: undefined }],
      },
      {
        label: "Applicator 1",
        configured: true,
        ingredients: [{ ingredient: "Milk", ingredientId: "milk" }],
      },
      { label: "Applicator 2", configured: true, ingredients: [] },
      {
        label: "Pepperoni 1",
        configured: true,
        ingredients: [{ ingredient: "Pepperoni" }],
      },
      {
        label: "Pepperoni 1 additional type",
        configured: true,
        ingredients: [{ ingredient: "Pepperoni Stick - Natural" }],
      },
    ]);
  });

  it("does not derive from or modify the manually entered run label", () => {
    const base = {
      ...DEFAULT_VALUES,
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 25 }],
    };
    const eggLabelValues = { ...base, allergen: "egg" };
    const soyLabelValues = { ...base, allergen: "soy" };
    const before = structuredClone(eggLabelValues);

    expect(collectRunAllergenComponents(eggLabelValues)).toEqual(
      collectRunAllergenComponents(soyLabelValues),
    );
    expect(eggLabelValues).toEqual(before);

    // The existing sequencing warning still consumes the manual run labels.
    expect(
      allergenSequenceWarnings([
        { id: "run-1", label: "Run 1", allergen: "egg" },
        { id: "run-2", label: "Run 2", allergen: "soy" },
      ]),
    ).toMatchObject([{ fromId: "run-1", toId: "run-2", kind: "clean" }]);
  });

  it("uses effective ingredient identities after today's temporary substitutions", () => {
    const values = {
      ...DEFAULT_VALUES,
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 20 }],
      pep1Type: "Pepperoni",
    };

    expect(
      collectRunAllergenComponents(values, [{
        id: "sub-flour",
        ingredient: "Flour",
        action: "swap",
        substitute: "Sample Substitute",
      }]),
    ).toMatchObject([
      {
        label: "Dough",
        ingredients: [{ ingredient: "Sample Substitute" }],
      },
      {
        label: "Pepperoni 1",
        ingredients: [{ ingredient: "Pepperoni" }],
      },
    ]);
  });

  it("does not treat missing recipe rows for a selected recipe-driven applicator as absent configuration", () => {
    const values = {
      ...DEFAULT_VALUES,
      app3Type: "Mix",
      app3CheeseRecipeName: "House Mix",
      app3CheeseRecipe: [],
    };
    expect(collectRunAllergenComponents(values)).toEqual([
      { label: "Applicator 3", configured: true, ingredients: [] },
    ]);
  });
});
