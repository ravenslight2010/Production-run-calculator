import { describe, expect, it } from "vitest";
import {
  ingredientMergePath,
  resolveIngredientMergeTarget,
  unionIngredientCategories,
} from "./ingredientMerge";

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

  it("resolves a multi-hop merge chain and exposes the full path", () => {
    const rows = [
      { id: "source", mergedInto: "previous-target" },
      { id: "previous-target", mergedInto: "final-target" },
      { id: "final-target", mergedInto: null },
    ];

    expect(resolveIngredientMergeTarget(rows, "source")).toBe("final-target");
    expect(ingredientMergePath(rows, "source")).toEqual([
      "source",
      "previous-target",
      "final-target",
    ]);
  });
});