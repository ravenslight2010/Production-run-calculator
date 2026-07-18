import { describe, expect, it } from "vitest";
import {
  buildIngredientUniverse,
  buildIngredientIndex,
  coerceLbs,
  hydrateRecipeRows,
  normalizeIngredient,
  pickerNamesForCategory,
  resolveActiveIngredient,
  resolveRowName,
  type CatalogRecipeRow,
  type Ingredient,
} from "./index";

function mkIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: "ing-1",
    name: "Mozzarella",
    categories: ["cheese"],
    mergedInto: null,
    enabled: true,
    ...overrides,
  };
}

describe("normalizeIngredient", () => {
  it("returns null for non-object input", () => {
    expect(normalizeIngredient(null)).toBeNull();
    expect(normalizeIngredient("nope")).toBeNull();
    expect(normalizeIngredient(42)).toBeNull();
  });

  it("returns null when name is missing or blank", () => {
    expect(normalizeIngredient({})).toBeNull();
    expect(normalizeIngredient({ name: "   " })).toBeNull();
  });

  it("trims name and defaults enabled to true", () => {
    const result = normalizeIngredient({ id: "x1", name: "  Flour  " });
    expect(result).toEqual({
      id: "x1",
      name: "Flour",
      categories: [],
      mergedInto: null,
      enabled: true,
    });
  });

  it("respects enabled: false explicitly", () => {
    const result = normalizeIngredient({ id: "x1", name: "Flour", enabled: false });
    expect(result?.enabled).toBe(false);
  });

  it("drops unknown category strings and dedupes", () => {
    const result = normalizeIngredient({
      id: "x1",
      name: "Flour",
      categories: ["dough", "dough", "bogus", "pep"],
    });
    expect(result?.categories).toEqual(["dough", "pep"]);
  });

  it("generates an id when missing", () => {
    const result = normalizeIngredient({ name: "Flour" });
    expect(result?.id).toMatch(/^ing-/);
  });

  it("captures mergedInto when a non-blank string", () => {
    const result = normalizeIngredient({ id: "x1", name: "Flour", mergedInto: "  target-1  " });
    expect(result?.mergedInto).toBe("target-1");
  });
});

describe("buildIngredientIndex / resolveActiveIngredient", () => {
  it("resolves an id with no merge to itself", () => {
    const a = mkIngredient({ id: "a", name: "A" });
    const index = buildIngredientIndex([a]);
    expect(resolveActiveIngredient("a", index)).toEqual(a);
  });

  it("follows a single merge hop", () => {
    const a = mkIngredient({ id: "a", name: "A", mergedInto: "b" });
    const b = mkIngredient({ id: "b", name: "B" });
    const index = buildIngredientIndex([a, b]);
    expect(resolveActiveIngredient("a", index)).toEqual(b);
  });

  it("follows a chain of merges", () => {
    const a = mkIngredient({ id: "a", name: "A", mergedInto: "b" });
    const b = mkIngredient({ id: "b", name: "B", mergedInto: "c" });
    const c = mkIngredient({ id: "c", name: "C" });
    const index = buildIngredientIndex([a, b, c]);
    expect(resolveActiveIngredient("a", index)).toEqual(c);
  });

  it("is cycle-safe and bounded (never infinite-loops)", () => {
    const a = mkIngredient({ id: "a", name: "A", mergedInto: "b" });
    const b = mkIngredient({ id: "b", name: "B", mergedInto: "a" });
    const index = buildIngredientIndex([a, b]);
    expect(() => resolveActiveIngredient("a", index)).not.toThrow();
  });

  it("returns null for an unknown id", () => {
    const index = buildIngredientIndex([]);
    expect(resolveActiveIngredient("missing", index)).toBeNull();
  });

  it("returns the last known live ingredient if a merge target is missing", () => {
    const a = mkIngredient({ id: "a", name: "A", mergedInto: "ghost" });
    const index = buildIngredientIndex([a]);
    expect(resolveActiveIngredient("a", index)).toEqual(a);
  });
});

