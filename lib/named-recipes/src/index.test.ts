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
  doughballVariantLabelKey,
  collapseDoughballVariantSuffixDuplicates,
  mergeNamedRecipeDoughballVariants,
  matchDoughballVariant,
  parseDoughCustomerSection,
  parseDoughVariantTable,
  applyDoughCustomerAssignmentsToVariants,
  type DoughballVariant,
  type DoughCustomerAssignment,
  type DoughVariantTableEntry,
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

describe("doughballVariantLabelKey", () => {
  it("strips the family name / generic dough words from the tail only", () => {
    expect(doughballVariantLabelKey("Corner Booth CRB Dough", "CRB Dough")).toBe("corner booth");
    expect(doughballVariantLabelKey("Corner Booth", "CRB Dough")).toBe("corner booth");
    expect(doughballVariantLabelKey("Basha's Ultra Thin CRB Dough", "CRB Dough")).toBe("bashas ultra thin");
    // middle tokens are never stripped
    expect(doughballVariantLabelKey("Lowe's CRB Heavier", "CRB Dough")).toBe("lowes crb heavier");
    expect(doughballVariantLabelKey("Lowe's 7 Inch", "CRB Dough")).toBe("lowes 7 inch");
  });

  it("never strips to empty — a label that IS the family name keeps a token", () => {
    expect(doughballVariantLabelKey("CRB Dough", "CRB Dough")).toBe("crb");
    expect(doughballVariantLabelKey("Dough", "CRB Dough")).toBe("dough");
  });
});

describe("normalizeDoughballVariants suffix folding", () => {
  it("folds a suffixed twin onto the base label when a recipe name is given", () => {
    expect(
      normalizeDoughballVariants(
        [
          { label: "Corner Booth", weightOz: 8.25, perTray: 20 },
          { label: "Corner Booth CRB Dough", weightOz: 8.25, perTray: 20 },
        ],
        "CRB Dough",
      ),
    ).toEqual([{ label: "Corner Booth", weightOz: 8.25, perTray: 20 }]);
  });

  it("keeps both when numbers contradict, and without a recipe name", () => {
    expect(
      normalizeDoughballVariants(
        [
          { label: "Corner Booth", weightOz: 8.25 },
          { label: "Corner Booth CRB Dough", weightOz: 9 },
        ],
        "CRB Dough",
      ),
    ).toHaveLength(2);
    expect(
      normalizeDoughballVariants([
        { label: "Corner Booth", weightOz: 8.25 },
        { label: "Corner Booth CRB Dough", weightOz: 8.25 },
      ]),
    ).toHaveLength(2);
  });
});

describe("collapseDoughballVariantSuffixDuplicates", () => {
  it("collapses the observed production duplicates, keeping base labels", () => {
    const collapsed = collapseDoughballVariantSuffixDuplicates(
      [
        { label: "Basha's Original/Lucia's New & Improved", weightOz: 6.9, perTray: 24 },
        { label: "Basha's Ultra Thin", weightOz: 5.5, perTray: 24 },
        { label: "Corner Booth", weightOz: 8.25, perTray: 20 },
        { label: "Hannaford, Lowe's, & SMD", weightOz: 7.6, perTray: 24 },
        { label: "Lowe's 7 Inch", weightOz: 4.25, perTray: 36 },
        { label: "Basha's Original/Lucia's New & Improved CRB Dough", weightOz: 6.9, perTray: 24 },
        { label: "Basha's Ultra Thin CRB Dough", weightOz: 5.5, perTray: 24 },
        { label: "Corner Booth CRB Dough", weightOz: 8.25, perTray: 20 },
        { label: "Hannaford, Lowe's, & SMD CRB Dough", weightOz: 7.6, perTray: 24 },
        { label: "Lowe's 7 Inch CRB Dough", weightOz: 4.25, perTray: 36 },
      ],
      "CRB Dough",
    );
    expect(collapsed?.map((v) => v.label)).toEqual([
      "Basha's Original/Lucia's New & Improved",
      "Basha's Ultra Thin",
      "Corner Booth",
      "Hannaford, Lowe's, & SMD",
      "Lowe's 7 Inch",
    ]);
    expect(collapsed?.every((v) => (v.weightOz ?? 0) > 0 && (v.perTray ?? 0) > 0)).toBe(true);
  });

  it("later set values win on a fold", () => {
    const collapsed = collapseDoughballVariantSuffixDuplicates(
      [
        { label: "Corner Booth", weightOz: 8.25 },
        { label: "Corner Booth CRB Dough", weightOz: 8.25, perTray: 20 },
      ],
      "CRB Dough",
    );
    expect(collapsed).toEqual([{ label: "Corner Booth", weightOz: 8.25, perTray: 20 }]);
  });

  it("never folds contradicting numbers or distinct labels; null when unchanged", () => {
    expect(
      collapseDoughballVariantSuffixDuplicates(
        [
          { label: "Lowe's CRB Heavier", weightOz: 9 },
          { label: "Lowe's 7 Inch", weightOz: 4.25 },
        ],
        "CRB Dough",
      ),
    ).toBeNull();
    expect(
      collapseDoughballVariantSuffixDuplicates(
        [
          { label: "Corner Booth", weightOz: 8.25 },
          { label: "Corner Booth CRB Dough", weightOz: 9 },
        ],
        "CRB Dough",
      ),
    ).toBeNull();
    expect(collapseDoughballVariantSuffixDuplicates([], "CRB Dough")).toBeNull();
  });
});

