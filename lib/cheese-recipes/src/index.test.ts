import { describe, it, expect } from "vitest";
import {
  normalizeCheeseRecipe,
  normalizeCheeseRecipes,
  normalizeCheeseComponent,
  cheeseRecipeTotalLbs,
  addCheeseRecipesIfAbsent,
  mergeCheeseRecipes,
  cheeseRecipeMatchesQuery,
  groupCheeseRecipesByBrand,
  type CheeseRecipe,
} from "./index";

function make(over: Partial<CheeseRecipe> = {}): CheeseRecipe {
  return {
    id: over.id ?? "r1",
    name: over.name ?? "Whole Mozz Cheese Mix",
    brand: over.brand ?? "Bobo",
    flavors: over.flavors ?? [],
    shredderSetting: over.shredderSetting ?? "",
    cellulose: over.cellulose ?? "",
    notes: over.notes ?? "",
    components: over.components ?? [],
    enabled: over.enabled ?? true,
  };
}

describe("normalizeCheeseComponent", () => {
  it("trims name and clamps lbs to >= 0", () => {
    expect(normalizeCheeseComponent({ ingredient: "  Mozz  ", lbs: -5 })).toEqual({
      ingredient: "Mozz",
      lbs: 0,
    });
  });
  it("coerces string lbs and keeps positive", () => {
    expect(normalizeCheeseComponent({ ingredient: "Prov", lbs: "12.5" })).toEqual({
      ingredient: "Prov",
      lbs: 12.5,
    });
  });
  it("rejects rows with no ingredient", () => {
    expect(normalizeCheeseComponent({ ingredient: "   ", lbs: 5 })).toBeNull();
    expect(normalizeCheeseComponent(null)).toBeNull();
  });
});

describe("normalizeCheeseRecipe", () => {
  it("requires a name, defaults enabled true, de-dups flavors case-insensitively", () => {
    const r = normalizeCheeseRecipe({
      id: "x",
      name: "  Blend A ",
      brand: " Bobo ",
      flavors: ["Pepperoni", "pepperoni", " Cheese "],
      shredderSetting: " 3 ",
      components: [
        { ingredient: "Mozz", lbs: 40 },
        { ingredient: "", lbs: 5 },
      ],
    });
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Blend A");
    expect(r!.brand).toBe("Bobo");
    expect(r!.flavors).toEqual(["Pepperoni", "Cheese"]);
    expect(r!.shredderSetting).toBe("3");
    expect(r!.enabled).toBe(true);
    expect(r!.components).toEqual([{ ingredient: "Mozz", lbs: 40 }]);
  });
  it("falls back id to the lowercased name when missing", () => {
    const r = normalizeCheeseRecipe({ name: "My Mix" });
    expect(r!.id).toBe("my mix");
  });
  it("returns null with no usable name", () => {
    expect(normalizeCheeseRecipe({ id: "a", name: "  " })).toBeNull();
  });
  it("honors enabled:false", () => {
    expect(normalizeCheeseRecipe({ name: "A", enabled: false })!.enabled).toBe(false);
  });
});

describe("normalizeCheeseRecipes", () => {
  it("drops malformed and collapses duplicate ids to last", () => {
    const list = normalizeCheeseRecipes([
      { id: "a", name: "First" },
      { id: "a", name: "Second" },
      { name: "" },
      null,
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Second");
  });
});

describe("cheeseRecipeTotalLbs", () => {
  it("sums component pounds", () => {
    expect(
      cheeseRecipeTotalLbs(
        make({ components: [{ ingredient: "a", lbs: 10 }, { ingredient: "b", lbs: 2.5 }] }),
      ),
    ).toBe(12.5);
  });
});

describe("addCheeseRecipesIfAbsent", () => {
  it("adds only new ids", () => {
    const { merged, added } = addCheeseRecipesIfAbsent(
      [make({ id: "a" })],
      [make({ id: "a", name: "dupe" }), make({ id: "b" })],
    );
    expect(added).toBe(1);
    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
    expect(merged[0].name).toBe("Whole Mozz Cheese Mix");
  });
});

describe("mergeCheeseRecipes", () => {
  it("replaces by id and appends new, preserving order", () => {
    const merged = mergeCheeseRecipes(
      [make({ id: "a", name: "old" }), make({ id: "b" })],
      [make({ id: "a", name: "new" }), make({ id: "c" })],
    );
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(merged[0].name).toBe("new");
  });
});

describe("cheeseRecipeMatchesQuery", () => {
  const r = make({ name: "Whole Mozz", brand: "Bobo", flavors: ["Pepperoni"] });
  it("matches empty query", () => expect(cheeseRecipeMatchesQuery(r, "  ")).toBe(true));
  it("matches name/brand/flavor case-insensitively", () => {
    expect(cheeseRecipeMatchesQuery(r, "mozz")).toBe(true);
    expect(cheeseRecipeMatchesQuery(r, "bobo")).toBe(true);
    expect(cheeseRecipeMatchesQuery(r, "pepp")).toBe(true);
    expect(cheeseRecipeMatchesQuery(r, "zzz")).toBe(false);
  });
});

describe("groupCheeseRecipesByBrand", () => {
  it("groups by brand, sorts, puts no-brand last, and derives shredder", () => {
    const groups = groupCheeseRecipesByBrand([
      make({ id: "1", brand: "Zeta", name: "Z1" }),
      make({ id: "2", brand: "Alpha", name: "A2", shredderSetting: "" }),
      make({ id: "3", brand: "Alpha", name: "A1", shredderSetting: "5" }),
      make({ id: "4", brand: "", name: "None" }),
    ]);
    expect(groups.map((g) => g.brand)).toEqual(["Alpha", "Zeta", ""]);
    expect(groups[0].recipes.map((r) => r.name)).toEqual(["A1", "A2"]);
    expect(groups[0].shredderSetting).toBe("5");
  });
});
