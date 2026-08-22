import { describe, it, expect } from "vitest";
import {
  findSpecImportDoughFamilyMatch,
  linkSpecImportNamedRecipesToExisting,
  specImportDoughFamilyHintFromFileName,
  type ParsedSpecImport,
  type SpecImportLinkSuggestion,
} from "./index";

describe("specImportDoughFamilyHintFromFileName", () => {
  it("derives the family from a mixing-procedure workbook name", () => {
    expect(
      specImportDoughFamilyHintFromFileName("CRB Dough Mixing Procedure - 38.xlsx"),
    ).toBe("CRB Dough");
  });

  it("trims trailing separators and works without an extension", () => {
    expect(specImportDoughFamilyHintFromFileName("Malted Barley Dough - v2")).toBe(
      "Malted Barley Dough",
    );
  });

  it("keeps the FULL qualified family name before the Mixing Procedure suffix", () => {
    // "Masa Dough, Natural, (Lowe's)" is a DIFFERENT formula from plain
    // "Masa Dough" — cutting at the first "dough" token gave both files the
    // same hint and combined the two families.
    expect(
      specImportDoughFamilyHintFromFileName(
        "Masa Dough, Natural, (Lowe's) Mixing Procedure - 04.xlsx",
      ),
    ).toBe("Masa Dough, Natural, (Lowe's)");
    expect(
      specImportDoughFamilyHintFromFileName("Masa Dough Mixing Procedure - 12.xlsx"),
    ).toBe("Masa Dough");
  });

  it("normalizes underscores in attached-asset style file names", () => {
    expect(
      specImportDoughFamilyHintFromFileName(
        "Masa_Dough,_Natural,_(Lowe's)_Mixing_Procedure_-_04.xlsx",
      ),
    ).toBe("Masa Dough, Natural, (Lowe's)");
  });

  it("returns null when 'dough' is absent or has no distinctive token before it", () => {
    expect(specImportDoughFamilyHintFromFileName("Pizza Spec Sheet.xlsx")).toBeNull();
    expect(specImportDoughFamilyHintFromFileName("Dough Mixing Procedure.xlsx")).toBeNull();
    expect(specImportDoughFamilyHintFromFileName("")).toBeNull();
  });
});

describe("findSpecImportDoughFamilyMatch", () => {
  const pool = ["CRB Dough", "Malted Barley Dough", "Margherita Dough"];

  it("collapses variant-qualified names onto the base family recipe", () => {
    expect(findSpecImportDoughFamilyMatch('11" CRB', pool)).toBe("CRB Dough");
    expect(findSpecImportDoughFamilyMatch("CRB Heavy Plus recipe", pool)).toBe("CRB Dough");
    expect(findSpecImportDoughFamilyMatch("Heavier CRB Recipe", pool)).toBe("CRB Dough");
    expect(findSpecImportDoughFamilyMatch("Thick Malted Barley recipe", pool)).toBe(
      "Malted Barley Dough",
    );
    expect(findSpecImportDoughFamilyMatch("Margherita Dough Recipe", pool)).toBe(
      "Margherita Dough",
    );
  });

  it("never matches a family whose distinctive tokens are absent", () => {
    expect(findSpecImportDoughFamilyMatch("Lowe's French Fry recipe", pool)).toBeNull();
    expect(findSpecImportDoughFamilyMatch("Thin Crust", pool)).toBeNull();
  });

  it("ignores pool names with no distinctive tokens (generic 'Dough')", () => {
    expect(findSpecImportDoughFamilyMatch("CRB Heavy Plus", ["Dough", "Pizza Crust"])).toBeNull();
  });

  it("prefers the most specific family and refuses ambiguous ties", () => {
    // More-specific pool entry wins when both subsets hold.
    expect(
      findSpecImportDoughFamilyMatch("CRB Heavy Plus recipe", ["CRB Dough", "CRB Heavy Dough"]),
    ).toBe("CRB Heavy Dough");
    // Two DIFFERENT single-token families both matching → ambiguous → null.
    expect(
      findSpecImportDoughFamilyMatch("CRB Barley recipe", ["CRB Dough", "Barley Dough"]),
    ).toBeNull();
    // Duplicate saved entries of the same loose name are not a conflict.
    expect(
      findSpecImportDoughFamilyMatch('11" CRB', ["CRB Dough", "crb dough"]),
    ).toBe("CRB Dough");
  });

  it("requires the pool tokens verbatim (digits included)", () => {
    expect(findSpecImportDoughFamilyMatch("CRB Heavy", ["CRB 2 Dough"])).toBeNull();
  });
});