describe("mergeNamedRecipeDoughballVariants", () => {
  it("a suffixed incoming label UPDATES the existing base variant (no duplicate)", () => {
    const pool = [
      makeNamed({
        id: "d1",
        name: "CRB Dough",
        doughballVariants: [{ label: "Corner Booth", weightOz: 8.25, perTray: 20 }],
      }),
    ];
    const changed = mergeNamedRecipeDoughballVariants(
      pool,
      new Map([["crb dough", [{ label: "Corner Booth CRB Dough", weightOz: 8.25, perTray: 22 }]]]),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0].doughballVariants).toEqual([
      { label: "Corner Booth", weightOz: 8.25, perTray: 22 },
    ]);
  });

  it("a suffixed incoming label with a contradicting weight appends instead of clobbering", () => {
    const pool = [
      makeNamed({
        id: "d1",
        name: "CRB Dough",
        doughballVariants: [{ label: "Corner Booth", weightOz: 8.25 }],
      }),
    ];
    const changed = mergeNamedRecipeDoughballVariants(
      pool,
      new Map([["crb dough", [{ label: "Corner Booth CRB Dough", weightOz: 9 }]]]),
    );
    expect(changed[0].doughballVariants).toEqual([
      { label: "Corner Booth", weightOz: 8.25 },
      { label: "Corner Booth CRB Dough", weightOz: 9 },
    ]);
  });

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

  it("replace mode preserves existing customers when incoming has none (Bug 1 regression)", () => {
    // Scenario: re-import with updated weight but no parsed customers → customers
    // must survive, not be wiped. The incoming has a DIFFERENT weight so a real
    // change occurs, giving us a result to assert on.
    const pool = [
      makeNamed({
        id: "d1",
        name: "CRB Dough",
        doughballVariants: [
          { label: "Hannaford", weightOz: 7.6, customers: [{ brand: "Hannaford", flavor: "Five Cheese" }] },
          { label: "Costco", weightOz: 9.6, customers: [{ brand: "Costco", flavor: "" }] },
        ],
      }),
    ];
    const incoming = new Map<string, DoughballVariant[]>([
      ["crb dough", [
        { label: "Hannaford", weightOz: 7.7 }, // updated weight, no customers
        { label: "Costco", weightOz: 9.7 },    // updated weight, no customers
      ]],
    ]);
    const changed = mergeNamedRecipeDoughballVariants(pool, incoming, { replace: true });
    expect(changed).toHaveLength(1);
    const hannaford = changed[0].doughballVariants?.find((v) => v.label === "Hannaford");
    expect(hannaford?.weightOz).toBe(7.7);
    expect(hannaford?.customers).toContainEqual({ brand: "Hannaford", flavor: "Five Cheese" });
    const costco = changed[0].doughballVariants?.find((v) => v.label === "Costco");
    expect(costco?.weightOz).toBe(9.7);
    expect(costco?.customers).toContainEqual({ brand: "Costco", flavor: "" });
  });

  it("replace mode unions existing customers with newly-imported customers", () => {
    // Incoming has customers (BBQ Chicken), existing has customers (Five Cheese) →
    // both must appear after replace.
    const pool = [
      makeNamed({
        id: "d1",
        name: "CRB Dough",
        doughballVariants: [
          { label: "Hannaford", weightOz: 7.6, customers: [{ brand: "Hannaford", flavor: "Five Cheese" }] },
        ],
      }),
    ];
    const incoming = new Map<string, DoughballVariant[]>([
      ["crb dough", [
        { label: "Hannaford", weightOz: 7.7, customers: [{ brand: "Hannaford", flavor: "BBQ Chicken" }] },
      ]],
    ]);
    const changed = mergeNamedRecipeDoughballVariants(pool, incoming, { replace: true });
    expect(changed).toHaveLength(1);
    const hannaford = changed[0].doughballVariants?.find((v) => v.label === "Hannaford");
    expect(hannaford?.customers).toContainEqual({ brand: "Hannaford", flavor: "Five Cheese" });
    expect(hannaford?.customers).toContainEqual({ brand: "Hannaford", flavor: "BBQ Chicken" });
  });

  it("Bug 2 regression: variants keyed by family (remapped) name land on the correct pool recipe", () => {
    // Simulate what happens AFTER the Bug 2 remap in addNamedRecipesToServerIfAbsent:
    // parse produced "CRB Dough Procedure", pool has "CRB Dough".
    // The remap step re-keys "crb dough procedure" → "crb dough" before calling
    // mergeNamedRecipeDoughballVariants.  If that remap didn't happen, the map
    // lookup (pool key "crb dough" vs map key "crb dough procedure") would miss,
    // and no variants would ever be stored.
    const pool = [
      makeNamed({
        id: "d1",
        name: "CRB Dough", // pool recipe name
        doughballVariants: [],
      }),
    ];
    // effectiveVariants uses the POOL name as key (post-remap), not the parse name
    const incoming = new Map<string, DoughballVariant[]>([
      ["crb dough", [ // remapped from "crb dough procedure"
        {
          label: "Hannaford",
          weightOz: 7.6,
          customers: [{ brand: "Hannaford", flavor: "Five Cheese" }],
        },
      ]],
    ]);
    const changed = mergeNamedRecipeDoughballVariants(pool, incoming, { replace: false });
    expect(changed).toHaveLength(1);
    expect(changed[0].name).toBe("CRB Dough");
    const hannaford = changed[0].doughballVariants?.find((v) => v.label === "Hannaford");
    expect(hannaford?.customers).toContainEqual({ brand: "Hannaford", flavor: "Five Cheese" });
  });

  it("full re-import-after-heal scenario: customers set by a data heal survive repeated re-imports", () => {
    // Simulates the full round-trip:
    // 1. Data heal writes customers onto pool variants.
    // 2. Manager re-imports dough workbook (replace:true) — customers NOT in the parse.
    // 3. Customers must survive (Bug 1 fix).
    // 4. A second re-import must ALSO survive.
    // 5. A re-import that adds NEW customers keeps existing + adds new (additive union).

    const poolAfterHeal = [
      makeNamed({
        id: "d1",
        name: "CRB Dough",
        doughballVariants: [
          {
            label: "Lucia's Craft CRB Thick",
            weightOz: 13.8,
            customers: [
              { brand: "Lucia's Craft", flavor: "BBQ Chicken" },
              { brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" },
            ],
          },
          {
            label: "Lucia's Craft CRB Heavy Plus",
            weightOz: 12,
            customers: [{ brand: "Lucia's Craft", flavor: "" }],
          },
        ],
      }),
    ];

    // Re-import 1: same weights, NO customers in incoming (typical workbook re-import)
    const reimport1 = new Map<string, DoughballVariant[]>([
      ["crb dough", [
        { label: "Lucia's Craft CRB Thick", weightOz: 13.8 },
        { label: "Lucia's Craft CRB Heavy Plus", weightOz: 12 },
      ]],
    ]);
    const afterReimport1 = mergeNamedRecipeDoughballVariants(poolAfterHeal, reimport1, { replace: true });
    // No structural change (weights identical, customers preserved → enriched matches before)
    // so changed may be empty — that is correct behaviour. Apply result to pool.
    const pool1 = afterReimport1.length > 0
      ? poolAfterHeal.map((r) => afterReimport1.find((c) => c.id === r.id) ?? r)
      : poolAfterHeal;

    // Re-import 2: updated weight to force a change, still NO customers
    const reimport2 = new Map<string, DoughballVariant[]>([
      ["crb dough", [
        { label: "Lucia's Craft CRB Thick", weightOz: 13.9 }, // updated weight
        { label: "Lucia's Craft CRB Heavy Plus", weightOz: 12.1 },
      ]],
    ]);
    const afterReimport2 = mergeNamedRecipeDoughballVariants(pool1, reimport2, { replace: true });
    expect(afterReimport2).toHaveLength(1);
    const thick2 = afterReimport2[0].doughballVariants?.find(
      (v) => v.label === "Lucia's Craft CRB Thick",
    );
    expect(thick2?.weightOz).toBe(13.9);
    expect(thick2?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "BBQ Chicken" });
    expect(thick2?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" });
    const heavy2 = afterReimport2[0].doughballVariants?.find(
      (v) => v.label === "Lucia's Craft CRB Heavy Plus",
    );
    expect(heavy2?.weightOz).toBe(12.1);
    expect(heavy2?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "" });

    // Re-import 3: new import ALSO carries a new customer → union, not replace
    const pool2 = pool1.map((r) => afterReimport2.find((c) => c.id === r.id) ?? r);
    const reimport3 = new Map<string, DoughballVariant[]>([
      ["crb dough", [
        {
          label: "Lucia's Craft CRB Thick",
          weightOz: 13.9,
          customers: [{ brand: "Lucia's Craft", flavor: "House DLUX" }], // new flavor
        },
        { label: "Lucia's Craft CRB Heavy Plus", weightOz: 12.1 },
      ]],
    ]);
    const afterReimport3 = mergeNamedRecipeDoughballVariants(pool2, reimport3, { replace: true });
    expect(afterReimport3).toHaveLength(1);
    const thick3 = afterReimport3[0].doughballVariants?.find(
      (v) => v.label === "Lucia's Craft CRB Thick",
    );
    // Original heal customers still present
    expect(thick3?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "BBQ Chicken" });
    expect(thick3?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" });
    // New customer added from re-import 3
    expect(thick3?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "House DLUX" });
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

  it("matches by customers brand+flavor (specific) and ignores die type", () => {
    const vs: DoughballVariant[] = [
      {
        label: "Acme Thick",
        weightOz: 13.8,
        perTray: 16,
        customers: [{ brand: "Acme", flavor: "BBQ Chicken" }],
      },
      {
        label: "Acme Heavy",
        weightOz: 12,
        perTray: 16,
        customers: [{ brand: "Acme", flavor: "" }],
      },
    ];
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Acme", flavor: "BBQ Chicken" })?.weightOz,
    ).toBe(13.8);
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Acme", flavor: "Other Flavor" })?.weightOz,
    ).toBe(12);
  });

  it("specific flavor beats catch-all regardless of array order", () => {
    const catchAllFirst: DoughballVariant[] = [
      {
        label: "Brand Heavy",
        weightOz: 12,
        customers: [{ brand: "Brand", flavor: "" }],
      },
      {
        label: "Brand Thick",
        weightOz: 13.8,
        customers: [{ brand: "Brand", flavor: "BBQ" }],
      },
    ];
    expect(
      matchDoughballVariant(catchAllFirst, { dieType: "", brand: "Brand", flavor: "BBQ" })?.weightOz,
    ).toBe(13.8);
    expect(
      matchDoughballVariant(catchAllFirst, { dieType: "", brand: "Brand", flavor: "Other" })?.weightOz,
    ).toBe(12);
  });

  it("returns null when brand has no matching customer entry", () => {
    const vs: DoughballVariant[] = [
      { label: "A Thick", weightOz: 13.8, customers: [{ brand: "Acme", flavor: "BBQ" }] },
      { label: "A Heavy", weightOz: 12, customers: [{ brand: "Acme", flavor: "" }] },
    ];
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Other Brand", flavor: "BBQ" }),
    ).toBeNull();
  });

  it("Lowe's 7-inch catch-all does not shadow the base tier when no die-type context", () => {
    // Real CRB scenario:
    //   "Hannaford, Lowe's, & SMD" (7.6 oz) — base tier, has specific Lowe's flavors
    //   "Lowe's 7 Inch" (5.7 oz) — seveninch tier, catch-all "All" from "Lowe's 7\": All"
    //
    // A Lowe's profile with no specific flavor AND no 7-inch die context should land
    // on the base (7.6 oz) variant, NOT the 5.7 oz 7-inch variant.
    const vs: DoughballVariant[] = [
      {
        label: "Hannaford, Lowe's, & SMD",
        weightOz: 7.6,
        customers: [
          { brand: "Lowe's", flavor: "Californian" },
          { brand: "Lowe's", flavor: "Grilled Vegetable" },
          { brand: "SMD", flavor: "" },
        ],
      },
      {
        label: "Lowe's 7 Inch",
        weightOz: 5.7,
        customers: [{ brand: "Lowe's", flavor: "" }],
      },
    ];
    // No die-type context → must prefer the base variant because the only Lowe's
    // catch-all lives on a 7-inch (size) tier, not the base tier.
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Lowe's", flavor: "" })?.weightOz,
    ).toBe(7.6);
    // Specific flavor → still hits the base via Priority 1a.
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Lowe's", flavor: "Californian" })?.weightOz,
    ).toBe(7.6);
    // Explicit 7-inch die type → returns the 7-inch variant via the catch-all.
    expect(
      matchDoughballVariant(vs, { dieType: "7 inch", brand: "Lowe's", flavor: "" })?.weightOz,
    ).toBe(5.7);
  });

  it("prefers size-tier catch-all when profile flavor is absent from base tier (Bug 4 flavor tiebreaker)", () => {
    // Real CRB scenario: Lowe's has a base-tier catch-all on "Hannaford, Lowe's, & SMD"
    // with SPECIFIC flavors (Californian, Grilled Vegetable) and a size-tier catch-all
    // on "Lowe's 7 Inch" (flavor ""). A profile with a flavor NOT listed in the base tier
    // (e.g. "Seven Cheese") and no dieType should land on the size-tier variant because
    // the catch-all "Lowe's 7\": All" covers all 7-inch flavors including unlisted ones.
    const vs: DoughballVariant[] = [
      {
        label: "Hannaford, Lowe's, & SMD",
        weightOz: 7.6,
        customers: [
          { brand: "Lowe's", flavor: "Californian" },
          { brand: "Lowe's", flavor: "Grilled Vegetable" },
          { brand: "SMD", flavor: "" },
        ],
      },
      {
        label: "Lowe's 7 Inch",
        weightOz: 5.7,
        customers: [{ brand: "Lowe's", flavor: "" }],
      },
    ];
    // Flavor listed in base tier → base (7.6 oz) via Priority 1a
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Lowe's", flavor: "Californian" })?.weightOz,
    ).toBe(7.6);
    // Flavor NOT in base tier customers → prefer size-tier catch-all (5.7 oz)
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Lowe's", flavor: "Seven Cheese" })?.weightOz,
    ).toBe(5.7);
    // No flavor, no die-type → safe default is base (7.6 oz), unchanged from before
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Lowe's", flavor: "" })?.weightOz,
    ).toBe(7.6);
    // Explicit 7-inch die → size-tier (5.7 oz), unchanged from before
    expect(
      matchDoughballVariant(vs, { dieType: "7 inch", brand: "Lowe's", flavor: "" })?.weightOz,
    ).toBe(5.7);
  });

  it("SMD abbreviation matches Show Me Dough profile via initials (Priority 1.5)", () => {
    // The workbook stores "SMD CRB: All" so the customer entry brand is "SMD".
    // A profile that has brand "Show Me Dough" (full name) must still match.
    const vs: DoughballVariant[] = [
      {
        label: "Hannaford, Lowe's, & SMD",
        weightOz: 7.6,
        customers: [{ brand: "SMD", flavor: "" }],
      },
      { label: "Costco", weightOz: 9.6, customers: [{ brand: "Costco", flavor: "" }] },
    ];
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Show Me Dough", flavor: "" })?.weightOz,
    ).toBe(7.6);
    // Exact "SMD" brand still works too.
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "SMD", flavor: "" })?.weightOz,
    ).toBe(7.6);
  });

  it("7'' and 7-inch labels parse to the seveninch qualifier tier correctly", () => {
    // "FSD 7'' CRB" customer-section LHS must produce qualifierKey seveninch so
    // it only lands on the 7'' FSD variant (5.5 oz), not a base variant.
    const vs: DoughballVariant[] = [
      {
        label: "Hannaford, Lowe's, & SMD",
        weightOz: 7.6,
        customers: [
          { brand: "Hannaford", flavor: "Five Cheese" },
          { brand: "SMD", flavor: "" },
        ],
      },
      {
        label: "7'' FSD",
        weightOz: 5.5,
        customers: [
          { brand: "FSD", flavor: "Cheese" },
          { brand: "FSD", flavor: "M/L" },
        ],
      },
    ];
    // FSD specific flavor → correct 7'' variant
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "FSD", flavor: "Cheese" })?.weightOz,
    ).toBe(5.5);
    // Hannaford not contaminated by FSD assignments
    expect(
      matchDoughballVariant(vs, { dieType: "", brand: "Hannaford", flavor: "Five Cheese" })?.weightOz,
    ).toBe(7.6);
  });
});

