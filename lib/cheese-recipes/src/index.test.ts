import { describe, it, expect } from "vitest";
import {
  normalizeCheeseRecipe,
  normalizeCheeseRecipes,
  normalizeCheeseComponent,
  cheeseRecipeTotalLbs,
  cheeseComponentShares,
  cheesePerFlavorComponentOz,
  backfillCheeseSharePcts,
  addCheeseRecipesIfAbsent,
  addCheeseRecipesIfAbsentByName,
  specCheeseDraftToRecipe,
  mergeCheeseRecipes,
  repointCheeseRecipesForBrandMerge,
  renameCheeseRecipesBrand,
  repointCheeseRecipesForFlavorMerge,
  repointCheeseRecipeIngredients,
  catchAllPreviewSkipReason,
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
});

describe("addCheeseRecipesIfAbsentByName", () => {
  it("skips a candidate whose name already exists (case-insensitive) — match, don't clobber", () => {
    const existing = [make({ id: "curated", name: "Cheese Blend", brand: "Curated" })];
    // Same brand scope — a cross-brand collision now brand-prefixes instead
    // (see the brand-scope describe block below).
    const candidate = make({ id: "cheese:spec:cheese-blend", name: "cheese blend", brand: "Curated" });
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

describe("cheeseComponentShares", () => {
  it("prefers explicit sharePct over ozPerPizza and lbs", () => {
    const shares = cheeseComponentShares([
      { ingredient: "Mozz", lbs: 100, ozPerPizza: 1, sharePct: 75 },
      { ingredient: "Cheddar", lbs: 1, ozPerPizza: 9, sharePct: 25 },
    ]);
    expect(shares).toEqual([0.75, 0.25]);
  });

  it("falls back to lbs proportions when sharePct is absent", () => {
    expect(
      cheeseComponentShares([
        { ingredient: "Mozz", lbs: 30 },
        { ingredient: "Cheddar", lbs: 10 },
      ]),
    ).toEqual([0.75, 0.25]);
  });

  it("zero-lbs rows are excluded from the lbs total and receive a 0 share", () => {
    const shares = cheeseComponentShares([
      { ingredient: "Mozz", lbs: 10 },
      { ingredient: "Spec-only", lbs: 0 },
    ]);
    expect(shares).toEqual([1, 0]);
  });

  it("normalizes odd sharePct totals and returns zeros with no usable numbers", () => {
    const shares = cheeseComponentShares([
      { ingredient: "A", lbs: 0, sharePct: 60 },
      { ingredient: "B", lbs: 0, sharePct: 20 },
    ]);
    expect(shares[0]).toBeCloseTo(0.75);
    expect(shares[1]).toBeCloseTo(0.25);
    expect(cheeseComponentShares([{ ingredient: "A", lbs: 0 }])).toEqual([0]);
  });
});

describe("cheesePerFlavorComponentOz", () => {
  it("splits the flavor's target oz by blend share and sums back to it", () => {
    const { rows, totalOz } = cheesePerFlavorComponentOz(
      [
        { ingredient: "Mozz", lbs: 0, sharePct: 75 },
        { ingredient: "Cheddar", lbs: 0, sharePct: 25 },
      ],
      4,
    );
    expect(rows).toEqual([3, 1]);
    expect(totalOz).toBe(4);
  });

  it("clamps a bad target to 0", () => {
    expect(cheesePerFlavorComponentOz([{ ingredient: "A", lbs: 1 }], -2).totalOz).toBe(0);
    expect(cheesePerFlavorComponentOz([{ ingredient: "A", lbs: 1 }], NaN).totalOz).toBe(0);
  });
});

describe("backfillCheeseSharePcts", () => {
  const base = {
    id: "r1",
    name: "Blend",
    brand: "Acme",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    enabled: true,
  };

  it("fills sharePct from lbs proportions where absent (2dp)", () => {
    const [changed] = backfillCheeseSharePcts([
      { ...base, components: [
        { ingredient: "Mozz", lbs: 60 },
        { ingredient: "Cheddar", lbs: 40 },
      ] },
    ]);
    expect(changed.components.map((c) => c.sharePct)).toEqual([60, 40]);
  });

  it("never rewrites an existing sharePct and skips recipes with no numbers", () => {
    const withPct = { ...base, id: "a", components: [
      { ingredient: "Mozz", lbs: 10, sharePct: 50 },
      { ingredient: "Cheddar", lbs: 10, sharePct: 50 },
    ] };
    const empty = { ...base, id: "b", components: [{ ingredient: "X", lbs: 0 }] };
    expect(backfillCheeseSharePcts([withPct, empty])).toEqual([]);
  });

  it("returns only the changed recipes", () => {
    const out = backfillCheeseSharePcts([
      { ...base, id: "a", components: [{ ingredient: "Mozz", lbs: 10, sharePct: 100 }] },
      { ...base, id: "b", components: [{ ingredient: "Mozz", lbs: 10 }, { ingredient: "Ched", lbs: 30 }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
    expect(out[0].components.map((c) => c.sharePct)).toEqual([25, 75]);
  });
});

describe("catchAllPreviewSkipReason", () => {
  const known = ["SMD Supreme Cheese Mix", "SMD BBQ Chicken Cheese Mix"];

  it("skips a flavor whose slot links to a different existing recipe", () => {
    expect(
      catchAllPreviewSkipReason(
        ["SMD BBQ Chicken Cheese Mix"],
        "SMD Supreme Cheese Mix",
        known,
      ),
    ).toBe("SMD BBQ Chicken Cheese Mix");
  });

  it("never skips when any slot links to this recipe itself", () => {
    expect(
      catchAllPreviewSkipReason(
        ["SMD BBQ Chicken Cheese Mix", "smd supreme cheese mix"],
        "SMD Supreme Cheese Mix",
        known,
      ),
    ).toBeNull();
  });

  it("matches slot names case-insensitively and returns the canonical name", () => {
    expect(
      catchAllPreviewSkipReason(
        ["smd bbq chicken cheese mix"],
        "SMD Supreme Cheese Mix",
        known,
      ),
    ).toBe("SMD BBQ Chicken Cheese Mix");
  });

  it("ignores slot names that do not match any known recipe (stale links)", () => {
    expect(
      catchAllPreviewSkipReason(
        ["Deleted Old Mix"],
        "SMD Supreme Cheese Mix",
        known,
      ),
    ).toBeNull();
  });

  it("returns null with no slot links or empty inputs", () => {
    expect(catchAllPreviewSkipReason([], "SMD Supreme Cheese Mix", known)).toBeNull();
    expect(catchAllPreviewSkipReason(["", "  "], "SMD Supreme Cheese Mix", known)).toBeNull();
    expect(
      catchAllPreviewSkipReason(["SMD BBQ Chicken Cheese Mix"], "SMD Supreme Cheese Mix", []),
    ).toBeNull();
  });
});

describe("addCheeseRecipesIfAbsentByName brand scope", () => {
  it("same name under a DIFFERENT brand is added brand-prefixed with a re-derived spec id", () => {
    const existing = [make({ id: "cheese:spec:taco-mix", name: "Taco Mix", brand: "Marco's" })];
    const { merged, added } = addCheeseRecipesIfAbsentByName(existing, [
      make({ id: "cheese:spec:taco-mix", name: "Taco Mix", brand: "Lucia's" }),
    ]);
    expect(added).toBe(1);
    expect(merged.map((r) => r.name)).toEqual(["Taco Mix", "Lucia's Taco Mix"]);
    expect(merged[1].id).toBe("cheese:spec:lucia-s-taco-mix");
  });

  it("re-import converges on the prefixed row (idempotent, no dup)", () => {
    const first = addCheeseRecipesIfAbsentByName(
      [make({ id: "cheese:spec:taco-mix", name: "Taco Mix", brand: "Marco's" })],
      [make({ id: "cheese:spec:taco-mix", name: "Taco Mix", brand: "Lucia's" })],
    ).merged;
    const { merged, added } = addCheeseRecipesIfAbsentByName(first, [
      make({ id: "cheese:spec:taco-mix", name: "Taco Mix", brand: "Lucia's" }),
    ]);
    expect(added).toBe(0);
    expect(merged).toHaveLength(2);
  });

  it("same-brand collision still links by name (never adds)", () => {
    const existing = [make({ id: "kept", name: "Taco Mix", brand: "Lucia's" })];
    const { added } = addCheeseRecipesIfAbsentByName(existing, [
      make({ id: "cheese:spec:taco-mix", name: "taco mix", brand: "Lucia's" }),
    ]);
    expect(added).toBe(0);
  });

  it("an unbranded pool recipe is shared — branded candidate links, not forks", () => {
    const existing = [make({ id: "shared", name: "Taco Mix", brand: "" })];
    const { added } = addCheeseRecipesIfAbsentByName(existing, [
      make({ id: "cheese:spec:taco-mix", name: "Taco Mix", brand: "Lucia's" }),
    ]);
    expect(added).toBe(0);
  });

  it("non-spec ids are kept as-is on prefix rename", () => {
    const existing = [make({ id: "a", name: "Taco Mix", brand: "Marco's" })];
    const { merged } = addCheeseRecipesIfAbsentByName(existing, [
      make({ id: "cheese:import:lucias:taco-mix", name: "Taco Mix", brand: "Lucia's" }),
    ]);
    expect(merged[1].id).toBe("cheese:import:lucias:taco-mix");
    expect(merged[1].name).toBe("Lucia's Taco Mix");
  });
});
