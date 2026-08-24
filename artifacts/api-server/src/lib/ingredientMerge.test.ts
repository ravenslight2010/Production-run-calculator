import { describe, expect, it } from "vitest";
import { unionIngredientCategories } from "./ingredientMerge";

describe("unionIngredientCategories", () => {
  it("keeps every category in stable first-seen order", () => {
    expect(
      unionIngredientCategories(
        ["mix", "cheese"],
        ["cheese", "frontline"],
        ["dough"],
      ),
    ).toEqual(["mix", "cheese", "frontline", "dough"]);
  });

  it("handles catalog rows without a category list", () => {
    expect(unionIngredientCategories(undefined, [], ["pep"])).toEqual(["pep"]);
  });
});