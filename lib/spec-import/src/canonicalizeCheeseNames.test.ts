import { describe, it, expect } from "vitest";
import {
  cleanSpecCheeseRecipeName,
  canonicalizeSpecImportCheeseRecipeNames,
  dedupeSpecImportCheeseRecipes,
  collectSpecImportCheeseRecipes,
  extractEmbeddedApplicatorBlends,
  recipeTargets,
  stripApplicatorLabel,
  parseEmbeddedBlend,
  type ParsedSpecImport,
} from "./index";

const none = new Set<string>();

describe("stripApplicatorLabel", () => {
  it("drops a leading 'Applicator' row label with any separator", () => {
    expect(stripApplicatorLabel("Applicator - Aldo's Cheese Mix")).toBe("Aldo's Cheese Mix");
    expect(stripApplicatorLabel("Applicator- Aldo's Cheese Mix")).toBe("Aldo's Cheese Mix");
    expect(stripApplicatorLabel("Applicator: Aldo's Cheese Mix")).toBe("Aldo's Cheese Mix");
    expect(stripApplicatorLabel("Applicator Aldo's Cheese Mix")).toBe("Aldo's Cheese Mix");
  });

  it("leaves names without the label alone", () => {
    expect(stripApplicatorLabel("Aldo's Cheese Mix")).toBe("Aldo's Cheese Mix");
    expect(stripApplicatorLabel("Applicator Grade Cheese")).toBe("Grade Cheese");
  });

  it("does not strip when only the bare label would remain", () => {
    expect(stripApplicatorLabel("Applicator")).toBe("Applicator");
    expect(stripApplicatorLabel("Applicator -")).toBe("Applicator -");
  });
});

describe("cleanSpecCheeseRecipeName", () => {
  it("strips a trailing bare weight number", () => {
    expect(cleanSpecCheeseRecipeName("Aldo's Cheese Mix 2.07")).toBe("Aldo's Cheese Mix");
    expect(cleanSpecCheeseRecipeName("Aldo's Cheese Mix 1.75")).toBe("Aldo's Cheese Mix");
    expect(cleanSpecCheeseRecipeName("Cheese Blend 2")).toBe("Cheese Blend");
  });

  it("strips a trailing weight with a unit or parens", () => {
    expect(cleanSpecCheeseRecipeName("Cheese Mix 2.07 oz")).toBe("Cheese Mix");
    expect(cleanSpecCheeseRecipeName("Cheese Mix (1.75 oz)")).toBe("Cheese Mix");
    expect(cleanSpecCheeseRecipeName("Cheese Mix - 3lb")).toBe("Cheese Mix");
  });

  it("leaves names without a trailing weight alone", () => {
    expect(cleanSpecCheeseRecipeName("Whole Mozz Cheese Mix")).toBe("Whole Mozz Cheese Mix");
    expect(cleanSpecCheeseRecipeName("5 Cheese Blend")).toBe("5 Cheese Blend");
    expect(cleanSpecCheeseRecipeName("Basha's Ultra Thin 5 Cheese")).toBe("Basha's Ultra Thin 5 Cheese");
  });

  it("strips an embedded per-pizza composition after the blend name", () => {
    expect(
      cleanSpecCheeseRecipeName(
        "Aldo's Cheese Mix 2.07 Pizella, 1.19 Part Skim Mozzarella, 0.26 Grated Parmesan",
      ),
    ).toBe("Aldo's Cheese Mix");
    expect(
      cleanSpecCheeseRecipeName(
        "Aldo's Cheese Mix 1.75 Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan",
      ),
    ).toBe("Aldo's Cheese Mix");
  });

  it("keeps only the blend name when the composition sits on a second line", () => {
    expect(
      cleanSpecCheeseRecipeName(
        "Aldo's Cheese Mix\n2.07 Pizella, 1.19 Part Skim Mozzarella, 0.26 Grated Parmesan",
      ),
    ).toBe("Aldo's Cheese Mix");
  });

  it("drops a leading 'Applicator' row label, with or without a composition", () => {
    expect(
      cleanSpecCheeseRecipeName(
        "Applicator - Aldo's Cheese Mix 2.07 Pizella, 1.19 Part Skim Mozzarella, 0.26 Grated Parmesan",
      ),
    ).toBe("Aldo's Cheese Mix");
    expect(
      cleanSpecCheeseRecipeName(
        "Applicator - Aldo's Cheese Mix 1.75 Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan",
      ),
    ).toBe("Aldo's Cheese Mix");
    // No embedded composition (AI left the label but not the parts).
    expect(cleanSpecCheeseRecipeName("Applicator - Aldo's Cheese Mix")).toBe("Aldo's Cheese Mix");
  });

  it("does not strip when nothing meaningful would remain", () => {
    expect(cleanSpecCheeseRecipeName("2.07")).toBe("2.07");
    expect(cleanSpecCheeseRecipeName("  ")).toBe("");
  });
});

