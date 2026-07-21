import { describe, it, expect } from "vitest";
import {
  recipeApplyTargets,
  type ParsedProfile,
  type ParsedRecipe,
} from "./index";

// Minimal builders — only the fields the fan-out reads.
function profile(
  brand: string,
  flavor: string,
  over: Partial<ParsedProfile> = {},
): ParsedProfile {
  return {
    brand,
    flavor,
    applicators: [],
    pepperonis: [],
    ...over,
  } as unknown as ParsedProfile;
}

function recipe(over: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    kind: "dough",
    name: "CRB Dough",
    rows: [],
    ...over,
  } as ParsedRecipe;
}

const targetKeys = (r: ParsedRecipe, pool: ParsedProfile[]): string[] =>
  recipeApplyTargets(r, pool)
    .map((t) => `${t.brand}|${t.flavor}`)
    .sort();

describe("recipeApplyTargets — qualified-name brand fan respects linked recipe names", () => {
  // The production incident: "LOWE'S HEAVY FRENCH FRY DOUGH" carries qualifier
  // tokens (heavy/french/fry) that match NO Lowe's flavor, so the old fallback
  // sprayed the recipe over EVERY Lowe's flavor — overwriting the CRB dough on
  // BBQ Chicken with a 15 oz / 15-per-tray French Fry dough.
  it("does not fan a qualified dough name onto profiles linked to a DIFFERENT dough", () => {
    const pool = [
      profile("Lowe's", "BBQ Chicken", { doughName: "CRB Dough" }),
      profile("Lowe's", "Bacon Cheeseburger", {
        doughName: "Lowe's French Fry Dough",
      }),
    ];
    const r = recipe({ name: "LOWE'S HEAVY FRENCH FRY DOUGH", brand: "Lowe's" });
    expect(targetKeys(r, pool)).toEqual(["Lowe's|Bacon Cheeseburger"]);
  });

  it("still fans onto profiles whose linked name is blank", () => {
    const pool = [
      profile("Lowe's", "BBQ Chicken"),
      profile("Lowe's", "Bacon Cheeseburger", {
        doughName: "Lowe's French Fry Dough",
      }),
    ];
    const r = recipe({ name: "LOWE'S HEAVY FRENCH FRY DOUGH", brand: "Lowe's" });
    expect(targetKeys(r, pool)).toEqual([
      "Lowe's|BBQ Chicken",
      "Lowe's|Bacon Cheeseburger",
    ]);
  });

  it("whole-brand fan unchanged when the name has no qualifier tokens (Aldo's Pizza Sauce)", () => {
    const pool = [
      profile("Aldo's", "Cheese", { sauceName: "Something Else" }),
      profile("Aldo's", "Pepperoni"),
    ];
    const r = recipe({
      kind: "sauce",
      name: "Aldo's Pizza Sauce",
      brand: "Aldo's",
    });
    // No qualifier tokens beyond brand+generic words → original whole-brand fan.
    expect(targetKeys(r, pool)).toEqual([
      "Aldo's|Cheese",
      "Aldo's|Pepperoni",
    ]);
  });

  it("flavor-qualifier match still wins over linked-name narrowing", () => {
    const pool = [
      profile("Four Hands", "Red Hot", { sauceName: "Old Sauce" }),
      profile("Four Hands", "Cheese", { sauceName: "" }),
    ];
    const r = recipe({
      kind: "sauce",
      name: "Four Hands RED HOT Pizza Sauce",
      brand: "Four Hands",
    });
    expect(targetKeys(r, pool)).toEqual(["Four Hands|Red Hot"]);
  });

  it("typo/possessive-tolerant: a profile already linked to this recipe stays fanned", () => {
    const pool = [
      profile("Lowe's", "Bacon Cheeseburger", {
        doughName: "Lowes French Fry",
      }),
      profile("Lowe's", "BBQ Chicken", { doughName: "CRB Dough" }),
    ];
    const r = recipe({ name: "Lowe's French Fry Dough", brand: "Lowe's" });
    expect(targetKeys(r, pool)).toEqual(["Lowe's|Bacon Cheeseburger"]);
  });
});