describe("resolveRowName", () => {
  it("resolves via ingredientId when present and known", () => {
    const target = mkIngredient({ id: "b", name: "Fresh Mozz" });
    const index = buildIngredientIndex([target]);
    const row: CatalogRecipeRow = { ingredientId: "b", ingredient: "stale name", lbs: 5 };
    expect(resolveRowName(row, index)).toBe("Fresh Mozz");
  });

  it("falls back to the row's plain name when id is unknown", () => {
    const index = buildIngredientIndex([]);
    const row: CatalogRecipeRow = { ingredientId: "missing", ingredient: "Legacy Name", lbs: 5 };
    expect(resolveRowName(row, index)).toBe("Legacy Name");
  });

  it("falls back to the row's plain name when there is no id (legacy row)", () => {
    const index = buildIngredientIndex([mkIngredient()]);
    const row: CatalogRecipeRow = { ingredient: "Legacy Name", lbs: 5 };
    expect(resolveRowName(row, index)).toBe("Legacy Name");
  });
});

describe("hydrateRecipeRows", () => {
  it("refreshes the display name for a row whose ingredient was renamed", () => {
    const ing = mkIngredient({ id: "a", name: "New Name" });
    const index = buildIngredientIndex([ing]);
    const rows: CatalogRecipeRow[] = [{ ingredientId: "a", ingredient: "Old Name", lbs: 10 }];
    const out = hydrateRecipeRows(rows, index);
    expect(out[0]).toEqual({ ingredientId: "a", ingredient: "New Name", lbs: 10 });
  });

  it("re-points ingredientId when the row's id was merged away", () => {
    const target = mkIngredient({ id: "b", name: "Target" });
    const source = mkIngredient({ id: "a", name: "Target", mergedInto: "b" });
    const index = buildIngredientIndex([source, target]);
    const rows: CatalogRecipeRow[] = [{ ingredientId: "a", ingredient: "Target", lbs: 3 }];
    const out = hydrateRecipeRows(rows, index);
    expect(out[0].ingredientId).toBe("b");
  });

  it("leaves a row untouched when it already matches the active ingredient", () => {
    const ing = mkIngredient({ id: "a", name: "Stable" });
    const index = buildIngredientIndex([ing]);
    const row: CatalogRecipeRow = { ingredientId: "a", ingredient: "Stable", lbs: 3 };
    const out = hydrateRecipeRows([row], index);
    expect(out[0]).toBe(row);
  });

  it("backfills a missing ingredientId by case-insensitive name match", () => {
    const ing = mkIngredient({ id: "a", name: "Mozzarella" });
    const index = buildIngredientIndex([ing]);
    const rows: CatalogRecipeRow[] = [{ ingredient: "mozzarella", lbs: 8 }];
    const out = hydrateRecipeRows(rows, index);
    expect(out[0]).toEqual({ ingredient: "Mozzarella", ingredientId: "a", lbs: 8 });
  });

  it("never drops a row or blanks a name it can't resolve", () => {
    const index = buildIngredientIndex([]);
    const rows: CatalogRecipeRow[] = [
      { ingredient: "Unknown Ingredient", lbs: 1 },
      { ingredientId: "missing", ingredient: "Also Unknown", lbs: 2 },
      { ingredient: "", lbs: 0 },
    ];
    const out = hydrateRecipeRows(rows, index);
    expect(out).toHaveLength(3);
    expect(out[0].ingredient).toBe("Unknown Ingredient");
    expect(out[1].ingredient).toBe("Also Unknown");
    expect(out[2].ingredient).toBe("");
  });
});

