import { describe, it, expect } from "vitest";
import {
  normalizeCheeseRecipe,
  normalizeCheeseRecipes,
  normalizeCheeseComponent,
  cheeseRecipeTotalLbs,
  addCheeseRecipesIfAbsent,
  addCheeseRecipesIfAbsentByName,
  specCheeseDraftToRecipe,
  applyCheeseOzPerPizza,
  mergeCheeseRecipes,
  repointCheeseRecipesForBrandMerge,
  renameCheeseRecipesBrand,
  repointCheeseRecipesForFlavorMerge,
  repointCheeseRecipeIngredients,
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

  it("collapses whole-brand catch-all flavor labels to empty (= applies to all flavors)", () => {
    // "All Varieties" (and friends) are not real product flavors — they mean the
    // blend applies to every flavor of the brand. The model represents that as an
    // empty list, so an imported/stored "All Varieties" blend is offered for every
    // flavor in the run/setup pickers instead of being hidden on a specific one.
    const r = normalizeCheeseRecipe({
      id: "x",
      name: "Aldo's Standard Cheese Mix",
      brand: "Aldo",
      flavors: ["All Varieties"],
      components: [{ ingredient: "Mozz", lbs: 40 }],
    });
    expect(r!.flavors).toEqual([]);
    // Catch-all labels are dropped even when mixed with real flavors, leaving the
    // genuine flavor(s) behind.
    const mixed = normalizeCheeseRecipe({
      id: "y",
      name: "Blend B",
      brand: "Bobo",
      flavors: ["All Flavors", "Pepperoni"],
      components: [{ ingredient: "Mozz", lbs: 40 }],
    });
    expect(mixed!.flavors).toEqual(["Pepperoni"]);
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

describe("specCheeseDraftToRecipe", () => {
  it("builds a deterministic name-slug id so re-import matches the same recipe", () => {
    const a = specCheeseDraftToRecipe({
      name: "Aldo's Cheese Mix",
      brand: "Bobo",
      flavors: ["Pepperoni"],
      components: [{ ingredient: "Mozzarella", lbs: 30 }],
    });
    const b = specCheeseDraftToRecipe({
      name: "Aldo's Cheese Mix",
      brand: "Bobo",
      flavors: [],
      components: [],
    });
    expect(a?.id).toBe("cheese:spec:aldo-s-cheese-mix");
    expect(a?.id).toBe(b?.id);
  });
  it("leaves shredder/cellulose/notes blank, enables it, preserves components verbatim", () => {
    const r = specCheeseDraftToRecipe({
      name: "White Blend",
      brand: "Corner Booth",
      flavors: ["Fajita"],
      components: [
        { ingredient: "Monterey Jack", lbs: 20 },
        { ingredient: "Green Peppers", lbs: 5 },
      ],
    });
    expect(r).not.toBeNull();
    expect(r?.name).toBe("White Blend");
    expect(r?.brand).toBe("Corner Booth");
    expect(r?.flavors).toEqual(["Fajita"]);
    expect(r?.shredderSetting).toBe("");
    expect(r?.cellulose).toBe("");
    expect(r?.notes).toBe("");
    expect(r?.enabled).toBe(true);
    expect(r?.components).toEqual([
      { ingredient: "Monterey Jack", lbs: 20 },
      { ingredient: "Green Peppers", lbs: 5 },
    ]);
  });
  it("returns null for a blank name", () => {
    expect(
      specCheeseDraftToRecipe({ name: "  ", brand: "", flavors: [], components: [] }),
    ).toBeNull();
  });
  it("routes spec per-pizza ounces to ozPerPizza, leaving batch lbs at 0", () => {
    const r = specCheeseDraftToRecipe({
      name: "Spec Blend",
      brand: "B",
      flavors: [],
      components: [{ ingredient: "Mozzarella", ozPerPizza: 2.07 }],
    });
    expect(r?.components).toEqual([
      { ingredient: "Mozzarella", lbs: 0, ozPerPizza: 2.07 },
    ]);
  });
});

describe("applyCheeseOzPerPizza", () => {
  it("writes ONLY ozPerPizza on name+ingredient matches — curated lbs untouched", () => {
    const existing = [
      make({
        id: "curated",
        name: "Aldo's Cheese Mix",
        components: [
          { ingredient: "Pizella", lbs: 207 },
          { ingredient: "Part Skim Mozzarella", lbs: 119 },
        ],
      }),
    ];
    const { next, updated } = applyCheeseOzPerPizza(existing, [
      {
        name: "aldo's cheese mix", // case-insensitive name match
        components: [
          { ingredient: "PIZELLA", ozPerPizza: 2.07 }, // ci ingredient match
          { ingredient: "Part Skim Mozzarella", ozPerPizza: 1.19 },
        ],
      },
    ]);
    expect(updated).toBe(1);
    expect(next[0].components).toEqual([
      { ingredient: "Pizella", lbs: 207, ozPerPizza: 2.07 },
      { ingredient: "Part Skim Mozzarella", lbs: 119, ozPerPizza: 1.19 },
    ]);
  });
  it("does not count a recipe whose oz values already match (no churn save)", () => {
    const existing = [
      make({
        name: "Blend",
        components: [{ ingredient: "Mozz", lbs: 30, ozPerPizza: 2 }],
      }),
    ];
    const { next, updated } = applyCheeseOzPerPizza(existing, [
      { name: "Blend", components: [{ ingredient: "Mozz", ozPerPizza: 2 }] },
    ]);
    expect(updated).toBe(0);
    expect(next[0]).toBe(existing[0]);
  });
  it("ignores unmatched names, unmatched ingredients, and non-positive oz", () => {
    const existing = [
      make({ name: "Blend", components: [{ ingredient: "Mozz", lbs: 30 }] }),
    ];
    const { next, updated } = applyCheeseOzPerPizza(existing, [
      { name: "Other", components: [{ ingredient: "Mozz", ozPerPizza: 2 }] },
      { name: "Blend", components: [{ ingredient: "Prov", ozPerPizza: 2 }] },
      { name: "Blend", components: [{ ingredient: "Mozz", ozPerPizza: 0 }] },
    ]);
    expect(updated).toBe(0);
    expect(next[0].components).toEqual([{ ingredient: "Mozz", lbs: 30 }]);
  });
});

describe("addCheeseRecipesIfAbsentByName", () => {
  it("skips a candidate whose name already exists (case-insensitive) — match, don't clobber", () => {
    const existing = [make({ id: "curated", name: "Cheese Blend", brand: "Curated" })];
    const candidate = make({ id: "cheese:spec:cheese-blend", name: "cheese blend", brand: "Spec" });
    const { merged, added } = addCheeseRecipesIfAbsentByName(existing, [candidate]);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].brand).toBe("Curated");
  });
  it("skips a candidate whose id already exists", () => {
    const existing = [make({ id: "cheese:spec:x", name: "Existing" })];
    const candidate = make({ id: "cheese:spec:x", name: "Different Name" });
    const { added } = addCheeseRecipesIfAbsentByName(existing, [candidate]);
    expect(added).toBe(0);
  });
  it("appends genuinely new recipes and de-dupes within the candidate batch", () => {
    const existing: CheeseRecipe[] = [];
    const { merged, added } = addCheeseRecipesIfAbsentByName(existing, [
      make({ id: "a", name: "Blend A" }),
      make({ id: "b", name: "blend a" }),
      make({ id: "c", name: "Blend B" }),
    ]);
    expect(added).toBe(2);
    expect(merged.map((r) => r.name)).toEqual(["Blend A", "Blend B"]);
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

describe("repointCheeseRecipesForBrandMerge", () => {
  it("rewrites the brand of recipes naming a merged-away source (case-insensitive)", () => {
    const recipes = [
      make({ id: "1", brand: "Bobo Pizza", name: "A" }),
      make({ id: "2", brand: "bobo's", name: "B" }),
      make({ id: "3", brand: "Other Co", name: "C" }),
    ];
    const changed = repointCheeseRecipesForBrandMerge(recipes, ["Bobo Pizza", "Bobo's"], "Bobo");
    expect(changed.map((r) => r.id)).toEqual(["1", "2"]);
    expect(changed.every((r) => r.brand === "Bobo")).toBe(true);
  });

  it("returns nothing when no recipe names a source, or the target is empty", () => {
    const recipes = [make({ id: "1", brand: "Alpha" })];
    expect(repointCheeseRecipesForBrandMerge(recipes, ["Zeta"], "Beta")).toEqual([]);
    expect(repointCheeseRecipesForBrandMerge(recipes, ["Alpha"], "   ")).toEqual([]);
  });

  it("ignores a source equal to the target (nothing to move)", () => {
    const recipes = [make({ id: "1", brand: "Alpha" })];
    expect(repointCheeseRecipesForBrandMerge(recipes, ["Alpha"], "Alpha")).toEqual([]);
  });

  describe("renameCheeseRecipesBrand", () => {
    it("renames every recipe in the customer group (case-insensitive) and returns only changed rows", () => {
      const recipes = [
        make({ id: "1", brand: "Corner Booth" }),
        make({ id: "2", brand: "corner booth" }),
        make({ id: "3", brand: "Other Co" }),
      ];
      const changed = renameCheeseRecipesBrand(recipes, "Corner Booth", "Cornerbooth");
      expect(changed.map((r) => r.id).sort()).toEqual(["1", "2"]);
      expect(changed.every((r) => r.brand === "Cornerbooth")).toBe(true);
    });

    it("allows a case-only respelling (unlike the merge repoint helper)", () => {
      const recipes = [make({ id: "1", brand: "aldos" })];
      const changed = renameCheeseRecipesBrand(recipes, "aldos", "Aldos");
      expect(changed).toHaveLength(1);
      expect(changed[0].brand).toBe("Aldos");
    });

    it("merging into an existing customer's spelling rewrites only the source group's rows", () => {
      const recipes = [
        make({ id: "1", brand: "Aldo's Pizza" }),
        make({ id: "2", brand: "Aldo's" }),
      ];
      const changed = renameCheeseRecipesBrand(recipes, "Aldo's Pizza", "Aldo's");
      expect(changed.map((r) => r.id)).toEqual(["1"]);
      expect(changed[0].brand).toBe("Aldo's");
    });

    it("returns nothing for a blank target, a blank source, or an exact no-op", () => {
      const recipes = [make({ id: "1", brand: "Alpha" }), make({ id: "2", brand: "" })];
      expect(renameCheeseRecipesBrand(recipes, "Alpha", "   ")).toEqual([]);
      expect(renameCheeseRecipesBrand(recipes, "   ", "Beta")).toEqual([]);
      expect(renameCheeseRecipesBrand(recipes, "Alpha", "Alpha")).toEqual([]);
    });
  });

  describe("flavor merge re-pointing", () => {
    it("rewrites source flavors to the target only within the merged brand, de-duping", () => {
      const recipes = [
        make({ id: "1", brand: "Bobo", flavors: ["Pep", "pepperoni", "Cheese"] }),
        // Same source flavor, but a DIFFERENT brand — flavor merges are per-brand.
        make({ id: "2", brand: "Other", flavors: ["Pep"] }),
        // "All Varieties" (empty flavors) already covers everything — left alone.
        make({ id: "3", brand: "Bobo", flavors: [] }),
      ];
      const changed = repointCheeseRecipesForFlavorMerge(
        recipes,
        "Bobo",
        ["Pep", "pepperoni"],
        "Pepperoni",
      );
      expect(changed.map((r) => r.id)).toEqual(["1"]);
      // The two sources collapse into one target entry; order preserved.
      expect(changed[0].flavors).toEqual(["Pepperoni", "Cheese"]);
    });

    it("returns nothing without a brand, without a target, or on a no-op", () => {
      const recipes = [make({ id: "1", brand: "Bobo", flavors: ["Pep"] })];
      expect(repointCheeseRecipesForFlavorMerge(recipes, "   ", ["Pep"], "Pepperoni")).toEqual([]);
      expect(repointCheeseRecipesForFlavorMerge(recipes, "Bobo", ["Pep"], "   ")).toEqual([]);
      expect(repointCheeseRecipesForFlavorMerge(recipes, "Bobo", ["Pep"], "Pep")).toEqual([]);
    });
  });

  it("end-to-end: after a brand merge the two brands' cheese recipes collapse into ONE group (the reported bug)", () => {
    // Two brands, each with its own cheese recipe — the manager merges them.
    const existing = [
      make({ id: "1", brand: "Bobo Pizza", name: "Whole Mozz" }),
      make({ id: "2", brand: "Bobo's", name: "Part-Skim" }),
    ];
    // Repoint → upsert only the changed rows (mirrors the app: POST upserts by
    // id) → group for the manager UI.
    const changed = repointCheeseRecipesForBrandMerge(existing, ["Bobo Pizza", "Bobo's"], "Bobo");
    const merged = mergeCheeseRecipes(existing, changed);
    const groups = groupCheeseRecipesByBrand(merged);
    // Previously this produced two separate headings; now it is a single brand.
    expect(groups.map((g) => g.brand)).toEqual(["Bobo"]);
    expect(groups[0].recipes.map((r) => r.name).sort()).toEqual(["Part-Skim", "Whole Mozz"]);
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

describe("repointCheeseRecipeIngredients", () => {
  it("rewrites matching component ingredient names (case-insensitive) and returns only changed recipes", () => {
    const recipes = [
      make({ id: "1", components: [{ ingredient: "Mozz", lbs: 10 }, { ingredient: "Provolone", lbs: 5 }] }),
      make({ id: "2", components: [{ ingredient: "Cheddar", lbs: 3 }] }),
    ];
    const changed = repointCheeseRecipeIngredients(recipes, ["mozz"], "Mozzarella");
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe("1");
    expect(changed[0].components).toEqual([
      { ingredient: "Mozzarella", lbs: 10 },
      { ingredient: "Provolone", lbs: 5 },
    ]);
  });

  it("keeps both rows (no combine) to preserve total weight", () => {
    const recipes = [make({ id: "1", components: [{ ingredient: "Mozz", lbs: 10 }, { ingredient: "Mozzarella", lbs: 5 }] })];
    const changed = repointCheeseRecipeIngredients(recipes, ["Mozz"], "Mozzarella");
    expect(changed[0].components).toEqual([
      { ingredient: "Mozzarella", lbs: 10 },
      { ingredient: "Mozzarella", lbs: 5 },
    ]);
    expect(cheeseRecipeTotalLbs(changed[0])).toBe(15);
  });

  it("returns [] for no matches, empty target, or a source equal to the target", () => {
    const recipes = [make({ id: "1", components: [{ ingredient: "Mozz", lbs: 10 }] })];
    expect(repointCheeseRecipeIngredients(recipes, ["Cheddar"], "Cheddar Cheese")).toEqual([]);
    expect(repointCheeseRecipeIngredients(recipes, ["Mozz"], "   ")).toEqual([]);
    expect(repointCheeseRecipeIngredients(recipes, ["Mozz"], "Mozz")).toEqual([]);
  });
});
