// Focused tests for the merge confirmation preview count, especially the
// server master-data rows (ciRowLists) that are matched case-insensitively to
// mirror the server re-point helpers. A name that lives ONLY in factory
// recipes used to show "0 references" even though the merge would rewrite it.
import { describe, it, expect } from "vitest";
import {
  buildMergeMap,
  countMergeReferences,
  mapName,
  mergeList,
  mergeRecipeRows,
  mergeSettingsObject,
} from "./mergeIngredients";

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

  it("counts LOCAL lists, fields and rows case-insensitively too", () => {
    // Regression: local surfaces used to be exact-case only, so a name that
    // drifted in case ("WHOLE MILK MOZZ" from an import) previewed as
    // "0 references" even though the apply path rewrote it.
    const n = countMergeReferences(map, {
      lists: [[" whole milk mozz ", "Provolone"]],
      settingsObjects: [
        {
          app1Type: "WHOLE MILK MOZZ",
          doughRecipe: [{ ingredient: "Whole milk mozz" }],
        },
      ],
    });
    expect(n).toBe(3);
  });
});

describe("case-insensitive apply helpers", () => {
  const map = buildMergeMap(["Whole Milk Mozz"], "Whole Mozzarella");

  it("mapName renames regardless of case/whitespace", () => {
    expect(mapName(" whole milk mozz ", map)).toBe("Whole Mozzarella");
    expect(mapName("WHOLE MILK MOZZ", map)).toBe("Whole Mozzarella");
    expect(mapName("Provolone", map)).toBe("Provolone");
  });

  it("mergeList renames and dedupes case-insensitively", () => {
    const out = mergeList(["whole milk mozz", "Whole Mozzarella", "Provolone"], map);
    expect(out).toEqual(["Whole Mozzarella", "Provolone"]);
  });

  it("mergeRecipeRows renames row ingredients regardless of case", () => {
    const out = mergeRecipeRows(
      [{ ingredient: "WHOLE MILK MOZZ", lbs: 5 }, { ingredient: "Salt" }],
      map,
    );
    expect(out[0]).toEqual({ ingredient: "Whole Mozzarella", lbs: 5 });
    expect(out[1]).toEqual({ ingredient: "Salt" });
  });

  it("mergeSettingsObject renames type fields regardless of case", () => {
    const out = mergeSettingsObject({ app1Type: "whole milk mozz", app2Type: "Sausage" }, map);
    expect(out.app1Type).toBe("Whole Mozzarella");
    expect(out.app2Type).toBe("Sausage");
  });
});