describe("pickerNamesForCategory", () => {
  it("returns only enabled, non-merged items tagged with the category", () => {
    const items: Ingredient[] = [
      mkIngredient({ id: "a", name: "Cheddar", categories: ["cheese"] }),
      mkIngredient({ id: "b", name: "Flour", categories: ["dough"] }),
      mkIngredient({ id: "c", name: "Disabled Cheese", categories: ["cheese"], enabled: false }),
      mkIngredient({ id: "d", name: "Merged Cheese", categories: ["cheese"], mergedInto: "a" }),
    ];
    expect(pickerNamesForCategory(items, "cheese")).toEqual(["Cheddar"]);
  });

  it("includes 'general' ingredients in every category's picker", () => {
    const items: Ingredient[] = [
      mkIngredient({ id: "a", name: "Salt", categories: ["general"] }),
      mkIngredient({ id: "b", name: "Flour", categories: ["dough"] }),
    ];
    expect(pickerNamesForCategory(items, "dough")).toEqual(["Flour", "Salt"]);
    expect(pickerNamesForCategory(items, "pep")).toEqual(["Salt"]);
  });

  it("excludes items with no categories set", () => {
    const items: Ingredient[] = [mkIngredient({ id: "a", name: "Untagged", categories: [] })];
    expect(pickerNamesForCategory(items, "cheese")).toEqual([]);
  });

  it("sorts alphabetically and dedupes names", () => {
    const items: Ingredient[] = [
      mkIngredient({ id: "a", name: "Zucchini", categories: ["general"] }),
      mkIngredient({ id: "b", name: "Apple", categories: ["general"] }),
    ];
    expect(pickerNamesForCategory(items, "general")).toEqual(["Apple", "Zucchini"]);
  });
});

describe("coerceLbs", () => {
  it("coerces numeric strings", () => {
    expect(coerceLbs("12.5")).toBe(12.5);
  });

  it("clamps negative values to 0", () => {
    expect(coerceLbs(-5)).toBe(0);
  });

  it("falls back to 0 for non-numeric input", () => {
    expect(coerceLbs("abc")).toBe(0);
    expect(coerceLbs(undefined)).toBe(0);
    expect(coerceLbs(null)).toBe(0);
  });
});

describe("buildIngredientUniverse", () => {
  it("returns empty for no sources", () => {
    expect(buildIngredientUniverse({})).toEqual([]);
  });

  it("unions catalog, recipe rows, and name lists", () => {
    const result = buildIngredientUniverse({
      catalog: [mkIngredient({ id: "a", name: "Mozzarella" })],
      recipeRows: [
        [{ ingredient: "Flour" }, { ingredient: "Water" }],
        [{ ingredient: "Tomato Paste" }],
      ],
      nameLists: [["Pepperoni"], ["Salt"]],
    });
    expect(result).toEqual([
      "Flour",
      "Mozzarella",
      "Pepperoni",
      "Salt",
      "Tomato Paste",
      "Water",
    ]);
  });

  it("dedupes case-insensitively keeping the first casing seen", () => {
    const result = buildIngredientUniverse({
      catalog: [mkIngredient({ id: "a", name: "Diced Onion" })],
      recipeRows: [[{ ingredient: "diced onion" }]],
      nameLists: [["DICED ONION"]],
    });
    expect(result).toEqual(["Diced Onion"]);
  });

  it("skips disabled and merged-away catalog entries", () => {
    const result = buildIngredientUniverse({
      catalog: [
        mkIngredient({ id: "a", name: "Live" }),
        mkIngredient({ id: "b", name: "Gone", enabled: false }),
        mkIngredient({ id: "c", name: "Merged", mergedInto: "a" }),
      ],
    });
    expect(result).toEqual(["Live"]);
  });

  it("trims names and drops blanks", () => {
    const result = buildIngredientUniverse({
      recipeRows: [[{ ingredient: "  Basil  " }, { ingredient: "   " }]],
      nameLists: [["", "Basil"]],
    });
    expect(result).toEqual(["Basil"]);
  });

  it("never mutates its inputs", () => {
    const catalog = [mkIngredient({ id: "a", name: "Mozzarella" })];
    const rows = [[{ ingredient: "Flour" }]];
    const lists = [["Salt"]];
    buildIngredientUniverse({ catalog, recipeRows: rows, nameLists: lists });
    expect(catalog[0].name).toBe("Mozzarella");
    expect(rows).toEqual([[{ ingredient: "Flour" }]]);
    expect(lists).toEqual([["Salt"]]);
  });
});
