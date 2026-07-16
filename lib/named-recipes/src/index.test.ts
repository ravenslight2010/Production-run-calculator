import { describe, it, expect } from "vitest";
import {
  normalizeNamedRecipe,
  normalizeNamedRecipes,
  namedRecipeTotalLbs,
  namedRecipeMatchesQuery,
  sortNamedRecipesByName,
  namedRecipeFromDraft,
  addNamedRecipesIfAbsentByName,
  repointNamedRecipeIngredients,
  planNameConsolidation,
  fillNamedRecipeTags,
  fillNamedRecipeDoughballWeights,
  fillNamedRecipeDoughballsPerTray,
  normalizeDoughballVariants,
  mergeNamedRecipeDoughballVariants,
  matchDoughballVariant,
  type DoughballVariant,
  type NamedRecipe,
  type NamedRecipeTag,
} from "./index";

function makeNamed(over: Partial<NamedRecipe> = {}): NamedRecipe {
  return {
    id: over.id ?? "r1",
    name: over.name ?? "Dough A",
    notes: over.notes ?? "",
    components: over.components ?? [],
    enabled: over.enabled ?? true,
    brand: over.brand ?? "",
    flavors: over.flavors ?? [],
    ...(over.scope !== undefined ? { scope: over.scope } : {}),
    ...(over.doughballWeightOz !== undefined ? { doughballWeightOz: over.doughballWeightOz } : {}),
    ...(over.doughballsPerTray !== undefined ? { doughballsPerTray: over.doughballsPerTray } : {}),
    ...(over.doughballVariants !== undefined ? { doughballVariants: over.doughballVariants } : {}),
  };
}

describe("repointNamedRecipeIngredients", () => {
  it("rewrites matching component ingredient names (case-insensitive) and returns only changed recipes", () => {
    const recipes = [
      makeNamed({ id: "1", components: [{ ingredient: "Flour", lbs: 50 }, { ingredient: "Water", lbs: 30 }] }),
      makeNamed({ id: "2", components: [{ ingredient: "Yeast", lbs: 1 }] }),
    ];
    const changed = repointNamedRecipeIngredients(recipes, ["flour"], "Bread Flour");
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe("1");
    expect(changed[0].components).toEqual([
      { ingredient: "Bread Flour", lbs: 50 },
      { ingredient: "Water", lbs: 30 },
    ]);
  });

  it("keeps both rows (no combine) to preserve total weight", () => {
    const recipes = [makeNamed({ id: "1", components: [{ ingredient: "Flour", lbs: 50 }, { ingredient: "Bread Flour", lbs: 20 }] })];
    const changed = repointNamedRecipeIngredients(recipes, ["Flour"], "Bread Flour");
    expect(changed[0].components).toEqual([
      { ingredient: "Bread Flour", lbs: 50 },
      { ingredient: "Bread Flour", lbs: 20 },
    ]);
    expect(namedRecipeTotalLbs(changed[0])).toBe(70);
  });

  it("returns [] for no matches, empty target, or a source equal to the target", () => {
    const recipes = [makeNamed({ id: "1", components: [{ ingredient: "Flour", lbs: 50 }] })];
    expect(repointNamedRecipeIngredients(recipes, ["Water"], "Warm Water")).toEqual([]);
    expect(repointNamedRecipeIngredients(recipes, ["Flour"], "   ")).toEqual([]);
    expect(repointNamedRecipeIngredients(recipes, ["Flour"], "Flour")).toEqual([]);
  });
});

describe("normalizeNamedRecipe", () => {
  it("returns null without a usable name", () => {
    expect(normalizeNamedRecipe({ name: "  " })).toBeNull();
    expect(normalizeNamedRecipe(null)).toBeNull();
    expect(normalizeNamedRecipe(42)).toBeNull();
  });

  it("defaults enabled to true, notes to '', components to []", () => {
    const r = normalizeNamedRecipe({ name: "Dough A" });
    expect(r).toEqual({
      id: "dough a",
      name: "Dough A",
      notes: "",
      components: [],
      enabled: true,
      brand: "",
      flavors: [],
    });
  });

  it("keeps an explicit id and scope, clamps lbs, drops bad components", () => {
    const r = normalizeNamedRecipe({
      id: "dough:x",
      scope: "sandbox",
      name: " Dough X ",
      notes: " hi ",
      enabled: false,
      components: [
        { ingredient: " Flour ", lbs: "50" },
        { ingredient: "Water", lbs: -3 },
        { ingredient: "", lbs: 9 },
        "garbage",
      ],
    });
    expect(r).toEqual({
      id: "dough:x",
      scope: "sandbox",
      name: "Dough X",
      notes: "hi",
      enabled: false,
      components: [
        { ingredient: "Flour", lbs: 50 },
        { ingredient: "Water", lbs: 0 },
      ],
      brand: "",
      flavors: [],
    });
  });
});

