import { describe, it, expect } from "vitest";
import {
  buildBatchWeightMap,
  lookupBatchWeight,
  collectBatchWeightCandidates,
  type BatchWeightFormSlice,
} from "./ingredientBatchWeights";

const DEFAULT_PEPS = ["Pepperoni", "Cup & Char"];

function emptySlice(): BatchWeightFormSlice {
  return {
    apps: [],
    peps: [],
    defaultPepTypes: DEFAULT_PEPS,
    sauce: { recipeName: "", barrelLbs: 0, recipe: [] },
  };
}

describe("buildBatchWeightMap / lookupBatchWeight", () => {
  it("keys case-insensitively and drops degenerate rows", () => {
    const map = buildBatchWeightMap([
      { name: "  Bacon Crumble ", lbs: 25 },
      { name: "", lbs: 10 },
      { name: "Zero", lbs: 0 },
      { name: "Neg", lbs: -5 },
      { name: "Bad", lbs: Number.NaN },
    ]);
    expect(map.size).toBe(1);
    expect(lookupBatchWeight(map, "bacon crumble")).toBe(25);
    expect(lookupBatchWeight(map, "BACON CRUMBLE  ")).toBe(25);
    expect(lookupBatchWeight(map, "sausage")).toBeNull();
    expect(lookupBatchWeight(map, "")).toBeNull();
  });
});

describe("collectBatchWeightCandidates", () => {
  it("collects visible positive applicator weights that differ from learned", () => {
    const slice = emptySlice();
    slice.apps = [
      { type: "Bacon", batchLbs: 30, cheeseRecipe: [] },
      { type: "Sausage", batchLbs: 20, cheeseRecipe: [] },
    ];
    const learned = buildBatchWeightMap([{ name: "sausage", lbs: 20 }]);
    const out = collectBatchWeightCandidates(slice, learned);
    expect(out).toEqual([{ name: "Bacon", lbs: 30 }]);
  });

  it("skips mixes, recipe-backed slots, empty types, and non-positive weights", () => {
    const slice = emptySlice();
    slice.apps = [
      { type: "Veggie Mix", batchLbs: 40, cheeseRecipe: [] }, // mix — recipe rows own the weight
      { type: "Cheese", batchLbs: 15, cheeseRecipe: [{ lbs: 10 }] }, // recipe-backed
      { type: "", batchLbs: 12, cheeseRecipe: [] }, // no ingredient picked
      { type: "Onion", batchLbs: 0, cheeseRecipe: [] }, // nothing entered
    ];
    expect(collectBatchWeightCandidates(slice, new Map())).toEqual([]);
  });

  it("skips default stick-pep types but learns custom pep types (incl. B slots)", () => {
    const slice = emptySlice();
    slice.peps = [
      { type: "Pepperoni", batchLbs: 18 }, // default type — lbs field hidden
      { type: "Turkey Pep", batchLbs: 22 },
      { type: "Cheese Sticks", batchLbs: 12 },
    ];
    expect(collectBatchWeightCandidates(slice, new Map())).toEqual([
      { name: "Turkey Pep", lbs: 22 },
      { name: "Cheese Sticks", lbs: 12 },
    ]);
  });

  it("learns ready-made sauce barrels but never recipe-backed sauces", () => {
    const readyMade = emptySlice();
    readyMade.sauce = { recipeName: "BBQ", barrelLbs: 55, recipe: [] };
    expect(collectBatchWeightCandidates(readyMade, new Map())).toEqual([
      { name: "BBQ", lbs: 55 },
    ]);

    const recipeBacked = emptySlice();
    recipeBacked.sauce = {
      recipeName: "House Red",
      barrelLbs: 55,
      recipe: [{ lbs: 30 }, { lbs: 25 }],
    };
    expect(collectBatchWeightCandidates(recipeBacked, new Map())).toEqual([]);
  });

  it("dedupes the same ingredient across slots (last write wins)", () => {
    const slice = emptySlice();
    slice.apps = [
      { type: "Bacon", batchLbs: 30, cheeseRecipe: [] },
      { type: "bacon ", batchLbs: 32, cheeseRecipe: [] },
    ];
    expect(collectBatchWeightCandidates(slice, new Map())).toEqual([
      { name: "bacon", lbs: 32 },
    ]);
  });
});