function cheese(name: string, over: Partial<ParsedSpecImport["recipes"][number]> = {}) {
  return {
    kind: "cheese" as const,
    name,
    rows: over.rows ?? [{ ingredient: "Pizella", lbs: 0.13 }],
    ...over,
  };
}

describe("canonicalizeSpecImportCheeseRecipeNames", () => {
  it("collapses per-weight variants of one blend to a single pool recipe", () => {
    const canon = canonicalizeSpecImportCheeseRecipeNames({
      profiles: [],
      recipes: [
        cheese("Aldo's Cheese Mix 2.07", { brand: "Aldo's", flavor: "Cheese", app: 1 }),
        cheese("Aldo's Cheese Mix 1.75", { brand: "Aldo's", flavor: "Pepperoni", app: 2 }),
      ],
    });
    expect(canon.recipes.map((r) => r.name)).toEqual([
      "Aldo's Cheese Mix",
      "Aldo's Cheese Mix",
    ]);
    // Both applicator slots keep their own slot (weight lives on the applicator),
    // but the pool now holds ONE recipe because the names match.
    const drafts = collectSpecImportCheeseRecipes(canon, none);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe("Aldo's Cheese Mix");
  });

  it("leaves mix-routed and non-cheese recipes untouched", () => {
    const input: ParsedSpecImport = {
      profiles: [],
      recipes: [
        cheese("White Fajita Mix 2.5", {
          rows: [
            { ingredient: "Monterey Jack", lbs: 20 },
            { ingredient: "Peppers", lbs: 5 },
          ],
        }),
        { kind: "dough", name: "Thin Crust 12", rows: [{ ingredient: "Flour", lbs: 50 }] },
      ],
    };
    const canon = canonicalizeSpecImportCheeseRecipeNames(input);
    expect(canon.recipes[0].name).toBe("White Fajita Mix 2.5");
    expect(canon.recipes[1].name).toBe("Thin Crust 12");
  });

  it("returns the same object when nothing changes", () => {
    const input: ParsedSpecImport = {
      profiles: [],
      recipes: [cheese("Whole Mozz Cheese Mix", { brand: "Bobo", flavor: "Pep" })],
    };
    expect(canonicalizeSpecImportCheeseRecipeNames(input)).toBe(input);
  });

  it("strips a trailing '#'-prefixed number so '…Mix #1' collapses", () => {
    expect(cleanSpecCheeseRecipeName("Aldo's Cheese Mix #1")).toBe("Aldo's Cheese Mix");
    expect(cleanSpecCheeseRecipeName("Aldo's Cheese Mix #2")).toBe("Aldo's Cheese Mix");
  });
});

