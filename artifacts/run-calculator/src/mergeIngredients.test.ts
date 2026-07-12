// Focused tests for the merge confirmation preview count, especially the
// server master-data rows (ciRowLists) that are matched case-insensitively to
// mirror the server re-point helpers. A name that lives ONLY in factory
// recipes used to show "0 references" even though the merge would rewrite it.
import { describe, it, expect } from "vitest";
import { buildMergeMap, countMergeReferences } from "./mergeIngredients";

describe("countMergeReferences", () => {
  const map = buildMergeMap(["Whole Milk Mozz"], "Whole Mozzarella");

  it("counts exact-case local list and recipe-row hits", () => {
    const n = countMergeReferences(map, {
      lists: [["Whole Milk Mozz", "Provolone"]],
      settingsObjects: [
        {
          app1Type: "Whole Milk Mozz",
          doughRecipe: [{ ingredient: "Whole Milk Mozz" }, { ingredient: "Flour" }],
        },
      ],
    });
    expect(n).toBe(3);
  });

  it("counts server recipe rows case-insensitively with trimming", () => {
    const n = countMergeReferences(map, {
      ciRowLists: [
        [{ ingredient: "  whole milk mozz " }, { ingredient: "Salt" }],
        [{ ingredient: "WHOLE MILK MOZZ" }],
      ],
    });
    expect(n).toBe(2);
  });

  it("returns 0 for server rows when nothing matches", () => {
    const n = countMergeReferences(map, {
      ciRowLists: [[{ ingredient: "Provolone" }, { ingredient: undefined }]],
    });
    expect(n).toBe(0);
  });

  it("does not count the target itself in server rows", () => {
    const n = countMergeReferences(map, {
      ciRowLists: [[{ ingredient: "Whole Mozzarella" }]],
    });
    expect(n).toBe(0);
  });

  it("combines local and server counts", () => {
    const n = countMergeReferences(map, {
      lists: [["Whole Milk Mozz"]],
      ciRowLists: [[{ ingredient: "whole milk mozz" }]],
    });
    expect(n).toBe(2);
  });
});