describe("normalizeNamedRecipes", () => {
  it("drops malformed and collapses duplicate ids (last wins)", () => {
    const list = normalizeNamedRecipes([
      { id: "a", name: "First" },
      null,
      { id: "a", name: "Second" },
      { name: "  " },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Second");
  });
});

describe("namedRecipeTotalLbs", () => {
  it("sums component pounds", () => {
    const r = normalizeNamedRecipe({
      name: "x",
      components: [
        { ingredient: "a", lbs: 2 },
        { ingredient: "b", lbs: 3.5 },
      ],
    })!;
    expect(namedRecipeTotalLbs(r)).toBe(5.5);
  });
});

describe("namedRecipeMatchesQuery", () => {
  const r = normalizeNamedRecipe({
    name: "NY Dough",
    components: [{ ingredient: "Semolina", lbs: 1 }],
  })!;
  it("matches on name, ingredient, and empty query", () => {
    expect(namedRecipeMatchesQuery(r, "")).toBe(true);
    expect(namedRecipeMatchesQuery(r, "ny")).toBe(true);
    expect(namedRecipeMatchesQuery(r, "semol")).toBe(true);
    expect(namedRecipeMatchesQuery(r, "zzz")).toBe(false);
  });
});

describe("sortNamedRecipesByName", () => {
  it("sorts case-insensitively without mutating input", () => {
    const input = [
      normalizeNamedRecipe({ name: "banana" })!,
      normalizeNamedRecipe({ name: "Apple" })!,
    ];
    const sorted = sortNamedRecipesByName(input);
    expect(sorted.map((r) => r.name)).toEqual(["Apple", "banana"]);
    expect(input.map((r) => r.name)).toEqual(["banana", "Apple"]);
  });
});

describe("namedRecipeFromDraft", () => {
  it("builds a deterministic prefixed slug id", () => {
    const r = namedRecipeFromDraft({
      name: "12in NY Dough!",
      idPrefix: "dough",
      components: [{ ingredient: "Flour", lbs: 10 }],
    });
    expect(r?.id).toBe("dough:12in-ny-dough");
    expect(r?.name).toBe("12in NY Dough!");
    expect(r?.enabled).toBe(true);
    expect(r?.components).toEqual([{ ingredient: "Flour", lbs: 10 }]);
  });

  it("returns null for a blank name", () => {
    expect(
      namedRecipeFromDraft({ name: "   ", idPrefix: "sauce", components: [] }),
    ).toBeNull();
  });

  it("same name → same id (idempotent re-migration)", () => {
    const a = namedRecipeFromDraft({ name: "Marinara", idPrefix: "sauce", components: [] });
    const b = namedRecipeFromDraft({ name: " marinara ", idPrefix: "sauce", components: [] });
    expect(a?.id).toBe(b?.id);
  });
});

describe("addNamedRecipesIfAbsentByName", () => {
  const existing: NamedRecipe[] = [
    normalizeNamedRecipe({ id: "sauce:marinara", name: "Marinara" })!,
  ];

  it("skips existing names (case-insensitive) and ids, adds new", () => {
    const { merged, added } = addNamedRecipesIfAbsentByName(existing, [
      normalizeNamedRecipe({ id: "sauce:m2", name: "marinara" })!, // dup name
      normalizeNamedRecipe({ id: "sauce:marinara", name: "Other" })!, // dup id
      normalizeNamedRecipe({ id: "sauce:bbq", name: "BBQ" })!, // new
    ]);
    expect(added).toBe(1);
    expect(merged.map((r) => r.name)).toEqual(["Marinara", "BBQ"]);
  });

  it("skips a candidate that near-duplicates an existing name (typo / word order)", () => {
    const pool: NamedRecipe[] = [
      normalizeNamedRecipe({ id: "sauce:marinara", name: "Marinara" })!,
      normalizeNamedRecipe({ id: "dough:mystic-thin-dough", name: "Mystic Thin Dough" })!,
    ];
    const { merged, added } = addNamedRecipesIfAbsentByName(pool, [
      normalizeNamedRecipe({ id: "sauce:marinera", name: "Marinera" })!, // single typo
      normalizeNamedRecipe({ id: "dough:thin-mystic-dough", name: "Thin Mystic Dough" })!, // reorder
    ]);
    expect(added).toBe(0);
    expect(merged.map((r) => r.name)).toEqual(["Marinara", "Mystic Thin Dough"]);
  });

  it("still adds a candidate with a meaningful extra word (Spicy)", () => {
    const pool: NamedRecipe[] = [
      normalizeNamedRecipe({ id: "sauce:house-sauce", name: "House Sauce" })!,
    ];
    const { added } = addNamedRecipesIfAbsentByName(pool, [
      normalizeNamedRecipe({ id: "sauce:spicy-house-sauce", name: "Spicy House Sauce" })!,
    ]);
    expect(added).toBe(1);
  });
});

describe("planNameConsolidation", () => {
  it("classifies exact ci server matches as alreadyPresent", () => {
    const plan = planNameConsolidation({
      localNames: ["mystic pizza sauce", "New Sauce"],
      serverNames: ["Mystic Pizza Sauce"],
      genericTokens: ["sauce", "recipe"],
    });
    expect(plan.alreadyPresent).toEqual(["mystic pizza sauce"]);
    expect(plan.additions).toEqual(["New Sauce"]);
    expect(plan.renames).toEqual({});
  });

  it("folds generic-token variants onto the server spelling", () => {
    const plan = planNameConsolidation({
      localNames: ["Mystic", "Mystic Recipe", "mystic sauce"],
      serverNames: ["Mystic Pizza Sauce"],
      genericTokens: ["sauce", "recipe", "pizza"],
    });
    expect(plan.renames).toEqual({
      Mystic: "Mystic Pizza Sauce",
      "Mystic Recipe": "Mystic Pizza Sauce",
      "mystic sauce": "Mystic Pizza Sauce",
    });
    expect(plan.additions).toEqual([]);
    expect(plan.alreadyPresent).toEqual([]);
  });

  it("dedupes local-only variants onto one canonical addition", () => {
    const plan = planNameConsolidation({
      localNames: ["Lucia's Craft Sauce Recipe", "Lucia's Craft", "Lucias Craft Sauce"],
      serverNames: [],
      genericTokens: ["sauce", "recipe"],
    });
    expect(plan.additions).toEqual(["Lucia's Craft"]);
    expect(plan.renames["Lucia's Craft Sauce Recipe"]).toBe("Lucia's Craft");
    expect(plan.renames["Lucias Craft Sauce"]).toBe("Lucia's Craft");
  });

  it("prefers preferAsCanonical names over shorter spellings", () => {
    const plan = planNameConsolidation({
      localNames: ["Alfredo", "Alfredo Sauce"],
      serverNames: [],
      genericTokens: ["sauce", "recipe"],
      preferAsCanonical: (n) => n === "Alfredo Sauce",
    });
    expect(plan.additions).toEqual(["Alfredo Sauce"]);
    expect(plan.renames).toEqual({ Alfredo: "Alfredo Sauce" });
  });

  it("does NOT fold a qualified name into a base name (extra-word layer stays off)", () => {
    const plan = planNameConsolidation({
      localNames: ["Garlic Alfredo"],
      serverNames: ["Alfredo Sauce"],
      genericTokens: ["sauce", "recipe"],
    });
    expect(plan.renames).toEqual({});
    expect(plan.additions).toEqual(["Garlic Alfredo"]);
  });

  it("keeps a name that IS only a generic token instead of matching everything", () => {
    const plan = planNameConsolidation({
      localNames: ["Sauce"],
      serverNames: ["Marinara Sauce"],
      genericTokens: ["sauce", "recipe"],
    });
    expect(plan.additions).toEqual(["Sauce"]);
    expect(plan.renames).toEqual({});
  });

  it("digit guard: sizes never cross-match", () => {
    const plan = planNameConsolidation({
      localNames: ["12in NY Dough"],
      serverNames: ["16in NY Dough"],
      genericTokens: ["dough", "recipe"],
    });
    expect(plan.additions).toEqual(["12in NY Dough"]);
    expect(plan.renames).toEqual({});
  });

  it("drops blank and ci-duplicate local names", () => {
    const plan = planNameConsolidation({
      localNames: ["  ", "CRB Dough", "crb dough"],
      serverNames: [],
      genericTokens: ["dough", "recipe"],
    });
    expect(plan.additions).toEqual(["CRB Dough"]);
    expect(plan.renames).toEqual({});
  });
});

describe("normalizeNamedRecipe brand/flavor tags", () => {
  it("defaults older records to untagged", () => {
    const r = normalizeNamedRecipe({ id: "d1", name: "CRB Dough" })!;
    expect(r.brand).toBe("");
    expect(r.flavors).toEqual([]);
  });

  it("keeps brand + ci-deduped flavors", () => {
    const r = normalizeNamedRecipe({
      id: "d1",
      name: "CRB Dough",
      brand: " Hannaford ",
      flavors: ["Cheese", " cheese ", "", "Pepperoni"],
    })!;
    expect(r.brand).toBe("Hannaford");
    expect(r.flavors).toEqual(["Cheese", "Pepperoni"]);
  });

  it("drops flavors when no brand is set (a flavor tag is meaningless alone)", () => {
    const r = normalizeNamedRecipe({
      id: "d1",
      name: "CRB Dough",
      flavors: ["Cheese"],
    })!;
    expect(r.brand).toBe("");
    expect(r.flavors).toEqual([]);
  });
});

describe("fillNamedRecipeTags", () => {
  const tag = (brand: string, flavors: string[] = []): NamedRecipeTag => ({ brand, flavors });

  it("tags an untagged recipe by ci name match, returns only changed", () => {
    const pool = [
      makeNamed({ id: "d1", name: "CRB Dough" }),
      makeNamed({ id: "d2", name: "Other Dough" }),
    ];
    const changed = fillNamedRecipeTags(pool, new Map([["crb dough", tag("Hannaford", ["Cheese"])]]));
    expect(changed.map((r) => r.id)).toEqual(["d1"]);
    expect(changed[0].brand).toBe("Hannaford");
    expect(changed[0].flavors).toEqual(["Cheese"]);
    // pure — input untouched
    expect(pool[0].brand).toBe("");
  });

  it("unions flavors for the same brand (ci) and skips no-op unions", () => {
    const pool = [makeNamed({ id: "d1", name: "CRB Dough", brand: "hannaford", flavors: ["Cheese"] })];
    const changed = fillNamedRecipeTags(pool, new Map([["crb dough", tag("Hannaford", ["cheese", "Pepperoni"])]]));
    expect(changed).toHaveLength(1);
    expect(changed[0].flavors).toEqual(["Cheese", "Pepperoni"]);
    const noop = fillNamedRecipeTags(pool, new Map([["crb dough", tag("Hannaford", ["cheese"])]]));
    expect(noop).toEqual([]);
  });

  it("all-varieties is sticky, and a whole-brand tag widens a flavored recipe", () => {
    const allVar = [makeNamed({ id: "d1", name: "CRB Dough", brand: "Hannaford", flavors: [] })];
    expect(fillNamedRecipeTags(allVar, new Map([["crb dough", tag("Hannaford", ["Cheese"])]]))).toEqual([]);
    const flavored = [makeNamed({ id: "d1", name: "CRB Dough", brand: "Hannaford", flavors: ["Cheese"] })];
    const widened = fillNamedRecipeTags(flavored, new Map([["crb dough", tag("Hannaford")]]));
    expect(widened).toHaveLength(1);
    expect(widened[0].flavors).toEqual([]);
  });

  it("never overrides a different manager-set brand", () => {
    const pool = [makeNamed({ id: "d1", name: "CRB Dough", brand: "Lucia", flavors: ["Cheese"] })];
    expect(fillNamedRecipeTags(pool, new Map([["crb dough", tag("Hannaford", ["Pepperoni"])]]))).toEqual([]);
  });

  it("ignores blank names and blank-brand tags", () => {
    const pool = [makeNamed({ id: "d1", name: "CRB Dough" })];
    expect(fillNamedRecipeTags(pool, new Map([["  ", tag("Hannaford")], ["crb dough", tag("  ")]]))).toEqual([]);
  });
});

describe("doughballWeightOz", () => {
  it("normalize keeps a positive weight and drops 0/negative/garbage", () => {
    const keep = normalizeNamedRecipe({ id: "d1", name: "CRB Dough", doughballWeightOz: 5.5 })!;
    expect(keep.doughballWeightOz).toBe(5.5);
    for (const bad of [0, -3, "x", null, undefined]) {
      const r = normalizeNamedRecipe({ id: "d1", name: "CRB Dough", doughballWeightOz: bad })!;
      expect(r.doughballWeightOz).toBeUndefined();
    }
  });

  it("namedRecipeFromDraft threads the weight through", () => {
    const r = namedRecipeFromDraft({
      name: "CRB Dough",
      components: [{ ingredient: "Flour", lbs: 50 }],
      idPrefix: "dough",
      doughballWeightOz: 6.25,
    })!;
    expect(r.doughballWeightOz).toBe(6.25);
    const none = namedRecipeFromDraft({
      name: "CRB Dough",
      components: [],
      idPrefix: "dough",
    })!;
    expect(none.doughballWeightOz).toBeUndefined();
  });
});

describe("fillNamedRecipeDoughballWeights", () => {
  it("backfills only unset weights by ci name, returns only changed, pure", () => {
    const pool = [
      makeNamed({ id: "d1", name: "CRB Dough" }),
      makeNamed({ id: "d2", name: "Thin Dough", doughballWeightOz: 4 }),
      makeNamed({ id: "d3", name: "Other Dough" }),
    ];
    const changed = fillNamedRecipeDoughballWeights(
      pool,
      new Map([
        ["crb dough", 5.5],
        ["thin dough", 9], // must NOT override the manager's 4
      ]),
    );
    expect(changed.map((r) => r.id)).toEqual(["d1"]);
    expect(changed[0].doughballWeightOz).toBe(5.5);
    expect(pool[0].doughballWeightOz).toBeUndefined(); // pure
    expect(pool[1].doughballWeightOz).toBe(4);
  });

  it("ignores blank names and non-positive/non-finite weights", () => {
    const pool = [makeNamed({ id: "d1", name: "CRB Dough" })];
    expect(
      fillNamedRecipeDoughballWeights(pool, new Map([["  ", 5], ["crb dough", 0], ["crb dough", NaN]])),
    ).toEqual([]);
    expect(fillNamedRecipeDoughballWeights(pool, {})).toEqual([]);
  });
});

describe("fillNamedRecipeDoughballsPerTray", () => {
  it("backfills only unset per-tray counts by ci name, rounds, returns only changed, pure", () => {
    const pool = [
      makeNamed({ id: "d1", name: "CRB Dough" }),
      makeNamed({ id: "d2", name: "Thin Dough", doughballsPerTray: 12 }),
      makeNamed({ id: "d3", name: "Other Dough" }),
    ];
    const changed = fillNamedRecipeDoughballsPerTray(
      pool,
      new Map([
        ["crb dough", 15.4],
        ["thin dough", 20], // must NOT override the manager's 12
      ]),
    );
    expect(changed.map((r) => r.id)).toEqual(["d1"]);
    expect(changed[0].doughballsPerTray).toBe(15);
    expect(pool[0].doughballsPerTray).toBeUndefined(); // pure
    expect(pool[1].doughballsPerTray).toBe(12);
  });

  it("ignores blank names and non-positive/non-finite counts", () => {
    const pool = [makeNamed({ id: "d1", name: "CRB Dough" })];
    expect(
      fillNamedRecipeDoughballsPerTray(pool, new Map([["  ", 5], ["crb dough", 0], ["crb dough", NaN]])),
    ).toEqual([]);
    expect(fillNamedRecipeDoughballsPerTray(pool, {})).toEqual([]);
  });
});

describe("normalizeDoughballVariants", () => {
  it("drops blank labels and rows with neither number, coerces types", () => {
    expect(normalizeDoughballVariants(null)).toEqual([]);
    expect(normalizeDoughballVariants("nope")).toEqual([]);
    expect(
      normalizeDoughballVariants([
        { label: "  ", weightOz: 10 },
        { label: "No Numbers" },
        { label: "No Numbers 2", weightOz: 0, perTray: 0 },
        null,
        { label: ' 11" CRB ', weightOz: "10.5", perTray: "24.6" },
      ]),
    ).toEqual([{ label: '11" CRB', weightOz: 10.5, perTray: 25 }]);
  });

  it("collapses duplicate labels (ci): first occurrence's set fields win, later fill gaps", () => {
    expect(
      normalizeDoughballVariants([
        { label: "CRB Heavy", weightOz: 10 },
        { label: "crb heavy", weightOz: 12, perTray: 20 },
      ]),
    ).toEqual([{ label: "CRB Heavy", weightOz: 10, perTray: 20 }]);
  });
});

describe("mergeNamedRecipeDoughballVariants", () => {
  it("appends new labels, updates existing labels' values, returns only changed, pure", () => {
    const pool = [
      makeNamed({ id: "d1", name: "CRB Dough", doughballVariants: [{ label: '11" CRB', weightOz: 10 }] }),
      makeNamed({ id: "d2", name: "Thin Dough", doughballVariants: [{ label: "Thin", weightOz: 8 }] }),
      makeNamed({ id: "d3", name: "Other Dough" }),
    ];
    const changed = mergeNamedRecipeDoughballVariants(
      pool,
      new Map<string, DoughballVariant[]>([
        ["crb dough", [{ label: '11" crb', weightOz: 11, perTray: 24 }, { label: '14" CRB', weightOz: 16 }]],
        ["thin dough", [{ label: "Thin", weightOz: 8 }]], // identical → no change
      ]),
    );
    expect(changed.map((r) => r.id)).toEqual(["d1"]);
    expect(changed[0].doughballVariants).toEqual([
      { label: '11" CRB', weightOz: 11, perTray: 24 },
      { label: '14" CRB', weightOz: 16 },
    ]);
    // pure — pool untouched
    expect(pool[0].doughballVariants).toEqual([{ label: '11" CRB', weightOz: 10 }]);
  });

  it("seeds variants onto a recipe that had none and never removes existing ones", () => {
    const pool = [makeNamed({ id: "d1", name: "CRB Dough", doughballVariants: [{ label: "Legacy", perTray: 18 }] })];
    const changed = mergeNamedRecipeDoughballVariants(
      pool,
      new Map([["crb dough", [{ label: "New", weightOz: 9 }]]]),
    );
    expect(changed[0].doughballVariants).toEqual([
      { label: "Legacy", perTray: 18 },
      { label: "New", weightOz: 9 },
    ]);
  });
});

describe("matchDoughballVariant", () => {
  const variants: DoughballVariant[] = [
    { label: '11" CRB', weightOz: 10, perTray: 24 },
    { label: '14" CRB', weightOz: 16, perTray: 15 },
  ];

  it("returns the only variant regardless of die type", () => {
    expect(matchDoughballVariant([{ label: "Solo", weightOz: 9 }], { dieType: "" }))
      .toEqual({ label: "Solo", weightOz: 9 });
  });

  it("matches when the die size number appears in exactly one label", () => {
    expect(matchDoughballVariant(variants, { dieType: "11 inch" })?.label).toBe('11" CRB');
    expect(matchDoughballVariant(variants, { dieType: '14"' })?.label).toBe('14" CRB');
  });

  it("returns null when ambiguous, no die number, or no label carries the number", () => {
    expect(matchDoughballVariant(variants, { dieType: "round" })).toBeNull();
    expect(matchDoughballVariant(variants, { dieType: "12 inch" })).toBeNull();
    expect(
      matchDoughballVariant(
        [{ label: '11" A', weightOz: 1 }, { label: '11" B', weightOz: 2 }],
        { dieType: "11" },
      ),
    ).toBeNull();
    expect(matchDoughballVariant(undefined, { dieType: "11" })).toBeNull();
    expect(matchDoughballVariant([], { dieType: "11" })).toBeNull();
  });

  it("does not treat a substring digit as a match (11 vs 114)", () => {
    expect(
      matchDoughballVariant(
        [{ label: "114mm die", weightOz: 5 }, { label: "other", perTray: 3 }],
        { dieType: "11 inch" },
      ),
    ).toBeNull();
  });
});
