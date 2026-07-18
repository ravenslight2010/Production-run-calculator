// Component-based mix routing default: a cheese-kind spec blend whose
// component ingredient names contain NO cheese-ish token defaults to the Mix
// category even without a "mix"/"blend" word in its name ("Italian Beef &
// Gravy"). The name-mentions-cheese rule still wins first, and an explicit
// review-time forcedCategory override remains authoritative upstream.
import { describe, it, expect } from "vitest";

import {
  specImportCheeseRecipeIsMix,
  specImportIngredientLooksCheesy,
  specImportRecipeIsMix,
  type ParsedRecipe,
} from "./index";

const none = new Set<string>();

describe("specImportIngredientLooksCheesy", () => {
  it("recognizes cheese-ish component names", () => {
    expect(specImportIngredientLooksCheesy("Whole Milk Mozzarella")).toBe(true);
    expect(specImportIngredientLooksCheesy("Mozz")).toBe(true);
    expect(specImportIngredientLooksCheesy("Smoked Provolone")).toBe(true);
    expect(specImportIngredientLooksCheesy("Parm")).toBe(true);
    expect(specImportIngredientLooksCheesy("Cellulose")).toBe(true);
  });

  it("does not false-positive on non-cheese names", () => {
    expect(specImportIngredientLooksCheesy("Italian Beef")).toBe(false);
    expect(specImportIngredientLooksCheesy("Gravy")).toBe(false);
    expect(specImportIngredientLooksCheesy("Blueberry")).toBe(false); // \bblue\b not in list
    expect(specImportIngredientLooksCheesy("Giardiniera")).toBe(false);
  });
});

describe("specImportCheeseRecipeIsMix with component names", () => {
  it("defaults a cheese-less multi-ingredient blend to Mix without a mix/blend word", () => {
    expect(
      specImportCheeseRecipeIsMix("Italian Beef & Gravy", none, 2, [
        "Italian Beef",
        "Gravy",
      ]),
    ).toBe(true);
  });

  it("keeps a blend with any cheese-ish component under Cheese", () => {
    expect(
      specImportCheeseRecipeIsMix("Gyro Topping", none, 2, [
        "Gyro Meat",
        "Feta",
      ]),
    ).toBe(false);
  });

  it("mix/blend name-word rule deliberately beats cheesy components", () => {
    // Real premixes often carry some cheese ("White Fajita Mix" has Monterey
    // Jack) and must still route to Mixes. Cheese-workbook blends named
    // "... Mix" ("Aldo's Parmesan / Oregano Mix") are safe because the cheese
    // importer never consults this heuristic — see the corpus harness.
    expect(
      specImportCheeseRecipeIsMix("White Fajita Mix", none, 2, [
        "Monterey Jack",
        "Green Peppers",
      ]),
    ).toBe(true);
    expect(
      specImportCheeseRecipeIsMix("Red Fajita Blend", none, 2, ["Red Peppers", "Onions"]),
    ).toBe(true);
  });

  it("name mentioning cheese still NEVER routes to mix, whatever the components", () => {
    expect(
      specImportCheeseRecipeIsMix("Cheese Topping", none, 2, ["Beef", "Gravy"]),
    ).toBe(false);
  });

  it("needs 2+ named components (a single-ingredient table is not a mix)", () => {
    expect(specImportCheeseRecipeIsMix("Italian Beef", none, 1, ["Italian Beef"])).toBe(false);
    expect(
      specImportCheeseRecipeIsMix("Italian Beef & Gravy", none, 2, ["Italian Beef", " "]),
    ).toBe(false);
  });

  it("stays backward-compatible when component names are not supplied", () => {
    expect(specImportCheeseRecipeIsMix("Italian Beef & Gravy", none, 2)).toBe(false);
    expect(specImportCheeseRecipeIsMix("Red Fajita Blend", none, 2)).toBe(true);
  });
});

describe("specImportRecipeIsMix passes components through", () => {
  const base = {
    kind: "cheese",
    name: "Italian Beef & Gravy",
    rows: [
      { ingredient: "Italian Beef", lbs: 0 },
      { ingredient: "Gravy", lbs: 0 },
    ],
  } as unknown as ParsedRecipe;

  it("routes the cheese-less blend to Mix by default", () => {
    expect(specImportRecipeIsMix(base, none)).toBe(true);
  });

  it("forcedCategory override stays authoritative", () => {
    expect(
      specImportRecipeIsMix({ ...base, forcedCategory: "cheese" } as ParsedRecipe, none),
    ).toBe(false);
    expect(
      specImportRecipeIsMix({ ...base, forcedCategory: "mix" } as ParsedRecipe, none),
    ).toBe(true);
  });
});
