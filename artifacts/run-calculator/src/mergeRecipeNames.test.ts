import { describe, it, expect } from "vitest";
import { buildMergeMap } from "./mergeIngredients";
import {
  RECIPE_NAME_FIELDS_BY_CATEGORY,
  mergeRecipeNameSettingsObject,
  foldPresetKeys,
  countRecipeNameReferences,
  isStrayMixName,
} from "./mergeRecipeNames";

describe("mergeRecipeNameSettingsObject", () => {
  it("re-points a dough recipe-name field to the target", () => {
    const map = buildMergeMap(["Old Dough"], "New Dough");
    const out = mergeRecipeNameSettingsObject(
      { doughRecipeName: "Old Dough", other: "x" },
      map,
      RECIPE_NAME_FIELDS_BY_CATEGORY.dough,
    );
    expect(out.doughRecipeName).toBe("New Dough");
    expect(out.other).toBe("x");
  });

  it("re-points every cheese applicator slot independently", () => {
    const map = buildMergeMap(["A"], "B");
    const out = mergeRecipeNameSettingsObject(
      {
        app1CheeseRecipeName: "A",
        app2CheeseRecipeName: "keep",
        app3CheeseRecipeName: "A",
        app4CheeseRecipeName: "",
      },
      map,
      RECIPE_NAME_FIELDS_BY_CATEGORY.cheese,
    );
    expect(out.app1CheeseRecipeName).toBe("B");
    expect(out.app2CheeseRecipeName).toBe("keep");
    expect(out.app3CheeseRecipeName).toBe("B");
    expect(out.app4CheeseRecipeName).toBe("");
  });

  it("leaves ingredient/other fields untouched (only recipe-name fields)", () => {
    const map = buildMergeMap(["A"], "B");
    const out = mergeRecipeNameSettingsObject(
      { app1Type: "A", doughRecipeName: "A" },
      map,
      RECIPE_NAME_FIELDS_BY_CATEGORY.dough,
    );
    expect(out.app1Type).toBe("A"); // not a recipe-name field
    expect(out.doughRecipeName).toBe("B");
  });

  it("mixes has no selection field, so nothing is re-pointed", () => {
    expect(RECIPE_NAME_FIELDS_BY_CATEGORY.mixes).toEqual([]);
    const map = buildMergeMap(["A"], "B");
    const out = mergeRecipeNameSettingsObject(
      { doughRecipeName: "A" },
      map,
      RECIPE_NAME_FIELDS_BY_CATEGORY.mixes,
    );
    expect(out.doughRecipeName).toBe("A");
  });
});

describe("foldPresetKeys", () => {
  it("moves a source preset onto a target that has none", () => {
    const map = buildMergeMap(["Old"], "New");
    const out = foldPresetKeys({ Old: [1, 2], Keep: [9] }, map);
    expect(out).toEqual({ New: [1, 2], Keep: [9] });
  });

  it("keeps the target's own preset when both exist (target wins)", () => {
    const map = buildMergeMap(["Old"], "New");
    const out = foldPresetKeys({ Old: ["src"], New: ["tgt"] }, map);
    expect(out).toEqual({ New: ["tgt"] });
  });

  it("keeps the target's preset regardless of key order", () => {
    const map = buildMergeMap(["Old"], "New");
    const out = foldPresetKeys({ New: ["tgt"], Old: ["src"] }, map);
    expect(out).toEqual({ New: ["tgt"] });
  });

  it("folds multiple sources into one target", () => {
    const map = buildMergeMap(["A", "B"], "C");
    const out = foldPresetKeys({ A: [1], B: [2], D: [4] }, map);
    // First source (A) wins the empty target slot; B is dropped.
    expect(out).toEqual({ C: [1], D: [4] });
  });
});

describe("countRecipeNameReferences", () => {
  it("counts list entries, field hits, and folded preset keys", () => {
    const map = buildMergeMap(["Old"], "New");
    const count = countRecipeNameReferences(map, RECIPE_NAME_FIELDS_BY_CATEGORY.dough, {
      lists: [["Old", "Keep", "New"]],
      settingsObjects: [{ doughRecipeName: "Old" }, { doughRecipeName: "New" }],
      presetKeyMaps: [{ Old: [], New: [] }],
    });
    // 1 list entry + 1 field hit + 1 preset key = 3
    expect(count).toBe(3);
  });

  it("returns 0 when nothing references a source", () => {
    const map = buildMergeMap(["Ghost"], "New");
    const count = countRecipeNameReferences(map, RECIPE_NAME_FIELDS_BY_CATEGORY.sauce, {
      lists: [["a", "b"]],
      settingsObjects: [{ frontlineRecipeName: "b" }],
      presetKeyMaps: [{ a: [] }],
    });
    expect(count).toBe(0);
  });
});

describe("isStrayMixName", () => {
  const real = new Set(["hot giardiniera mix", "cheese", "pepperoni"]);

  it("flags names ending in the word 'mix'", () => {
    expect(isStrayMixName("4Hands Club Mix", real)).toBe(true);
    expect(isStrayMixName("Aldo's Cheese Mix", real)).toBe(true);
    expect(isStrayMixName("Mix", real)).toBe(true);
    expect(isStrayMixName("  club mix  ", real)).toBe(true);
  });

  it("flags variant forms where 'mix' is a mid-string or punctuated token", () => {
    expect(isStrayMixName("Red Hot Cheese Mix Monterey Jack 5.0", real)).toBe(true);
    expect(isStrayMixName("Club Mix (With Chicken)", real)).toBe(true);
    expect(isStrayMixName("Club Mix, Extra", real)).toBe(true);
    expect(isStrayMixName("Club Mix - Alt", real)).toBe(true);
  });

  it("does not flag genuine ingredients (allowlisted, even if they contain mix)", () => {
    expect(isStrayMixName("Hot Giardiniera Mix", real)).toBe(false);
    expect(isStrayMixName("Cheese", real)).toBe(false);
    expect(isStrayMixName("Pepperoni", real)).toBe(false);
  });

  it("protects built-in genuine mix ingredients even with an empty caller allowlist", () => {
    // Post-purge the seed-derived allowlist is empty; the built-in
    // GENUINE_MIX_INGREDIENT_NAMES set must still protect real ingredients.
    expect(isStrayMixName("Hot Giardiniera Mix", new Set())).toBe(false);
    expect(isStrayMixName("4Hands Club Mix", new Set())).toBe(true);
  });

  it("does not flag names where 'mix' is only part of a larger word", () => {
    expect(isStrayMixName("Mixed Berries", real)).toBe(false);
    expect(isStrayMixName("Premix Base", real)).toBe(false);
  });
});