describe("dedupeSpecImportCheeseRecipes", () => {
  it("merges two numbered variants of one blend into a single recipe (union targets)", () => {
    // Mirrors the real Aldo's sheet: the blend is embedded in applicator cells at
    // two weights, the AI splits it into two numbered cheese recipes attaching to
    // different profiles. After canonicalize both are "Aldo's Cheese Mix".
    const canon = canonicalizeSpecImportCheeseRecipeNames({
      profiles: [],
      recipes: [
        cheese("Aldo's Cheese Mix 1", {
          brand: "Aldo's",
          flavor: "Cheese",
          app: 1,
          rows: [
            { ingredient: "Pizella", lbs: 0.129 },
            { ingredient: "Part Skim Mozzarella", lbs: 0.074 },
          ],
        }),
        cheese("Aldo's Cheese Mix 2", {
          brand: "Aldo's",
          flavor: "Pepperoni",
          app: 1,
          targets: [
            { brand: "Aldo's", flavor: "Meat Lover" },
            { brand: "Aldo's", flavor: "Supreme" },
          ],
          rows: [
            { ingredient: "Pizella", lbs: 0.109 },
            { ingredient: "Part Skim Mozzarella", lbs: 0.063 },
          ],
        }),
      ],
    });
    const deduped = dedupeSpecImportCheeseRecipes(canon);
    expect(deduped.recipes).toHaveLength(1);
    expect(deduped.recipes[0].name).toBe("Aldo's Cheese Mix");
    // First composition wins (0.129 Pizella), matching the embedded-blend path.
    expect(deduped.recipes[0].rows[0].lbs).toBe(0.129);
    // Every profile the variants covered survives on the single recipe.
    expect(recipeTargets(deduped.recipes[0])).toEqual([
      { brand: "Aldo's", flavor: "Cheese" },
      { brand: "Aldo's", flavor: "Pepperoni" },
      { brand: "Aldo's", flavor: "Meat Lover" },
      { brand: "Aldo's", flavor: "Supreme" },
    ]);
    // …and the pool still holds exactly one.
    expect(collectSpecImportCheeseRecipes(deduped, none)).toHaveLength(1);
  });

  it("does not merge cheese recipes with genuinely different names", () => {
    const input: ParsedSpecImport = {
      profiles: [],
      recipes: [
        cheese("Aldo's Cheese Mix", { brand: "Aldo's", flavor: "Cheese" }),
        cheese("White Cheese Blend", { brand: "Aldo's", flavor: "Alfredo" }),
      ],
    };
    expect(dedupeSpecImportCheeseRecipes(input).recipes).toHaveLength(2);
  });

  it("leaves dough/sauce recipes and returns the same object when nothing merges", () => {
    const input: ParsedSpecImport = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Thin Crust", rows: [{ ingredient: "Flour", lbs: 50 }] },
        { kind: "sauce", name: "House Sauce", rows: [{ ingredient: "Tomato", lbs: 10 }] },
        cheese("Aldo's Cheese Mix", { brand: "Aldo's", flavor: "Cheese" }),
      ],
    };
    expect(dedupeSpecImportCheeseRecipes(input)).toBe(input);
  });
});

describe("end-to-end: one blend embedded in 'Applicator - ...' cells → one pool recipe", () => {
  it("collapses per-weight 'Applicator - Aldo's Cheese Mix' variants across profiles", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        {
          brand: "Aldo's",
          flavor: "Cheese",
          applicators: [
            {
              type: "Applicator - Aldo's Cheese Mix 2.07 Pizella, 1.19 Part Skim Mozzarella, 0.26 Grated Parmesan, 0.13 Oregano Flake",
              ozPerPizza: 3.65,
            },
          ],
          pepperonis: [],
        },
        {
          brand: "Aldo's",
          flavor: "Pepperoni",
          applicators: [
            {
              type: "Applicator - Aldo's Cheese Mix 1.75 Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan, 0.05 Oregano Flake",
              ozPerPizza: 2.9,
            },
          ],
          pepperonis: [],
        },
      ],
      recipes: [],
    };

    // Deterministic unpack + name canonicalization is what the import runs.
    const extracted = extractEmbeddedApplicatorBlends(parsed);
    const canon = canonicalizeSpecImportCheeseRecipeNames(extracted);

    // Both applicator slots now point at the same clean blend name...
    for (const p of canon.profiles) {
      expect(p.applicators[0].type).toBe("Aldo's Cheese Mix");
    }
    // ...and the server pool ends up with exactly ONE cheese recipe.
    const drafts = collectSpecImportCheeseRecipes(canon, none);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe("Aldo's Cheese Mix");
  });
});
