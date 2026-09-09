import { describe, expect, it } from "vitest";
import { planIngredientBatchWeightRepoint } from "./ingredientBatchWeights";

describe("planIngredientBatchWeightRepoint", () => {
  it("moves a one-sided source weight to the target", () => {
    expect(
      planIngredientBatchWeightRepoint(
        [{ id: 1, name: "Legacy Flour", lbs: 18, updatedAt: new Date(1) }],
        "Canonical Flour",
        ["Legacy Flour"],
      ),
    ).toEqual({ winnerId: 1, winnerLbs: 18, deleteIds: [] });
  });

  it("explicitly prefers the target when both names have weights", () => {
    expect(
      planIngredientBatchWeightRepoint(
        [
          { id: 1, name: "Canonical Flour", lbs: 22, updatedAt: new Date(1) },
          { id: 2, name: "Legacy Flour", lbs: 18, updatedAt: new Date(2) },
        ],
        "Canonical Flour",
        ["Legacy Flour"],
      ),
    ).toEqual({ winnerId: 1, winnerLbs: 22, deleteIds: [2] });
  });

  it("matches case-variant rows and chooses the newest target duplicate", () => {
    expect(
      planIngredientBatchWeightRepoint(
        [
          { id: 1, name: "canonical flour", lbs: 14, updatedAt: new Date(1) },
          { id: 2, name: "CANONICAL FLOUR", lbs: 21, updatedAt: new Date(2) },
          { id: 3, name: "legacy flour", lbs: 19, updatedAt: new Date(3) },
        ],
        "Canonical Flour",
        ["Legacy Flour"],
      ),
    ).toEqual({ winnerId: 2, winnerLbs: 21, deleteIds: [1, 3] });
  });
});