describe("linkSpecImportNamedRecipesToExisting dough family fallback", () => {
  const base: ParsedSpecImport = {
    profiles: [
      {
        brand: "Lowe's 11in",
        flavor: "Caribbean",
        dieType: "11in",
        applicators: [],
        doughName: "CRB Heavy Plus recipe",
      },
    ],
    recipes: [],
  } as unknown as ParsedSpecImport;

  it("repoints a profile's variant dough name onto the base pool recipe", () => {
    const linked = linkSpecImportNamedRecipesToExisting(base, "dough", ["CRB Dough"]);
    expect(linked.profiles?.[0]?.doughName).toBe("CRB Dough");
  });

  it("no longer silently folds a variant dough recipe — it becomes a review SUGGESTION", () => {
    // A family fold is beyond-exact: it used to auto-rename the incoming
    // variant recipe onto the base pool recipe, which silently cross-linked
    // similar-named recipes. Now the recipe keeps its sheet name and the
    // fold surfaces as a declinable suggestion for the review dialog.
    const withRecipe = {
      ...base,
      recipes: [
        { kind: "dough", name: "CRB Heavy Plus recipe", rows: [{ name: "Flour", lbs: 1 }] },
      ],
    } as unknown as ParsedSpecImport;
    const suggestions: SpecImportLinkSuggestion[] = [];
    const linked = linkSpecImportNamedRecipesToExisting(withRecipe, "dough", ["CRB Dough"], {
      suggestions,
    });
    expect(linked.recipes?.[0]?.name).toBe("CRB Heavy Plus recipe");
    expect(linked.profiles?.[0]?.doughName).toBe("CRB Heavy Plus recipe");
    expect(suggestions).toContainEqual({
      kind: "dough",
      importedName: "CRB Heavy Plus recipe",
      existingName: "CRB Dough",
    });
  });

  it("can commit-link a family recipe only when the pool target is an empty stub", () => {
    const withRecipe = {
      ...base,
      recipes: [
        { kind: "dough", name: "CRB Dough", rows: [{ name: "Flour", lbs: 200 }] },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(withRecipe, "dough", ["CRB Recipe"], {
      existingRecipes: [{ name: "CRB Recipe", rows: [] }],
      autoApplyEmptyFamily: true,
    });
    expect(linked.recipes?.[0]?.name).toBe("CRB Recipe");
    expect(linked.recipes?.[0]?.variantLabel).toBe("CRB Dough");
  });

  it("does not commit-link a populated family recipe", () => {
    const withRecipe = {
      ...base,
      recipes: [
        { kind: "dough", name: "CRB Dough", rows: [{ name: "Flour", lbs: 200 }] },
      ],
    } as unknown as ParsedSpecImport;
    const suggestions: SpecImportLinkSuggestion[] = [];
    const linked = linkSpecImportNamedRecipesToExisting(withRecipe, "dough", ["CRB Recipe"], {
      existingRecipes: [{ name: "CRB Recipe", rows: [{ ingredient: "Flour" }] }],
      autoApplyEmptyFamily: true,
      suggestions,
    });
    expect(linked.recipes?.[0]?.name).toBe("CRB Dough");
    expect(suggestions).toContainEqual({
      kind: "dough",
      importedName: "CRB Dough",
      existingName: "CRB Recipe",
    });
  });

  it("no longer auto-anchors sibling collapse through a family fold — the fold is a SUGGESTION", () => {
    // The anchor here ("Costco CRB" → "CRB Dough") is itself a beyond-exact
    // family fold, so it no longer applies silently: every sheet name stays
    // put and the fold surfaces as a declinable suggestion. (Hint-anchored
    // and exact-anchored sibling collapses still apply automatically — see
    // the tests below.)
    const rows = [
      { ingredient: "Flour", lbs: 100 },
      { ingredient: "Water", lbs: 60 },
    ];
    const parsed = {
      profiles: [
        {
          brand: "Basha's",
          flavor: "Cheese",
          dieType: "11in",
          applicators: [],
          doughName: "Basha's Original",
        },
      ],
      recipes: [
        { kind: "dough", name: "Costco CRB", rows, doughballOz: 9.6 },
        { kind: "dough", name: "Basha's Original", rows, doughballOz: 8.6 },
        { kind: "dough", name: "Lucia's New & Improved", rows, doughballOz: 8.25 },
      ],
    } as unknown as ParsedSpecImport;
    const suggestions: SpecImportLinkSuggestion[] = [];
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", ["CRB Dough"], {
      suggestions,
    });
    expect(linked.recipes?.map((r) => r.name)).toEqual([
      "Costco CRB",
      "Basha's Original",
      "Lucia's New & Improved",
    ]);
    expect(linked.profiles?.[0]?.doughName).toBe("Basha's Original");
    expect(suggestions).toContainEqual({
      kind: "dough",
      importedName: "Costco CRB",
      existingName: "CRB Dough",
    });
  });

  it("collapses an ANCHORLESS row-identical group onto the file-name family hint (empty pool)", () => {
    // Pool cleared / fresh factory: no sibling matches an existing recipe, so
    // there is no anchor — the hint derived from the workbook file name names
    // the family instead. Every customer row becomes a variant, none standalone.
    const rows = [
      { ingredient: "Flour", lbs: 100 },
      { ingredient: "Water", lbs: 60 },
    ];
    const parsed = {
      profiles: [
        {
          brand: "Basha's",
          flavor: "Cheese",
          dieType: "11in",
          applicators: [],
          doughName: "Basha's Original",
        },
      ],
      recipes: [
        { kind: "dough", name: "Costco CRB", rows, doughballOz: 9.6 },
        { kind: "dough", name: "Basha's Original", rows, doughballOz: 8.6 },
        { kind: "dough", name: "Lucia's New & Improved", rows, doughballOz: 8.25 },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", [], {
      doughFamilyHint: specImportDoughFamilyHintFromFileName(
        "CRB Dough Mixing Procedure - 38.xlsx",
      ),
    });
    expect(linked.recipes?.map((r) => r.name)).toEqual([
      "CRB Dough",
      "CRB Dough",
      "CRB Dough",
    ]);
    expect(linked.recipes?.map((r) => r.variantLabel)).toEqual([
      "Costco CRB",
      "Basha's Original",
      "Lucia's New & Improved",
    ]);
    expect(linked.profiles?.[0]?.doughName).toBe("CRB Dough");
  });

  it("anchorless hint collapse uses the POOL spelling when the hint loose-matches an existing name", () => {
    const rows = [{ ingredient: "Flour", lbs: 100 }];
    const parsed = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Costco CRB", rows },
        { kind: "dough", name: "Basha's Original", rows },
      ],
    } as unknown as ParsedSpecImport;
    // Pool holds an unrelated-rows recipe whose NAME loose-matches the hint —
    // siblings still collapse (names snap to the pool spelling) even though no
    // sibling matched the pool by name.
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", ["CRB DOUGH"], {
      doughFamilyHint: "CRB Dough",
    });
    expect(linked.recipes?.map((r) => r.name)).toEqual(["CRB DOUGH", "CRB DOUGH"]);
  });

  it("does NOT hint-collapse when TWO unanchored row-identical groups exist (two mixing tables)", () => {
    const rowsA = [{ ingredient: "Flour", lbs: 100 }];
    const rowsB = [{ ingredient: "Semolina", lbs: 50 }];
    const parsed = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Costco CRB", rows: rowsA },
        { kind: "dough", name: "Basha's Original", rows: rowsA },
        { kind: "dough", name: "Lucia's", rows: rowsB },
        { kind: "dough", name: "Roma's", rows: rowsB },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", [], {
      doughFamilyHint: "CRB Dough",
    });
    expect(linked.recipes?.map((r) => r.name)).toEqual([
      "Costco CRB",
      "Basha's Original",
      "Lucia's",
      "Roma's",
    ]);
  });

  it("does NOT hint-collapse a lone dough recipe (group of one)", () => {
    const parsed = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Costco CRB", rows: [{ ingredient: "Flour", lbs: 100 }] },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", [], {
      doughFamilyHint: "CRB Dough",
    });
    expect(linked.recipes?.[0]?.name).toBe("Costco CRB");
  });

  it("anchored collapse WINS over the hint when a sibling matches the pool", () => {
    const rows = [{ ingredient: "Flour", lbs: 100 }];
    const parsed = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Malted Barley Dough", rows },
        { kind: "dough", name: "Basha's Original", rows },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(
      parsed,
      "dough",
      ["Malted Barley Dough"],
      { doughFamilyHint: "CRB Dough" },
    );
    // The group IS anchored (a sibling matched the pool) — hint never applies.
    expect(linked.recipes?.map((r) => r.name)).toEqual([
      "Malted Barley Dough",
      "Malted Barley Dough",
    ]);
  });

  it("leaves siblings alone when the row-identical group matched TWO different pool recipes", () => {
    const rows = [{ ingredient: "Flour", lbs: 100 }];
    const parsed = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Costco CRB", rows },
        { kind: "dough", name: "Malted Barley Special", rows },
        { kind: "dough", name: "Basha's Original", rows },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", [
      "CRB Dough",
      "Malted Barley Dough",
    ]);
    // Ambiguous group: the unmatched sibling keeps its own name.
    expect(linked.recipes?.[2]?.name).toBe("Basha's Original");
  });

  it("does not collapse dough recipes with DIFFERENT ingredient rows", () => {
    const parsed = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Costco CRB", rows: [{ ingredient: "Flour", lbs: 100 }] },
        { kind: "dough", name: "Basha's Original", rows: [{ ingredient: "Semolina", lbs: 50 }] },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", ["CRB Dough"]);
    expect(linked.recipes?.[1]?.name).toBe("Basha's Original");
  });

  it("does NOT family-fold a dough recipe whose ingredients CONFLICT with the pool recipe", () => {
    // "Masa Dough (Lowes Natural)" name-matches the "Masa Dough" family by
    // token subset, but it is a DIFFERENT formula (cream of tartar + sodium
    // bicarbonate vs baking powder + dough conditioner) — it must stay its
    // own recipe, never become a variant.
    const parsed = {
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Masa Dough (Lowes Natural)",
          rows: [
            { ingredient: "ADM Wheat Flour", lbs: 200 },
            { ingredient: "Cream of Tartar", lbs: 3.75 },
            { ingredient: "Sodium Bicarbonate", lbs: 2.5 },
          ],
        },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", ["Masa Dough"], {
      existingRecipes: [
        {
          name: "Masa Dough",
          rows: [
            { ingredient: "ADM Wheat Flour" },
            { ingredient: "Baking Powder" },
            { ingredient: "Dough Conditioner UFI-U1420" },
          ],
        },
      ],
    });
    expect(linked.recipes?.[0]?.name).toBe("Masa Dough (Lowes Natural)");
    expect(linked.recipes?.[0]?.variantLabel).toBeUndefined();
  });

  it("SUGGESTS the family fold when the pool recipe's rows MATCH or are absent", () => {
    const rows = [
      { ingredient: "Flour", lbs: 100 },
      { ingredient: "Water", lbs: 60 },
    ];
    const mk = () =>
      ({
        profiles: [],
        recipes: [{ kind: "dough", name: "CRB Heavy Plus recipe", rows }],
      }) as unknown as ParsedSpecImport;
    const expected = {
      kind: "dough",
      importedName: "CRB Heavy Plus recipe",
      existingName: "CRB Dough",
    };
    // Matching ingredient sets → fold offered as a suggestion (never silent).
    const matchedSugs: SpecImportLinkSuggestion[] = [];
    const matched = linkSpecImportNamedRecipesToExisting(mk(), "dough", ["CRB Dough"], {
      existingRecipes: [
        { name: "CRB Dough", rows: [{ ingredient: "Water" }, { ingredient: "Flour" }] },
      ],
      suggestions: matchedSugs,
    });
    expect(matched.recipes?.[0]?.name).toBe("CRB Heavy Plus recipe");
    expect(matchedSugs).toContainEqual(expected);
    // Pool recipe rows unknown/empty (placeholder) → no evidence of conflict.
    const noRowsSugs: SpecImportLinkSuggestion[] = [];
    const noRows = linkSpecImportNamedRecipesToExisting(mk(), "dough", ["CRB Dough"], {
      existingRecipes: [{ name: "CRB Dough", rows: [] }],
      suggestions: noRowsSugs,
    });
    expect(noRows.recipes?.[0]?.name).toBe("CRB Heavy Plus recipe");
    expect(noRowsSugs).toContainEqual(expected);
  });

  it("prefers the MORE SPECIFIC pool recipe when both match — natural masa over plain masa", () => {
    // Pool has "Masa Dough" AND "Masa Dough, Natural, (Lowe's)". A spec sheet
    // profile or recipe named "Natural Masa Dough" should snap to the natural
    // variant, NOT to plain "Masa Dough". Without paren-stripping in
    // doughFamilyDistinctiveTokens, "Masa Dough, Natural, (Lowe's)" has
    // distinctive tokens {masa, natural, lowe} — "lowe" is missing from the
    // candidate "natural masa dough" so it fails the subset check and plain
    // "Masa Dough" ({masa} ⊆ {natural, masa} ✓) wins incorrectly. With
    // paren-stripping the natural variant tokenizes to {masa, natural} which
    // wins over {masa} by specificity (count=2 vs count=1).
    const result = findSpecImportDoughFamilyMatch("Natural Masa Dough", [
      "Masa Dough",
      "Masa Dough, Natural, (Lowe's)",
    ]);
    expect(result).toBe("Masa Dough, Natural, (Lowe's)");
  });

  it("profile doughName snaps to the natural masa variant when both pool entries exist", () => {
    const parsed = {
      profiles: [
        {
          brand: "Lowe's",
          flavor: "South of the Border",
          dieType: "11in",
          applicators: [],
          doughName: "Natural Masa Dough",
        },
      ],
      recipes: [],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", [
      "Masa Dough",
      "Masa Dough, Natural, (Lowe's)",
    ]);
    expect(linked.profiles?.[0]?.doughName).toBe("Masa Dough, Natural, (Lowe's)");
  });

  it("does not family-collapse sauce names", () => {
    const sauceParsed = {
      profiles: [
        {
          brand: "B",
          flavor: "F",
          dieType: "11in",
          applicators: [],
          sauceName: "Sweet n Sour Sauce",
        },
      ],
      recipes: [],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(sauceParsed, "sauce", ["Sour Sauce"]);
    expect(linked.profiles?.[0]?.sauceName).toBe("Sweet n Sour Sauce");
  });
});