// ---------------------------------------------------------------------------
// parseDoughCustomerSection
// ---------------------------------------------------------------------------

describe("parseDoughCustomerSection", () => {
  it("parses base-variant (no qualifier keyword) entries", () => {
    const rows: string[][] = [
      ["Hannaford CRB: Five Cheese, BBQ Chicken"],
      ["Costco: All"],
      ["SMD CRB: All"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ brand: "Hannaford", qualifierKey: "" });
    expect(result[0].flavors).toEqual(["Five Cheese", "BBQ Chicken"]);
    expect(result[1]).toMatchObject({ brand: "Costco", qualifierKey: "", flavors: [""] });
    expect(result[2]).toMatchObject({ brand: "SMD", qualifierKey: "", flavors: [""] });
  });

  it("parses qualified entries with the correct qualifier key", () => {
    const rows: string[][] = [
      ["Lucia's Craft CRB Ultra Thin: Sweet Chili Garden, Backyard BBQ Chicken"],
      ["Lucia's Craft CRB Heavy Plus: Four Cheese Meltdown"],
      ["Hannaford CRB Heavy Plus: Spicy 4 Cheese, Spinach Goat Cheese"],
      ["Lowe's CRB Heavier: Spinach Mushroom"],
      ["Hannaford CRB Thick: Chicken Bacon Club"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result[0]).toMatchObject({ brand: "Lucia's Craft", qualifierKey: "ultra thin" });
    expect(result[0].flavors).toEqual(["Sweet Chili Garden", "Backyard BBQ Chicken"]);
    expect(result[1]).toMatchObject({ brand: "Lucia's Craft", qualifierKey: "heavy plus", flavors: ["Four Cheese Meltdown"] });
    expect(result[2]).toMatchObject({ brand: "Hannaford", qualifierKey: "heavy plus" });
    expect(result[3]).toMatchObject({ brand: "Lowe's", qualifierKey: "heavier", flavors: ["Spinach Mushroom"] });
    expect(result[4]).toMatchObject({ brand: "Hannaford", qualifierKey: "thick", flavors: ["Chicken Bacon Club"] });
  });

  it("treats 'All' as a catch-all empty string flavor", () => {
    const rows: string[][] = [["Corner Booth: All"]];
    const result = parseDoughCustomerSection(rows);
    expect(result[0].flavors).toEqual([""]);
  });

  it("strips 'CRB' and qualifier from the brand name", () => {
    // "Basha's Ultra Thin" → brand "Basha's", qualifierKey "ultra thin"
    const rows: string[][] = [["Basha's Ultra Thin: All"]];
    const result = parseDoughCustomerSection(rows);
    expect(result[0]).toMatchObject({ brand: "Basha's", qualifierKey: "ultra thin", flavors: [""] });
  });

  it("parses 7-inch die-size entries to qualifierKey seveninch and strips the size from the brand", () => {
    // "Lowe's 7\": All" and "FSD 7'' CRB: Cheese, M/L" are die-size rows.
    // qualifierKey must be "seveninch" (not "") so they don't shadow base-tier assignments.
    const rows: string[][] = [
      ["Lowe's CRB: Californian, Grilled Vegetable"],
      ['Lowe\'s 7": All'],
      ["FSD 7'' CRB: Cheese, M/L, Pepperoni"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ brand: "Lowe's", qualifierKey: "", flavors: ["Californian", "Grilled Vegetable"] });
    expect(result[1]).toMatchObject({ brand: "Lowe's", qualifierKey: "seveninch", flavors: [""] });
    expect(result[2]).toMatchObject({ brand: "FSD", qualifierKey: "seveninch", flavors: ["Cheese", "M/L", "Pepperoni"] });
  });

  it("skips numeric rows but does NOT stop — customer section may be below the formula table", () => {
    const rows: string[][] = [
      ["Hannaford CRB: Five Cheese"],
      ["", "45.5", "22"],   // numeric in later columns — skipped (no colon in col 0)
      ["SMD CRB: All"],     // MUST still be parsed (customer section is after formula)
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(2);
    expect(result[0].brand).toBe("Hannaford");
    expect(result[1].brand).toBe("SMD");
  });

  it("parses customer assignments that appear after the yield table (bottom of sheet)", () => {
    const rows: string[][] = [
      // yield table header row
      ["", "OZ.", "LBS.", "YIELD", "PER TRAY"],
      // yield table data rows (numeric in later columns — skipped by colon guard)
      ["Hannaford, Lowe's, & SMD", "7.6", "0.48", "673.47", "24"],
      ["Corner Booth", "8.25", "0.52", "620.41", "24"],
      [""],
      // customer assignments section below the yield table
      ["Costco: All"],
      ["Corner Booth: All"],
      ["Lowe's CRB: Caribbean, Five Cheese"],
      ["Lowe's CRB Heavier: Spinach Mushroom"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(4);
    // Brand names: qualifiers and "CRB" stripped; base entries have qualifierKey ""
    expect(result[0]).toMatchObject({ brand: "Costco", qualifierKey: "", flavors: [""] });
    expect(result[1]).toMatchObject({ brand: "Corner Booth", qualifierKey: "", flavors: [""] });
    expect(result[2]).toMatchObject({ brand: "Lowe's", qualifierKey: "", flavors: ["Caribbean", "Five Cheese"] });
    expect(result[3]).toMatchObject({ brand: "Lowe's", qualifierKey: "heavier", flavors: ["Spinach Mushroom"] });
  });

  it("finds customer assignments in non-zero columns (right-hand column layout)", () => {
    // Some workbook revisions place the customer section in a column to the
    // right of the yield table rather than in column 0.
    const rows: string[][] = [
      ["", "OZ.", "LBS.", "YIELD", "PER TRAY", "", "Basha's Original: All"],
      ["Costco", "", "9.6", "0.6", "533", "20", "Costco: All"],
      ["Hannaford CRB", "", "7.6", "0.48", "673", "24", "Hannaford CRB: Five Cheese, BBQ Chicken"],
      ["Four Hands CRB Heavy", "", "8.7", "0.54", "588", "24", "Lowe's CRB Heavier: Spinach Mushroom"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ brand: "Basha's Original", qualifierKey: "", flavors: [""] });
    expect(result[1]).toMatchObject({ brand: "Costco", qualifierKey: "", flavors: [""] });
    expect(result[2]).toMatchObject({ brand: "Hannaford", qualifierKey: "", flavors: ["Five Cheese", "BBQ Chicken"] });
    expect(result[3]).toMatchObject({ brand: "Lowe's", qualifierKey: "heavier", flavors: ["Spinach Mushroom"] });
  });

  it("skips rows without a colon or with empty sides", () => {
    const rows: string[][] = [
      ["Dough Mixing Procedure"],
      [""],
      [": All"],
      ["Hannaford CRB: "],
      ["Lowe's CRB: All"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(1);
    expect(result[0].brand).toBe("Lowe's");
  });

  it("skips rows whose LHS starts with a digit or contains lbs/oz", () => {
    const rows: string[][] = [
      ["100% Bread Flour: stuff"],   // starts with digit
      ["Flour LBS: 45"],             // contains lbs
      ["Hannaford CRB: All"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(1);
    expect(result[0].brand).toBe("Hannaford");
  });

  it("returns empty for an all-numeric workbook with no customer section", () => {
    const rows: string[][] = [
      ["", "50", "30"],
      ["Flour", "100", "60"],
    ];
    expect(parseDoughCustomerSection(rows)).toHaveLength(0);
  });

  it("parses brand names that start with a digit followed by a letter (Bug 3a regression)", () => {
    const rows: string[][] = [
      ["4Hand's CRB Heavy: Seven Cheese"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ brand: "4Hand's", qualifierKey: "heavy", flavors: ["Seven Cheese"] });
  });

  it("still skips rows whose LHS starts with a digit followed by a non-letter (formula rows)", () => {
    const rows: string[][] = [
      ["100% Bread Flour: stuff"],
      ["45.5 lbs: something"],
      ["Hannaford CRB: All"],
    ];
    const result = parseDoughCustomerSection(rows);
    expect(result).toHaveLength(1);
    expect(result[0].brand).toBe("Hannaford");
  });

  it("splits '&'-joined multi-brand LHS into separate assignments (Bug 3b regression)", () => {
    const rows: string[][] = [
      ["Lowe's & Lucia's Craft CRB Heavy Plus: Caribbean"],
    ];
    const result = parseDoughCustomerSection(rows);
    // Expect 3: "Lowe's", "Lucia's Craft" (the split parts) AND "Lowe's & Lucia's Craft"
    // (the compound entry so matchDoughballVariant can find it by full brand name).
    expect(result).toHaveLength(3);
    expect(result).toContainEqual(
      expect.objectContaining({ brand: "Lowe's", qualifierKey: "heavy plus", flavors: ["Caribbean"] }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ brand: "Lucia's Craft", qualifierKey: "heavy plus", flavors: ["Caribbean"] }),
    );
    // Full compound name also stored so profiles named "Lowe's & Lucia's Craft" match.
    expect(result).toContainEqual(
      expect.objectContaining({ brand: "Lowe's & Lucia's Craft", qualifierKey: "heavy plus", flavors: ["Caribbean"] }),
    );
  });

  it("also stores the full compound name for single brands that contain '&' (Bug 3c: Lucia's New & Improved)", () => {
    // "Lucia's New & Improved" is a SINGLE brand whose name happens to contain "&".
    // The "&" split produces phantom parts ("Lucia's New", "Improved") that can't be
    // found by matchDoughballVariant using the full brand name. The compound entry
    // ensures the full-name lookup succeeds.
    const rows: string[][] = [
      ["Lucia's New & Improved: All"],
    ];
    const result = parseDoughCustomerSection(rows);
    // 3 entries: "Lucia's New", "Improved", and "Lucia's New & Improved"
    expect(result).toHaveLength(3);
    expect(result).toContainEqual(
      expect.objectContaining({ brand: "Lucia's New & Improved", qualifierKey: "", flavors: [""] }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ brand: "Lucia's New", qualifierKey: "", flavors: [""] }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ brand: "Improved", qualifierKey: "", flavors: [""] }),
    );
  });

  it("produces two assignments from the real CRB workbook '& ' compound row", () => {
    // Mirrors actual row from CRB_Dough_Mixing_Procedure_-_38:
    // "Lowe's & Lucia's Craft CRB Heavy Plus: Caribbean"
    const rows: string[][] = [
      ["Basha's Original: All"],
      ["Lowe's & Lucia's Craft CRB Heavy Plus: Caribbean"],
      ["SMD CRB: All"],
    ];
    const result = parseDoughCustomerSection(rows);
    const brands = result.map((r) => r.brand);
    expect(brands).toContain("Basha's Original");
    expect(brands).toContain("Lowe's");
    expect(brands).toContain("Lucia's Craft");
    expect(brands).toContain("SMD");
    // Each of the two split brands shares the same qualifier + flavor
    const lowes = result.find((r) => r.brand === "Lowe's");
    const lucias = result.find((r) => r.brand === "Lucia's Craft");
    expect(lowes?.qualifierKey).toBe("heavy plus");
    expect(lowes?.flavors).toEqual(["Caribbean"]);
    expect(lucias?.qualifierKey).toBe("heavy plus");
    expect(lucias?.flavors).toEqual(["Caribbean"]);
  });
});

// ---------------------------------------------------------------------------
// parseDoughVariantTable
// ---------------------------------------------------------------------------

describe("parseDoughVariantTable", () => {
  // Mirror of the real Brand+Corky's dough workbook rows (R31-R34).
  const brandAndCorkysRows: string[][] = [
    ["", "BRAND & CORKY'S DOUGH MIXING P", "", "", "", "", "", ""],
    [],
    ["", "", "", "LBS.", "", "04/24/2024 Rev. 8", "", ""],
    ["", "ADM WHEAT FLOUR", "", "200", "", "", "", ""],
    ["", "WATER", "", "103.8", "", "", "", ""],
    ["", "CORN OIL", "", "10", "", "", "", ""],
    ["", "TOTAL", "", "328.5", "", "", "", ""],
    [],
    [],
    [],
    ["", "", "OZ.", "LBS.", "YIELD", "PER TRAY", "", ""],
    ["", 'BRAND 7" DOUGH', "6.2", "0.39", "847.74", "24", "", ""],
    ["", 'BRAND 12" DOUGH', "14.2", "0.89", "370.14", "16", "", ""],
    ["", "CORKY'S 7\" DOUGH", "5", "0.31", "1051.2", "24", "", ""],
    ["", "", "Acceptable range on doughballs", "", "", "", "", ""],
  ];

  it("returns all 3 variant rows from the Brand+Corky's workbook", () => {
    const result = parseDoughVariantTable(brandAndCorkysRows);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual<DoughVariantTableEntry>({ label: 'BRAND 7" DOUGH', weightOz: 6.2, perTray: 24 });
    expect(result[1]).toEqual<DoughVariantTableEntry>({ label: 'BRAND 12" DOUGH', weightOz: 14.2, perTray: 16 });
    expect(result[2]).toEqual<DoughVariantTableEntry>({ label: "CORKY'S 7\" DOUGH", weightOz: 5, perTray: 24 });
  });

  it("returns empty array when no OZ/TRAY header exists", () => {
    const rows: string[][] = [
      ["", "ADM WHEAT FLOUR", "", "200"],
      ["", "WATER", "", "103.8"],
    ];
    expect(parseDoughVariantTable(rows)).toHaveLength(0);
  });

  it("skips rows with no label or non-positive oz", () => {
    const rows: string[][] = [
      ["", "", "OZ.", "LBS.", "YIELD", "PER TRAY"],
      ["", "", "6.2", "0.39", "847.74", "24"],     // no label → skip
      ["", "My Dough", "0", "0.39", "100", "24"],  // oz=0 → skip
      ["", "Good Dough", "7.5", "0.47", "200", "18"],
    ];
    const result = parseDoughVariantTable(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ label: "Good Dough", weightOz: 7.5, perTray: 18 });
  });

  it("stops after 2 consecutive blank rows past the table", () => {
    const rows: string[][] = [
      ["", "", "OZ.", "LBS.", "YIELD", "PER TRAY"],
      ["", "Dough A", "6.2", "0.39", "847", "24"],
      [],   // 1 blank — tolerated
      ["", "Dough B", "5.0", "0.31", "1051", "24"],
      [],
      [],   // 2 consecutive blanks → stop
      ["", "Dough C", "14.2", "0.89", "370", "16"],  // not reached
    ];
    const result = parseDoughVariantTable(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.label)).toEqual(["Dough A", "Dough B"]);
  });

  it("works when TRAY header has leading/trailing spaces", () => {
    const rows: string[][] = [
      ["OZ", "LBS", "YIELD", " PER TRAY "],
      ["5.5", "0.34", "950", "20"],
    ];
    // labelCol = ozCol - 1 = -1 → clamped to 0 (same col as oz)
    // Label at col 0 = "5.5" which is numeric-looking but parseDoughVariantTable only
    // checks oz at ozCol=0 and label at labelCol=0 — let's verify it doesn't crash.
    expect(() => parseDoughVariantTable(rows)).not.toThrow();
  });

  it("finds labels two columns left of OZ (CRB-style two-column gap)", () => {
    // In CRB Dough the layout is: label in col 0, blank col 1, OZ in col 2.
    // Some rows are indented (label in col 1), so labelCol = ozCol-1 = 1.
    // Rows with label in col 0 must still be found via the leftward scan.
    const rows: string[][] = [
      // header: OZ in col 2
      ["", "", "OZ.", "LBS.", "YIELD", "PER TRAY"],
      // col-0 label with blank gap (Costco/Four-Hands style)
      ["Costco", "", "9.6", "0.6", "533.17", "20"],
      ["Hannaford CRB", "", "7.6", "0.48", "673.47", "24"],
      ["Four Hands CRB Heavy", "", "8.7", "0.54", "588.32", "24"],
      // indented label in col 1 (Lowe's CRB Heavier style)
      ["", "Lowe's CRB Heavier", "13", "0.81", "393.72", "16"],
    ];
    const result = parseDoughVariantTable(rows);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ label: "Costco", weightOz: 9.6, perTray: 20 });
    expect(result[1]).toMatchObject({ label: "Hannaford CRB", weightOz: 7.6, perTray: 24 });
    expect(result[2]).toMatchObject({ label: "Four Hands CRB Heavy", weightOz: 8.7, perTray: 24 });
    expect(result[3]).toMatchObject({ label: "Lowe's CRB Heavier", weightOz: 13, perTray: 16 });
  });

  it("omits perTray when the tray cell is missing or non-numeric", () => {
    const rows: string[][] = [
      ["", "", "OZ.", "LBS.", "YIELD", "PER TRAY"],
      ["", "Dough A", "6.2", "0.39", "847", ""],    // blank tray
      ["", "Dough B", "5.0", "0.31", "1051", "N/A"], // non-numeric tray
    ];
    const result = parseDoughVariantTable(rows);
    expect(result).toHaveLength(2);
    expect(result[0]!.perTray).toBeUndefined();
    expect(result[1]!.perTray).toBeUndefined();
  });

  it("multi-line cell regression: a literal \\n mid-label produces ONE variant, not two", () => {
    // Malted Barley Rev 29 has a label cell whose text contains a literal \n:
    // "LOWE'S, HANNAFORD, LUCIA CRAFT, \nNOB HILL CRAFT Thick (Argus)"
    // The normalizer must collapse \r/\n to a space so the compound label
    // lands as a single variant. Without the normalization the \n would split
    // the label at the newline boundary, creating a truncated first variant
    // ("LOWE'S, HANNAFORD, LUCIA CRAFT,") and a phantom second variant
    // ("NOB HILL CRAFT Thick (Argus)") — and customer assignments would target
    // the wrong entry.
    const labelWithNewline = "LOWE'S, HANNAFORD, LUCIA CRAFT, \nNOB HILL CRAFT Thick (Argus)";
    const rows: string[][] = [
      ["", "", "OZ.", "LBS.", "YIELD", "PER TRAY"],
      ["", labelWithNewline, "13.8", "0.86", "370", "16"],
    ];
    const result = parseDoughVariantTable(rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("LOWE'S, HANNAFORD, LUCIA CRAFT, NOB HILL CRAFT Thick (Argus)");
    expect(result[0]!.weightOz).toBe(13.8);
    expect(result[0]!.perTray).toBe(16);
  });

  it("label-key dedup regression: two entries with the same weight but different label keys are kept as distinct variants", () => {
    // Margherita regression: two variants that share the same oz weight but have
    // genuinely different label keys (e.g. "Margherita" vs "Margherita Classic")
    // must NOT be folded — parseDoughVariantTable returns raw entries without any
    // dedup, so both must survive. Deduplication only happens in
    // normalizeDoughballVariants (which uses doughballVariantLabelKey to fold
    // suffix-equivalent labels), not in the table parser itself.
    const rows: string[][] = [
      ["", "", "OZ.", "LBS.", "YIELD", "PER TRAY"],
      ["", "Margherita", "8.25", "0.52", "620", "24"],
      ["", "Margherita Classic", "8.25", "0.52", "620", "20"],
    ];
    const result = parseDoughVariantTable(rows);
    expect(result).toHaveLength(2);
    expect(result[0]!.label).toBe("Margherita");
    expect(result[1]!.label).toBe("Margherita Classic");
    // Same weight — both survive because they have different labels
    expect(result[0]!.weightOz).toBe(8.25);
    expect(result[1]!.weightOz).toBe(8.25);
    // Different perTray distinguishes them further
    expect(result[0]!.perTray).toBe(24);
    expect(result[1]!.perTray).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// applyDoughCustomerAssignmentsToVariants
// ---------------------------------------------------------------------------

describe("applyDoughCustomerAssignmentsToVariants", () => {
  const assignments: DoughCustomerAssignment[] = [
    { brand: "Hannaford", qualifierKey: "", flavors: ["Five Cheese", "BBQ Chicken"] },
    { brand: "Costco", qualifierKey: "", flavors: [""] },
    { brand: "Lowe's", qualifierKey: "", flavors: ["Californian"] },
    { brand: "Lucia's Craft", qualifierKey: "ultra thin", flavors: ["Sweet Chili", "BBQ Chicken"] },
    { brand: "Basha's", qualifierKey: "ultra thin", flavors: [""] },
    { brand: "Lucia's Craft", qualifierKey: "heavy plus", flavors: ["Four Cheese Meltdown"] },
    { brand: "Hannaford", qualifierKey: "heavy plus", flavors: ["Spicy 4 Cheese"] },
    { brand: "Lowe's", qualifierKey: "heavier", flavors: ["Spinach Mushroom"] },
  ];

  it("populates customers on base variants by brand-name inclusion", () => {
    const variants: DoughballVariant[] = [
      { label: "Hannaford", weightOz: 7.6 },
      { label: "Costco", weightOz: 9.6 },
      { label: "SMD", weightOz: 7.6 },
    ];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments);
    const h = result.find((v) => v.label === "Hannaford")!;
    expect(h.customers).toContainEqual({ brand: "Hannaford", flavor: "Five Cheese" });
    expect(h.customers).toContainEqual({ brand: "Hannaford", flavor: "BBQ Chicken" });
    const c = result.find((v) => v.label === "Costco")!;
    expect(c.customers).toContainEqual({ brand: "Costco", flavor: "" });
    // SMD has no matching assignment → unchanged
    expect(result.find((v) => v.label === "SMD")!.customers).toBeUndefined();
  });

  it("does not assign base customers to a qualified variant of the same brand", () => {
    const variants: DoughballVariant[] = [
      { label: "Lowe's", weightOz: 7.6 },
      { label: "Lowe's CRB Heavier", weightOz: 8.5 },
    ];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments);
    const base = result.find((v) => v.label === "Lowe's")!;
    expect(base.customers?.some((c) => c.flavor === "Californian")).toBe(true);
    expect(base.customers?.some((c) => c.flavor === "Spinach Mushroom")).toBe(false);
    const heavier = result.find((v) => v.label === "Lowe's CRB Heavier")!;
    expect(heavier.customers).toContainEqual({ brand: "Lowe's", flavor: "Spinach Mushroom" });
    expect(heavier.customers?.some((c) => c.flavor === "Californian")).toBe(false);
  });

  it("applies qualified assignments strictly when brand has a dedicated variant label", () => {
    const variants: DoughballVariant[] = [
      { label: "Hannaford CRB Heavy Plus", weightOz: 12 },
      { label: "Lucia's Craft CRB Heavy Plus", weightOz: 12 },
      { label: "Lowe's CRB Heavy Plus", weightOz: 12 },
    ];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments, variants);
    const h = result.find((v) => v.label === "Hannaford CRB Heavy Plus")!;
    expect(h.customers).toContainEqual({ brand: "Hannaford", flavor: "Spicy 4 Cheese" });
    expect(h.customers?.some((c) => c.brand === "Lucia's Craft")).toBe(false);
    const l = result.find((v) => v.label === "Lucia's Craft CRB Heavy Plus")!;
    expect(l.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" });
    expect(l.customers?.some((c) => c.brand === "Hannaford")).toBe(false);
    // Lowe's has no heavy-plus assignment → no customers
    expect(result.find((v) => v.label === "Lowe's CRB Heavy Plus")!.customers).toBeUndefined();
  });

  it("uses shared-variant fallback when brand has no dedicated label for the qualifier", () => {
    // Only "Basha's Ultra Thin" exists — Lucia's Craft has no dedicated ultra-thin
    // variant, so both Lucia's and Basha's assignments should land here.
    const variants: DoughballVariant[] = [
      { label: "Basha's Ultra Thin", weightOz: 7.8 },
    ];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments, variants);
    const ut = result[0];
    expect(ut.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "Sweet Chili" });
    expect(ut.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "BBQ Chicken" });
    expect(ut.customers).toContainEqual({ brand: "Basha's", flavor: "" });
  });

  it("does NOT bleed ultra-thin fallback onto a heavy-plus variant", () => {
    const variants: DoughballVariant[] = [
      { label: "Basha's Ultra Thin", weightOz: 7.8 },
      { label: "Lucia's Craft CRB Heavy Plus", weightOz: 12 },
    ];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments, variants);
    const hp = result.find((v) => v.label === "Lucia's Craft CRB Heavy Plus")!;
    // Only Four Cheese Meltdown (heavy-plus assignment) on heavy-plus
    expect(hp.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" });
    expect(hp.customers?.some((c) => c.flavor === "Sweet Chili")).toBe(false);
    expect(hp.customers?.some((c) => c.flavor === "BBQ Chicken" && c.brand === "Lucia's Craft")).toBe(false);
  });

  it("assigns all base assignments to a generic (non-brand-named) single variant", () => {
    // "Brand Dough" has one variant with a generic label — the whole pool has
    // no brand names in labels, so every base assignment is a catch-all.
    const variants: DoughballVariant[] = [{ label: "Brand Dough 14.2 oz", weightOz: 14.2 }];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments, variants);
    const v = result[0];
    expect(v.customers).toContainEqual({ brand: "Hannaford", flavor: "Five Cheese" });
    expect(v.customers).toContainEqual({ brand: "Hannaford", flavor: "BBQ Chicken" });
    expect(v.customers).toContainEqual({ brand: "Costco", flavor: "" });
    expect(v.customers).toContainEqual({ brand: "Lowe's", flavor: "Californian" });
  });

  it("does not apply generic-pool fallback when pool has branded base variants", () => {
    // Pool has named brands → strict only, no cross-brand bleed via fallback.
    const variants: DoughballVariant[] = [
      { label: "Hannaford", weightOz: 7.6 },
      { label: "Costco", weightOz: 9.6 },
      { label: "Generic CRB", weightOz: 7.6 },
    ];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments, variants);
    // Generic CRB: pool IS branded (Hannaford, Costco found) → no fallback
    expect(result.find((v) => v.label === "Generic CRB")!.customers).toBeUndefined();
    // Hannaford: strict match
    expect(result.find((v) => v.label === "Hannaford")!.customers).toContainEqual({
      brand: "Hannaford",
      flavor: "Five Cheese",
    });
  });

  it("returns the same array reference when assignments is empty", () => {
    const variants: DoughballVariant[] = [{ label: "Hannaford", weightOz: 7.6 }];
    const result = applyDoughCustomerAssignmentsToVariants(variants, []);
    expect(result).toBe(variants);
  });

  it("does not duplicate customers already present", () => {
    const variants: DoughballVariant[] = [
      {
        label: "Hannaford",
        weightOz: 7.6,
        customers: [{ brand: "Hannaford", flavor: "Five Cheese" }],
      },
    ];
    const result = applyDoughCustomerAssignmentsToVariants(variants, assignments);
    const h = result[0];
    const count = h.customers!.filter(
      (c) => c.brand === "Hannaford" && c.flavor === "Five Cheese",
    ).length;
    expect(count).toBe(1);
    // BBQ Chicken was new → also added
    expect(h.customers).toContainEqual({ brand: "Hannaford", flavor: "BBQ Chicken" });
  });
});
