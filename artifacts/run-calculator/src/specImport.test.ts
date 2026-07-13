import { describe, it, expect } from "vitest";
import {
  specAliasKey,
  pickAlias,
  canonicalize,
  dropConflictingSpecAliases,
  collectSpecAliases,
  gridsToPromptText,
  splitGridsForPrompt,
  applyNameMatches,
  collectMatchCandidates,
  crossFillSpecImport,
  recipeTargets,
  recipeApplyTargets,
  isCatchAllFlavor,
  groundRecipeName,
  sanitizeParsedSpecImport,
  summarizeSpecImport,
  mergeParsedSpecImports,
  assignApplicatorSlots,
  partitionTombstonedParse,
  recipeApplyIssue,
  profileApplyIssue,
  isFailedParsePass,
  shouldRetryParsePass,
  resolveRetriedParsePass,
  RETRY_MIN_CHUNK_CHARS,
  SPEC_ALIAS_KINDS,
  findTruncatedCells,
  formatTruncatedCellsNote,
  findOverflowColumnRows,
  formatOverflowColumnsNote,
  PROMPT_MAX_CELL_CHARS,
  TRUNCATED_NOTE_MAX_LOCATIONS,
  parseEmbeddedBlend,
  extractEmbeddedApplicatorBlends,
  type ParsedSpecImport,
  type SheetGrid,
  type SpecImportAlias,
  type SpecMatchKnown,
  type CanonicalResult,
} from "@workspace/spec-import";

describe("specAliasKey", () => {
  it("is case-insensitive and trims", () => {
    expect(specAliasKey("brand", "  Tombstone ", null)).toBe(
      specAliasKey("brand", "tombstone", null),
    );
  });
  it("scopes by context case-insensitively", () => {
    expect(specAliasKey("flavor", "Pep", "Tombstone")).toBe(
      specAliasKey("flavor", "pep", "tombstone"),
    );
    expect(specAliasKey("flavor", "Pep", "Tombstone")).not.toBe(
      specAliasKey("flavor", "Pep", "DiGiorno"),
    );
  });
  it("treats null and empty context the same", () => {
    expect(specAliasKey("brand", "x", null)).toBe(specAliasKey("brand", "x", ""));
  });
});

describe("pickAlias", () => {
  const aliases: SpecImportAlias[] = [
    { kind: "brand", externalName: "TmbStn", canonicalName: "Tombstone", context: null },
    { kind: "flavor", externalName: "Pep", canonicalName: "Pepperoni", context: "Tombstone" },
    { kind: "flavor", externalName: "Pep", canonicalName: "Pepperoni Deluxe", context: "DiGiorno" },
  ];
  it("returns the canonical name for a known external label", () => {
    expect(pickAlias(aliases, "brand", "tmbstn")).toBe("Tombstone");
  });
  it("respects context scoping for flavors", () => {
    expect(pickAlias(aliases, "flavor", "pep", "Tombstone")).toBe("Pepperoni");
    expect(pickAlias(aliases, "flavor", "pep", "DiGiorno")).toBe("Pepperoni Deluxe");
  });
  it("returns null when there is no match", () => {
    expect(pickAlias(aliases, "brand", "unknown")).toBeNull();
    expect(pickAlias(aliases, "flavor", "pep", "Nope")).toBeNull();
  });
});

describe("canonicalize", () => {
  const known = ["Tombstone", "DiGiorno", "Red Baron"];
  const aliases: SpecImportAlias[] = [
    { kind: "brand", externalName: "TmbStn", canonicalName: "Tombstone", context: null },
  ];
  it("prefers a learned alias", () => {
    const r = canonicalize("TmbStn", known, aliases, "brand");
    expect(r.source).toBe("alias");
    expect(r.value).toBe("Tombstone");
    expect(r.externalName).toBe("TmbStn");
  });
  it("matches case-insensitively as exact", () => {
    const r = canonicalize("tombstone", known, aliases, "brand");
    expect(r.source).toBe("exact");
    expect(r.value).toBe("Tombstone");
  });
  it("matches a confident fuzzy near-miss", () => {
    const r = canonicalize("Tombstoen", known, aliases, "brand");
    expect(r.source).toBe("fuzzy");
    expect(r.value).toBe("Tombstone");
  });
  it("falls back to new for a distant label", () => {
    const r = canonicalize("Totino's", known, aliases, "brand");
    expect(r.source).toBe("new");
    expect(r.value).toBe("Totino's");
  });
  it("returns empty/new for a blank label", () => {
    const r = canonicalize("   ", known, aliases, "brand");
    expect(r.source).toBe("new");
    expect(r.value).toBe("");
  });
});

describe("dropConflictingSpecAliases", () => {
  const a = (
    kind: SpecImportAlias["kind"],
    externalName: string,
    canonicalName: string,
    context: string | null = null,
  ): SpecImportAlias => ({ kind, externalName, canonicalName, context });

  it("drops both directions of a contradictory cycle within a kind", () => {
    const out = dropConflictingSpecAliases([
      a("flavor", "PEPPERONI", "ULTIMATE PEPPERONI"),
      a("flavor", "ULTIMATE PEPPERONI", "PEPPERONI"),
    ]);
    expect(out).toEqual([]);
  });

  it("drops a chain/collapse where a target is also a source", () => {
    const kept = a("flavor", "Buffalo Chicken", "BBQ Chicken");
    const out = dropConflictingSpecAliases([
      a("flavor", "CHICKEN TIKKA MASALA", "Red Hot Chicken"),
      a("flavor", "CLUB", "Red Hot Chicken"),
      a("flavor", "Red Hot Chicken", "Red Hot"),
      kept,
    ]);
    expect(out).toEqual([kept]);
  });

  it("catches cross-context cycles (context ignored for conflict detection)", () => {
    const out = dropConflictingSpecAliases([
      a("flavor", "HAWAIIAN", "Supreme", "BrandA"),
      a("flavor", "Supreme", "HAWAIIAN", "BrandB"),
    ]);
    expect(out).toEqual([]);
  });

  it("keeps coherent many-to-one mappings (legit for ingredients)", () => {
    const input = [
      a("appType", "mozz", "Whole Mozzarella"),
      a("appType", "mozzarella cheese", "Whole Mozzarella"),
    ];
    expect(dropConflictingSpecAliases(input)).toEqual(input);
  });

  it("scopes conflicts by kind", () => {
    const input = [a("flavor", "Pep", "Pepperoni"), a("brand", "Pepperoni", "Acme")];
    expect(dropConflictingSpecAliases(input)).toEqual(input);
  });
});

describe("canonicalize ignores conflicting aliases", () => {
  it("falls through to exact instead of applying a cyclic alias", () => {
    const aliases: SpecImportAlias[] = [
      { kind: "flavor", externalName: "CHICKEN TIKKA MASALA", canonicalName: "Red Hot Chicken", context: null },
      { kind: "flavor", externalName: "Red Hot Chicken", canonicalName: "Red Hot", context: null },
    ];
    const res = canonicalize("CHICKEN TIKKA MASALA", ["Chicken Tikka Masala"], aliases, "flavor");
    expect(res.source).toBe("exact");
    expect(res.value).toBe("Chicken Tikka Masala");
  });

  it("still applies a clean (non-conflicting) alias", () => {
    const aliases: SpecImportAlias[] = [
      { kind: "flavor", externalName: "Buffalo Chicken", canonicalName: "BBQ Chicken", context: null },
    ];
    const res = canonicalize("Buffalo Chicken", ["BBQ Chicken"], aliases, "flavor");
    expect(res.source).toBe("alias");
    expect(res.value).toBe("BBQ Chicken");
  });
});

describe("collectSpecAliases", () => {
  const mk = (
    source: CanonicalResult["source"],
    externalName: string,
    value: string,
  ): CanonicalResult => ({ source, externalName, value });

  it("keeps only resolved mappings whose raw label meaningfully differs from canonical", () => {
    const out = collectSpecAliases([
      // Fuzzy hits are NO LONGER learned: an unconfirmed fuzzy guess written to
      // factory-wide memory is how poison aliases (Lowe's 7" → Lowe's) got in.
      { kind: "brand", result: mk("fuzzy", "Tombstoen", "Tombstone") },
      { kind: "brand", result: mk("exact", "tombstone", "Tombstone") }, // case-only → skipped
      { kind: "brand", result: mk("new", "Totino's", "Totino's") }, // new → skipped
      { kind: "flavor", result: mk("alias", "Pep", "Pepperoni"), context: "Tombstone" },
    ]);
    // alias(differs) only = 1; fuzzy, case-only and new are all skipped
    expect(out).toHaveLength(1);
    expect(out.find((a) => a.externalName === "Tombstoen")).toBeUndefined();
    const flavor = out.find((a) => a.kind === "flavor");
    expect(flavor?.canonicalName).toBe("Pepperoni");
    expect(flavor?.context).toBe("Tombstone");
  });
  it("skips self-references (same name case-insensitively)", () => {
    const out = collectSpecAliases([
      { kind: "brand", result: mk("exact", "Tombstone", "Tombstone") },
    ]);
    expect(out).toHaveLength(0);
  });
  it("dedupes by identity key (last write wins)", () => {
    const out = collectSpecAliases([
      { kind: "brand", result: mk("alias", "Tmb", "Tombstone") },
      { kind: "brand", result: mk("alias", "tmb", "DiGiorno") },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].canonicalName).toBe("DiGiorno");
  });
  it("never learns from fuzzy matches (unconfirmed guesses stay out of factory-wide memory)", () => {
    const out = collectSpecAliases([
      { kind: "brand", result: mk("fuzzy", "Tmb", "Tombstone") },
      { kind: "appType", result: mk("fuzzy", "Chz Blend", "Six Cheese Blend") },
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("gridsToPromptText", () => {
  it("drops trailing empty cells and fully-empty rows", () => {
    const txt = gridsToPromptText([
      { name: "S1", rows: [["a", "b", "", ""], ["", "", ""], ["c"]] },
    ]);
    expect(txt).toContain("=== SHEET: S1 ===");
    expect(txt).toContain("a\tb");
    expect(txt).toContain("c");
    // the all-empty row should not produce a blank line between rows
    expect(txt.split("\n").filter((l) => l === "")).toHaveLength(0);
  });
  it("truncates when over the total char budget", () => {
    const big = Array.from({ length: 50 }, (_, i) => [`cell-${i}-${"x".repeat(40)}`]);
    const txt = gridsToPromptText([{ name: "Big", rows: big }], { maxTotalChars: 200 });
    expect(txt).toContain("… (truncated)");
  });
  it("bounds sheets/rows/cols", () => {
    const txt = gridsToPromptText(
      [
        { name: "A", rows: [["1", "2", "3"]] },
        { name: "B", rows: [["x"]] },
      ],
      { maxSheets: 1 },
    );
    expect(txt).toContain("SHEET: A");
    expect(txt).not.toContain("SHEET: B");
  });
});

describe("sanitizeParsedSpecImport", () => {
  it("drops malformed profiles and clamps applicators/pepperonis", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [
        { brand: "Tombstone", flavor: "Pepperoni", dieType: "12in", sauceOzPerPizza: "3",
          applicators: [{ type: "Cheese", ozPerPizza: 4 }, { type: "", ozPerPizza: 1 }],
          pepperonis: [{ type: "Pep", sticks: 2, ozPerPizza: 1.5 }] },
        { brand: "", flavor: "NoBrand" },
        "garbage",
      ],
      recipes: [],
    });
    expect(out.profiles).toHaveLength(1);
    const p = out.profiles[0];
    expect(p.dieType).toBe("12in");
    expect(p.sauceOzPerPizza).toBe(3);
    expect(p.applicators).toHaveLength(1);
    expect(p.pepperonis[0].sticks).toBe(2);
  });
  it("warns when an applicator/pepperoni oz-per-pizza was not read (coerced to 0)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [
        { brand: "Tombstone", flavor: "Pepperoni",
          applicators: [{ type: "Cheese" }],
          pepperonis: [{ type: "Pep", sticks: 2 }] },
      ],
      recipes: [],
    });
    expect(out.profiles[0].applicators[0].ozPerPizza).toBe(0);
    expect(out.profiles[0].pepperonis[0].ozPerPizza).toBe(0);
    const msgs = (out.warnings ?? []).map((w) => w.message);
    expect(msgs.some((m) => m.includes('applicator "Cheese"'))).toBe(true);
    expect(msgs.some((m) => m.includes('pepperoni "Pep"'))).toBe(true);
  });
  it("does not warn when oz-per-pizza values were read", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [
        { brand: "Tombstone", flavor: "Pepperoni",
          applicators: [{ type: "Cheese", ozPerPizza: 4 }],
          pepperonis: [{ type: "Pep", sticks: 2, ozPerPizza: 1.5 }] },
      ],
      recipes: [],
    });
    const msgs = (out.warnings ?? []).map((w) => w.message);
    expect(msgs.some((m) => m.includes("No oz-per-pizza"))).toBe(false);
  });
  it("keeps only dough/sauce/cheese recipes with at least one valid row", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        { kind: "dough", name: "Std Dough", doughballOz: "16", rows: [{ ingredient: "Flour", lbs: 50 }] },
        { kind: "cheese", name: "Blend", app: 9, rows: [{ ingredient: "Mozz", lbs: 30 }] },
        { kind: "bogus", name: "X", rows: [{ ingredient: "Y", lbs: 1 }] },
        { kind: "sauce", name: "Empty", rows: [] },
      ],
    });
    expect(out.recipes).toHaveLength(2);
    const dough = out.recipes.find((r) => r.kind === "dough");
    expect(dough?.doughballOz).toBe(16);
    const cheese = out.recipes.find((r) => r.kind === "cheese");
    expect(cheese?.app).toBeUndefined(); // 9 is out of 1-4 range
  });
  it("reads case pack and batch/yield sizes when the sheet states them", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [
        { brand: "Tombstone", flavor: "Pepperoni",
          pizzasPerCase: "16", sauceBarrelLbs: 500,
          applicators: [{ type: "Cheese", ozPerPizza: 4, batchLbs: 55 }],
          pepperonis: [{ type: "Pep", sticks: 2, ozPerPizza: 1.5, batchLbs: 25 }] },
      ],
      recipes: [
        { kind: "dough", name: "Std Dough", doughballOz: 16, doughBatchYield: "640",
          doughballsPerTray: "24", rows: [{ ingredient: "Flour", lbs: 50 }] },
      ],
    });
    const p = out.profiles[0];
    expect(p.pizzasPerCase).toBe(16);
    expect(p.sauceBarrelLbs).toBe(500);
    expect(p.applicators[0].batchLbs).toBe(55);
    expect(p.pepperonis[0].batchLbs).toBe(25);
    const dough = out.recipes.find((r) => r.kind === "dough");
    expect(dough?.doughBatchYield).toBe(640);
    expect(dough?.doughballsPerTray).toBe(24);
  });
  it("omits case pack and batch/yield sizes that are absent or non-positive", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [
        { brand: "Tombstone", flavor: "Cheese",
          pizzasPerCase: 0, sauceBarrelLbs: 0,
          applicators: [{ type: "Cheese", ozPerPizza: 4, batchLbs: 0 }],
          pepperonis: [] },
      ],
      recipes: [
        { kind: "dough", name: "Std Dough", doughballOz: 16, doughBatchYield: 0,
          doughballsPerTray: 0, rows: [{ ingredient: "Flour", lbs: 50 }] },
      ],
    });
    const p = out.profiles[0];
    expect(p.pizzasPerCase).toBeUndefined();
    expect(p.sauceBarrelLbs).toBeUndefined();
    expect(p.applicators[0].batchLbs).toBeUndefined();
    const dough = out.recipes.find((r) => r.kind === "dough");
    expect(dough?.doughBatchYield).toBeUndefined();
    expect(dough?.doughballsPerTray).toBeUndefined();
  });
  it("keeps a real ready-made sauceName but drops generic placeholders", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [
        { brand: "A", flavor: "BBQ Chicken", sauceOzPerPizza: 2.5, sauceName: "Sweet Baby Ray's BBQ" },
        { brand: "A", flavor: "Cheese", sauceOzPerPizza: 3, sauceName: "Sauce" },
        { brand: "A", flavor: "Pepperoni", sauceOzPerPizza: 3, sauceName: "Pizza Sauce" },
      ],
      recipes: [],
    });
    expect(out.profiles).toHaveLength(3);
    expect(out.profiles[0].sauceName).toBe("Sweet Baby Ray's BBQ");
    expect(out.profiles[1].sauceName).toBeUndefined();
    expect(out.profiles[2].sauceName).toBeUndefined();
  });
  it("reads an allergen from the sheet (built-in or new), lower-cased, dropping 'none' spellings", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [
        { brand: "A", flavor: "Egg Wash", allergen: "Egg" },
        { brand: "A", flavor: "Milk Blend", allergen: "Milk" },
        { brand: "A", flavor: "Plain", allergen: "None" },
        { brand: "A", flavor: "Blank", allergen: "" },
        { brand: "A", flavor: "NA", allergen: "N/A" },
      ],
      recipes: [],
    });
    expect(out.profiles).toHaveLength(5);
    expect(out.profiles[0].allergen).toBe("egg");
    expect(out.profiles[1].allergen).toBe("milk");
    expect(out.profiles[2].allergen).toBeUndefined();
    expect(out.profiles[3].allergen).toBeUndefined();
    expect(out.profiles[4].allergen).toBeUndefined();
  });
  it("treats recipe rows as OUNCES by default (converts to lbs), including when rowsUnit is oz or missing", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        { kind: "cheese", name: "Fajita Blend", rowsUnit: "oz",
          rows: [{ ingredient: "Mozz", lbs: 24 }, { ingredient: "Onion", lbs: 9 }] },
        { kind: "dough", name: "Std Dough", rowsUnit: "OUNCES",
          rows: [{ ingredient: "Flour", lbs: 500 }] },
        { kind: "sauce", name: "No Unit Stated",
          rows: [{ ingredient: "Tomato", lbs: 32 }] },
      ],
    });
    expect(out.recipes[0].rows).toEqual([
      { ingredient: "Mozz", lbs: 1.5 },
      { ingredient: "Onion", lbs: 0.563 },
    ]);
    expect(out.recipes[1].rows).toEqual([{ ingredient: "Flour", lbs: 31.25 }]);
    expect(out.recipes[2].rows).toEqual([{ ingredient: "Tomato", lbs: 2 }]);
  });
  it("keeps recipe rows as-is ONLY when the sheet explicitly marks them as pounds", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        { kind: "cheese", name: "A", rowsUnit: "lbs", rows: [{ ingredient: "Mozz", lbs: 24 }] },
        { kind: "cheese", name: "B", rowsUnit: "POUNDS", rows: [{ ingredient: "Mozz", lbs: 24 }] },
        { kind: "cheese", name: "C", rowsUnit: "lb.", rows: [{ ingredient: "Mozz", lbs: 24 }] },
      ],
    });
    for (const r of out.recipes) expect(r.rows[0].lbs).toBe(24);
  });
  it("never throws on garbage input", () => {
    expect(() => sanitizeParsedSpecImport(null)).not.toThrow();
    expect(sanitizeParsedSpecImport(null).profiles).toEqual([]);
    expect(sanitizeParsedSpecImport(42).recipes).toEqual([]);
  });
  it("keeps a recipe's targets[] (multi-profile) and drops malformed ones", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "CRB Dough",
          rows: [{ ingredient: "Flour", lbs: 50 }],
          targets: [
            { brand: "Basha's", flavor: "Original" },
            { brand: "Lowe's CRB", flavor: "Pepperoni" },
            { brand: "", flavor: "NoBrand" },
            { brand: "OnlyBrand" },
            "junk",
          ],
        },
      ],
    });
    expect(out.recipes).toHaveLength(1);
    expect(out.recipes[0].targets).toEqual([
      { brand: "Basha's", flavor: "Original" },
      { brand: "Lowe's CRB", flavor: "Pepperoni" },
    ]);
  });
  it("keeps a nameless recipe that has rows (so the review can rescue it)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        { kind: "sauce", name: "", rows: [{ ingredient: "Tomato", lbs: 20 }] },
        { kind: "cheese", rows: [{ ingredient: "Mozz", lbs: 30 }] },
      ],
    });
    expect(out.recipes).toHaveLength(2);
    expect(out.recipes.every((r) => r.name === "")).toBe(true);
  });

  it("drops catch-all-flavor targets ('All Varieties') and keeps the brand as a brand-wide anchor", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Aldo's Standard Cheese Mix",
          targets: [{ brand: "Aldo's", flavor: "All Varieties" }],
          rows: [{ ingredient: "Part Skim Mozzarella", lbs: 20 }],
        },
      ],
    });
    expect(out.recipes).toHaveLength(1);
    const r = out.recipes[0];
    expect(r.targets).toBeUndefined();
    expect(r.brand).toBe("Aldo's");
    expect(r.flavor).toBeUndefined();
  });

  it("keeps real per-flavor targets while dropping only the catch-all ones", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Mix",
          brand: "Basha's Ultra Thin",
          targets: [
            { brand: "Basha's Ultra Thin", flavor: "Pepperoni" },
            { brand: "Basha's Ultra Thin", flavor: "All" },
          ],
          rows: [{ ingredient: "Whole Mozzarella", lbs: 20 }],
        },
      ],
    });
    expect(out.recipes[0].targets).toEqual([
      { brand: "Basha's Ultra Thin", flavor: "Pepperoni" },
    ]);
  });

  it("preserves a real 'Cheese' flavor target on a cheese recipe (not treated as catch-all)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Mix",
          targets: [
            { brand: "Aldo's", flavor: "Cheese" },
            { brand: "Aldo's", flavor: "All Varieties" },
          ],
          rows: [{ ingredient: "Part Skim Mozzarella", lbs: 20 }],
        },
      ],
    });
    expect(out.recipes[0].targets).toEqual([{ brand: "Aldo's", flavor: "Cheese" }]);
  });

  it("keeps EVERY distinct catch-all brand as a brand anchor (multi-brand shared recipe)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Masa Dough",
          // "This recipe used for Hannaford and Lucia" — two whole-brand targets.
          targets: [
            { brand: "Hannaford", flavor: "All" },
            { brand: "Lucia", flavor: "All" },
          ],
          rows: [{ ingredient: "ADM Wheat Flour", lbs: 200 }],
        },
      ],
    });
    const r = out.recipes[0];
    expect(r.targets).toBeUndefined();
    expect(r.brandAnchors).toEqual(["Hannaford", "Lucia"]);
    // No single brand is representative of two customers, so `brand` stays empty.
    expect(r.brand).toBeUndefined();
  });

  it("keeps a real per-flavor target AND records a different brand's catch-all as an anchor", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "cheese",
          name: "Shared Blend",
          // One explicit per-flavor mapping plus a whole-brand catch-all for a
          // different customer — the explicit target must survive untouched while
          // the catch-all brand is lifted to an anchor.
          targets: [
            { brand: "DiGiorno", flavor: "Supreme" },
            { brand: "Lowes", flavor: "All Varieties" },
          ],
          rows: [{ ingredient: "Mozzarella", lbs: 50 }],
        },
      ],
    });
    const r = out.recipes[0];
    expect(r.targets).toEqual([{ brand: "DiGiorno", flavor: "Supreme" }]);
    expect(r.brandAnchors).toEqual(["Lowes"]);
    // Exactly one catch-all anchor + no singular brand → back-compat `brand`.
    expect(r.brand).toBe("Lowes");
  });

  it("de-dupes repeated catch-all brands case-insensitively into anchors", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "sauce",
          name: "Shared Sauce",
          targets: [
            { brand: "Aldo's", flavor: "All Varieties" },
            { brand: "aldo's", flavor: "Sauce" },
          ],
          rows: [{ ingredient: "Tomato Paste", lbs: 100 }],
        },
      ],
    });
    const r = out.recipes[0];
    expect(r.brandAnchors).toEqual(["Aldo's"]);
    expect(r.brand).toBe("Aldo's");
  });

  it("drops a dough target whose flavor is just the recipe kind ('Dough')", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Aldo's Dough",
          targets: [{ brand: "Aldo's", flavor: "Dough" }],
          rows: [{ ingredient: "Flour", lbs: 200 }],
        },
      ],
    });
    const r = out.recipes[0];
    expect(r.targets).toBeUndefined();
    expect(r.brand).toBe("Aldo's");
  });

  it("demotes a target flavor invented by the model (absent from source) to a brand anchor", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          {
            kind: "dough",
            name: "Modified Malted Barley Dough",
            brand: "Four Hands",
            // The model hallucinated "Mission Taco Mexican" — the sheet only says
            // "Four Hands ... varieties" (whole-brand), never a specific flavor.
            targets: [{ brand: "Four Hands", flavor: "Mission Taco Mexican" }],
            rows: [{ ingredient: "ADM Wheat Flour", lbs: 200 }],
          },
        ],
      },
      {},
      { sourceText: "FOUR HANDS Modified Barley Pizza varieties\nADM Wheat Flour" },
    );
    const r = out.recipes[0];
    expect(r.targets).toBeUndefined();
    expect(r.brandAnchors).toEqual(["Four Hands"]);
  });

  it("KEEPS a real target flavor that appears in the source (no false demotion)", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          {
            kind: "dough",
            name: "Naan Dough",
            targets: [{ brand: "Hannaford", flavor: "Masala Pizza" }],
            rows: [{ ingredient: "Flour", lbs: 200 }],
          },
        ],
      },
      {},
      { sourceText: "NAAN DOUGH\nHannaford (Masala Pizza)\t11.5\t0.72" },
    );
    expect(out.recipes[0].targets).toEqual([{ brand: "Hannaford", flavor: "Masala Pizza" }]);
  });

  it("KEEPS a known flavor even when it is absent from the source text", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          {
            kind: "cheese",
            name: "Shared Blend",
            targets: [{ brand: "Aldo's", flavor: "Pepperoni" }],
            rows: [{ ingredient: "Mozzarella", lbs: 50 }],
          },
        ],
      },
      {},
      { sourceText: "just some rows with no flavor words", knownFlavors: ["Pepperoni"] },
    );
    expect(out.recipes[0].targets).toEqual([{ brand: "Aldo's", flavor: "Pepperoni" }]);
  });

  it("does NOT demote any target flavor when no grounding is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Some Dough",
          targets: [{ brand: "Four Hands", flavor: "Totally Invented Flavor" }],
          rows: [{ ingredient: "Flour", lbs: 200 }],
        },
      ],
    });
    expect(out.recipes[0].targets).toEqual([
      { brand: "Four Hands", flavor: "Totally Invented Flavor" },
    ]);
  });
});

describe("sanitizeParsedSpecImport — profile flavor grounding", () => {
  // Flattened workbook text: tab-separated cells, one sheet block per brand.
  const workbook =
    "ALDO'S PIZZAS\tSPECS\n" +
    "Flavor\tSauce oz\tCheese oz\n" +
    "Cheese\t3\t4\n" +
    "Pepperoni\t3\t4.5\n" +
    "Buffalo Chicken\t2.5\t4\n";

  it("snaps a paraphrased profile flavor back to the flavor written on the sheet", () => {
    // The model paraphrased "Buffalo Chicken" into "BBQ Chicken" — the token
    // check alone can't catch this ("chicken" appears either way), so the full
    // phrase must be grounded and snapped to the nearest real flavor.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [
          { brand: "Aldo's", flavor: "Cheese" },
          { brand: "Aldo's", flavor: "Pepperoni" },
          { brand: "Aldo's", flavor: "BBQ Chicken" },
        ],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles.map((p) => p.flavor)).toEqual([
      "Cheese",
      "Pepperoni",
      "Buffalo Chicken",
    ]);
    // Correction surfaces as a STRUCTURED warning keyed to the final profile
    // names (so review UIs can attach it to the row) — not folded into `note`.
    expect(out.note).toBeUndefined();
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0].brand).toBe("Aldo's");
    expect(out.warnings![0].flavor).toBe("Buffalo Chicken");
    expect(out.warnings![0].message).toContain(
      'Corrected flavor "BBQ Chicken" to "Buffalo Chicken"',
    );
  });

  it("prefers a KNOWN flavor over a raw sheet cell when both could snap", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "BBQ Chicken" }],
        recipes: [],
      },
      {},
      { sourceText: workbook, knownFlavors: ["Buffalo Chicken", "Cheese", "Pepperoni"] },
    );
    expect(out.profiles[0].flavor).toBe("Buffalo Chicken");
  });

  it("keeps a profile flavor that appears verbatim on the sheet (no false snap)", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Buffalo Chicken" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].flavor).toBe("Buffalo Chicken");
    expect(out.note).toBeUndefined();
    expect(out.warnings).toBeUndefined();
  });

  it("keeps a KNOWN flavor even when it is absent from the source text", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Hawaiian" }],
        recipes: [],
      },
      {},
      { sourceText: workbook, knownFlavors: ["Hawaiian"] },
    );
    expect(out.profiles[0].flavor).toBe("Hawaiian");
    expect(out.note).toBeUndefined();
    expect(out.warnings).toBeUndefined();
  });

  it("is case/punctuation-insensitive when checking the sheet for the flavor", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Buffalo-Chicken" }],
        recipes: [],
      },
      {},
      { sourceText: "ALDO'S\nBUFFALO   CHICKEN\t2.5\t4\n" },
    );
    expect(out.profiles[0].flavor).toBe("Buffalo-Chicken");
    expect(out.note).toBeUndefined();
    expect(out.warnings).toBeUndefined();
  });

  it("flags (keeps + notes) an invented flavor with no plausible sheet match", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Mission Taco Mexican" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    // Never dropped (no data loss), but never silently accepted either.
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0].flavor).toBe("Mission Taco Mexican");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Aldo's", flavor: "Mission Taco Mexican" });
    expect(out.warnings![0].message).toContain(
      'Flavor "Mission Taco Mexican" (brand Aldo\'s) was not found',
    );
  });

  it("does not treat cross-cell adjacency as grounding (per-cell phrase check)", () => {
    // "BBQ" and "Chicken" sit in SEPARATE adjacent cells — a whole-text
    // substring check would false-positive on the joined text and silently
    // accept the invented flavor; the per-cell check must flag or correct it.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "BBQ Chicken" }],
        recipes: [],
      },
      {},
      { sourceText: "Toppings sheet\nBBQ\tChicken\t2\n" },
    );
    expect(out.profiles).toHaveLength(1);
    expect(out.warnings?.length).toBeTruthy(); // corrected or flagged — never silent
  });

  it("leaves profiles untouched when no grounding is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [{ brand: "Aldo's", flavor: "Totally Invented Flavor" }],
      recipes: [],
    });
    expect(out.profiles[0].flavor).toBe("Totally Invented Flavor");
    expect(out.note).toBeUndefined();
    expect(out.warnings).toBeUndefined();
  });

  it("keeps the model note intact and puts flavor warnings in `warnings`", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "BBQ Chicken" }],
        recipes: [],
        note: "Could not parse the second sheet.",
      },
      {},
      { sourceText: workbook },
    );
    expect(out.note).toBe("Could not parse the second sheet.");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0].message).toContain(
      'Corrected flavor "BBQ Chicken" to "Buffalo Chicken"',
    );
  });
});

describe("sanitizeParsedSpecImport — profile SAUCE NAME grounding", () => {
  // Flattened workbook text: tab-separated cells; the sauce column names the
  // ready-made sauce each flavor pulls.
  const workbook =
    "ALDO'S PIZZAS\tSPECS\n" +
    "Flavor\tSauce\tSauce oz\n" +
    "Cheese\tHot Buffalo Sauce\t2.5\n" +
    "Buffalo Chicken\tRanch\t2\n";

  it("snaps a paraphrased sauce name back to the sauce written on the sheet", () => {
    // The model paraphrased "Hot Buffalo Sauce" into "Buffalo Wing Sauce" —
    // that points the profile at a sauce recipe that doesn't exist, so sauce
    // consumption/batching would never match up.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Buffalo Wing Sauce" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].sauceName).toBe("Hot Buffalo Sauce");
    // Correction surfaces as a STRUCTURED warning keyed to the profile's
    // brand+flavor row so review UIs can attach it to the right profile.
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0].brand).toBe("Aldo's");
    expect(out.warnings![0].flavor).toBe("Cheese");
    expect(out.warnings![0].message).toContain(
      'Corrected sauce "Buffalo Wing Sauce" to "Hot Buffalo Sauce"',
    );
  });

  it("prefers the sauce-mentioning cell over a flavor cell sharing tokens", () => {
    // "Buffalo Wing Sauce" shares "buffalo" with BOTH the "Buffalo Chicken"
    // flavor cell and the "Hot Buffalo Sauce" sauce cell — the sauce row must
    // win or we'd point the profile at a flavor, not a sauce.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Buffalo Wing Sauce" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].sauceName).toBe("Hot Buffalo Sauce");
  });

  it("keeps a sauce name that appears verbatim on the sheet (no false snap)", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Buffalo Chicken", sauceName: "Ranch" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].sauceName).toBe("Ranch");
    expect(out.warnings).toBeUndefined();
  });

  it("keeps a KNOWN sauce name even when it is absent from the sheet", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Marinara" }],
        recipes: [],
      },
      {},
      { sourceText: workbook, knownSauceNames: ["Marinara"] },
    );
    expect(out.profiles[0].sauceName).toBe("Marinara");
    expect(out.warnings).toBeUndefined();
  });

  it('does not flag a legitimate "X" -> "X Sauce" transform', () => {
    // The sheet's sauce cell just says "BBQ"; capturing it as "BBQ Sauce" is a
    // naming transform, not an invention — must stay unflagged.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "BBQ Sauce" }],
        recipes: [],
      },
      {},
      { sourceText: "ALDO'S\nFlavor\tSauce\nCheese\tBBQ\t2.5\n" },
    );
    expect(out.profiles[0].sauceName).toBe("BBQ Sauce");
    expect(out.warnings).toBeUndefined();
  });

  it("keeps a short sauce name whose only checkable token is the generic word", () => {
    // "Q Sauce" tokenizes to nothing beyond "sauce" — nothing checkable, so it
    // must be kept without a false flag.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Q Sauce" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].sauceName).toBe("Q Sauce");
    expect(out.warnings).toBeUndefined();
  });

  it("flags (keeps + warns) an invented sauce with no plausible sheet match", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Sriracha Glaze" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    // Never dropped (no data loss), but never silently accepted either.
    expect(out.profiles[0].sauceName).toBe("Sriracha Glaze");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Aldo's", flavor: "Cheese" });
    expect(out.warnings![0].message).toContain('Sauce "Sriracha Glaze"');
    expect(out.warnings![0].message).toContain("was not found");
  });

  it("never snaps TO a generic placeholder cell like 'Pizza Sauce'", () => {
    // The only shared-token cell is the generic "Pizza Sauce" — snapping to it
    // would mint the very placeholder the sanitizer drops. Flag instead.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Marinara Pizza Blend" }],
        recipes: [],
      },
      {},
      { sourceText: "ALDO'S\nFlavor\tSauce\nCheese\tPizza Sauce\t2.5\n" },
    );
    expect(out.profiles[0].sauceName).toBe("Marinara Pizza Blend");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0].message).toContain("was not found");
  });

  it("keys the sauce warning to the FINAL flavor after flavor grounding snapped it", () => {
    // The flavor itself gets corrected ("BBQ Chicken" -> "Buffalo Chicken");
    // the sauce warning must key to the corrected row, not the invented one.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "BBQ Chicken", sauceName: "Sriracha Glaze" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].flavor).toBe("Buffalo Chicken");
    const sauceWarn = out.warnings!.find((w) => w.message.includes("Sriracha Glaze"));
    expect(sauceWarn).toMatchObject({ brand: "Aldo's", flavor: "Buffalo Chicken" });
  });

  it("leaves sauce names untouched when no grounding is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Totally Invented Sauce" }],
      recipes: [],
    });
    expect(out.profiles[0].sauceName).toBe("Totally Invented Sauce");
    expect(out.warnings).toBeUndefined();
  });

  it("still drops a generic sauceName outright (grounding does not resurrect it)", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Cheese", sauceName: "Pizza Sauce" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].sauceName).toBeUndefined();
    expect(out.warnings).toBeUndefined();
  });
});

describe("sanitizeParsedSpecImport — profile BRAND grounding", () => {
  const workbook =
    "BASHA'S ULTRA THIN CRUST PIZZAS\tSPECS\n" +
    "Flavor\tSauce oz\tCheese oz\n" +
    "Cheese\t3\t4\n" +
    "Pepperoni\t3\t4.5\n";

  it("snaps a paraphrased brand back to the brand written on the sheet", () => {
    // The model paraphrased "Ultra Thin" into "Ultra Slim" — the snapped result
    // comes from the header cell with the generic trailing "Pizzas" stripped.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Basha's Ultra Slim Crust", flavor: "Cheese" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].brand).toBe("BASHA'S ULTRA THIN CRUST");
    // Correction surfaces as a STRUCTURED warning keyed to the final profile
    // names — not folded into `note`.
    expect(out.note).toBeUndefined();
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({
      brand: "BASHA'S ULTRA THIN CRUST",
      flavor: "Cheese",
    });
    expect(out.warnings![0].message).toContain(
      'Corrected brand "Basha\'s Ultra Slim Crust" to "BASHA\'S ULTRA THIN CRUST"',
    );
  });

  it("prefers a KNOWN brand over a raw sheet cell when both could snap", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Basha's Ultra Slim Crust", flavor: "Cheese" }],
        recipes: [],
      },
      {},
      { sourceText: workbook, knownBrands: ["Basha's Ultra Thin Crust"] },
    );
    expect(out.profiles[0].brand).toBe("Basha's Ultra Thin Crust");
  });

  it("does NOT flag the required drop of generic trailing words like 'Pizzas'", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Basha's Ultra Thin Crust", flavor: "Cheese" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].brand).toBe("Basha's Ultra Thin Crust");
    expect(out.note).toBeUndefined();
  });

  it("does NOT flag a size legitimately folded into the brand", () => {
    // The prompt REQUIRES folding a size like 7in into the brand; the size may
    // sit in a different cell than the brand header — never false-flag it.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Lowes 7in", flavor: "Pepperoni" }],
        recipes: [],
      },
      {},
      { sourceText: "LOWES PIZZAS\tSPECS\nSize\t7in\nPepperoni\t3\t4.5\n" },
    );
    expect(out.profiles[0].brand).toBe("Lowes 7in");
    expect(out.note).toBeUndefined();
  });

  it("counts a token-subset match against a single sheet cell as grounded", () => {
    // Word-order / partial transforms of one header cell are legitimate.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Basha's Crust", flavor: "Cheese" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].brand).toBe("Basha's Crust");
    expect(out.note).toBeUndefined();
  });

  it("keeps a KNOWN brand even when it is absent from the source text", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Hannaford", flavor: "Cheese" }],
        recipes: [],
      },
      {},
      { sourceText: workbook, knownBrands: ["Hannaford"] },
    );
    expect(out.profiles[0].brand).toBe("Hannaford");
    expect(out.note).toBeUndefined();
  });

  it("flags (keeps + notes) an invented brand with no plausible sheet match", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Mission Foods", flavor: "Cheese" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    // Never dropped (no data loss), but never silently accepted either.
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0].brand).toBe("Mission Foods");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Mission Foods", flavor: "Cheese" });
    expect(out.warnings![0].message).toContain('Brand "Mission Foods" was not found');
  });

  it("is case/punctuation-insensitive when checking the sheet for the brand", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "basha's ultra-thin crust", flavor: "Cheese" }],
        recipes: [],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.profiles[0].brand).toBe("basha's ultra-thin crust");
    expect(out.note).toBeUndefined();
  });

  it("leaves brands untouched when no grounding is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [{ brand: "Totally Invented Brand Co", flavor: "Cheese" }],
      recipes: [],
    });
    expect(out.profiles[0].brand).toBe("Totally Invented Brand Co");
    expect(out.note).toBeUndefined();
  });

  it("grounds a corrected brand+flavor together (both backstops in one pass)", () => {
    const wb =
      "ALDO'S PIZZAS\tSPECS\n" +
      "Cheese\t3\t4\n" +
      "Buffalo Chicken\t2.5\t4\n";
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo Premium", flavor: "BBQ Chicken" }],
        recipes: [],
      },
      {},
      { sourceText: wb, knownBrands: ["Aldo's"], knownFlavors: ["Buffalo Chicken"] },
    );
    expect(out.profiles[0].brand).toBe("Aldo's");
    expect(out.profiles[0].flavor).toBe("Buffalo Chicken");
    // BOTH warnings are keyed to the FINAL brand+flavor (post-snap on both
    // axes) so they attach to the same review row.
    const msgs = (out.warnings ?? []).map((w) => w.message).join("\n");
    expect(msgs).toContain('Corrected brand "Aldo Premium" to "Aldo\'s"');
    expect(msgs).toContain('Corrected flavor "BBQ Chicken" to "Buffalo Chicken"');
    for (const w of out.warnings ?? []) {
      expect(w).toMatchObject({ brand: "Aldo's", flavor: "Buffalo Chicken" });
    }
  });
});

describe("sanitizeParsedSpecImport — RECIPE brand grounding", () => {
  const workbook =
    "BASHA'S ULTRA THIN CRUST PIZZAS\tSPECS\n" +
    "Flavor\tSauce oz\tCheese oz\n" +
    "Cheese\t3\t4\n" +
    "Pepperoni\t3\t4.5\n" +
    "DOUGH RECIPE\nFlour\t50\nWater\t30\n";
  const doughRecipe = (extra: Record<string, unknown>) => ({
    kind: "dough",
    name: "Thin Dough",
    rows: [{ ingredient: "Flour", lbs: 50 }],
    ...extra,
  });

  it("snaps a paraphrased singular recipe brand back to the sheet's brand", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [doughRecipe({ brand: "Basha's Ultra Slim Crust" })],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].brand).toBe("BASHA'S ULTRA THIN CRUST");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "BASHA'S ULTRA THIN CRUST", flavor: "" });
    expect(out.warnings![0].message).toContain(
      'Corrected brand "Basha\'s Ultra Slim Crust" to "BASHA\'S ULTRA THIN CRUST"',
    );
  });

  it("prefers a KNOWN brand over a raw sheet cell for a recipe brand", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [doughRecipe({ brand: "Basha's Ultra Slim Crust" })],
      },
      {},
      { sourceText: workbook, knownBrands: ["Basha's Ultra Thin Crust"] },
    );
    expect(out.recipes[0].brand).toBe("Basha's Ultra Thin Crust");
  });

  it("flags (keeps + notes) an invented recipe brand with no plausible match", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [doughRecipe({ brand: "Mission Foods" })],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].brand).toBe("Mission Foods");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Mission Foods", flavor: "" });
    expect(out.warnings![0].message).toContain('Brand "Mission Foods" was not found');
  });

  it("does NOT flag a legitimate trailer-drop or folded size on a recipe brand", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          doughRecipe({ brand: "Basha's Ultra Thin Crust" }),
          doughRecipe({ name: "Lowes Dough", brand: "Lowes 7in" }),
        ],
      },
      {},
      {
        sourceText:
          workbook + "LOWES PIZZAS\tSPECS\nSize\t7in\nPepperoni\t3\t4.5\n",
      },
    );
    expect(out.recipes[0].brand).toBe("Basha's Ultra Thin Crust");
    expect(out.recipes[1].brand).toBe("Lowes 7in");
    expect(out.warnings).toBeUndefined();
  });

  it("counts a token-subset of one cell as grounded for a recipe brand", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [doughRecipe({ brand: "Basha's Crust" })],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].brand).toBe("Basha's Crust");
    expect(out.warnings).toBeUndefined();
  });

  it("grounds the brand half of specific targets (flavor half unchanged)", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          doughRecipe({
            targets: [{ brand: "Basha's Ultra Slim Crust", flavor: "Cheese" }],
          }),
        ],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].targets).toEqual([
      { brand: "BASHA'S ULTRA THIN CRUST", flavor: "Cheese" },
    ]);
    const msgs = (out.warnings ?? []).map((w) => w.message).join("\n");
    expect(msgs).toContain('Corrected brand "Basha\'s Ultra Slim Crust"');
  });

  it("grounds brandAnchors built from catch-all targets, deduping post-snap", () => {
    // Two paraphrases of the same sheet brand must collapse to ONE anchor
    // after snapping, and back-compat `brand` mirrors the single anchor.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          doughRecipe({
            targets: [
              { brand: "Basha's Ultra Slim Crust", flavor: "All Varieties" },
              { brand: "Basha's Slim Crust", flavor: "Dough" },
            ],
          }),
        ],
      },
      {},
      { sourceText: workbook, knownBrands: ["Basha's Ultra Thin Crust"] },
    );
    const r = out.recipes[0];
    expect(r.brandAnchors).toEqual(["Basha's Ultra Thin Crust"]);
    expect(r.brand).toBe("Basha's Ultra Thin Crust");
  });

  it("flags an invented brand inside a target without dropping the anchor", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          doughRecipe({ targets: [{ brand: "Mission Foods", flavor: "All" }] }),
        ],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].brandAnchors).toEqual(["Mission Foods"]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Mission Foods", flavor: "" });
    expect(out.warnings![0].message).toContain('Brand "Mission Foods" was not found');
  });

  it("leaves recipe brands untouched when no grounding is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [doughRecipe({ brand: "Totally Invented Brand Co" })],
    });
    expect(out.recipes[0].brand).toBe("Totally Invented Brand Co");
    expect(out.warnings).toBeUndefined();
  });

  it("dedupes recipe-side warnings for the same bad brand, keeping the profile-row one distinct", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Mission Foods", flavor: "Cheese" }],
        recipes: [
          doughRecipe({ brand: "Mission Foods" }),
          doughRecipe({ name: "Other Dough", brand: "Mission Foods" }),
        ],
      },
      {},
      { sourceText: workbook },
    );
    const hits = (out.warnings ?? []).filter((w) =>
      w.message.includes('Brand "Mission Foods" was not found'),
    );
    // One warning keyed to the profile row (flavor "Cheese"), one recipe-level
    // warning (flavor "") shared by BOTH recipes — not one per recipe.
    expect(hits).toHaveLength(2);
    expect(hits.map((w) => w.flavor).sort()).toEqual(["", "Cheese"]);
  });
});

describe("sanitizeParsedSpecImport — RECIPE flavor grounding", () => {
  const workbook =
    "ALDO'S PIZZAS\tSPECS\n" +
    "Flavor\tSauce oz\tCheese oz\n" +
    "Cheese\t3\t4\n" +
    "Pepperoni\t3\t4.5\n" +
    "Buffalo Chicken\t2.5\t4\n" +
    "SAUCE RECIPE\nTomato Paste\t50\nWater\t30\n";
  const sauceRecipe = (extra: Record<string, unknown>) => ({
    kind: "sauce",
    name: "Buffalo Sauce",
    rows: [{ ingredient: "Tomato Paste", lbs: 50 }],
    ...extra,
  });

  it("snaps a paraphrased recipe flavor back to the flavor written on the sheet", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [sauceRecipe({ brand: "Aldo's", flavor: "BBQ Chicken" })],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].flavor).toBe("Buffalo Chicken");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Aldo's", flavor: "Buffalo Chicken" });
    expect(out.warnings![0].message).toContain(
      'Corrected flavor "BBQ Chicken" to "Buffalo Chicken" (brand Aldo\'s)',
    );
  });

  it("prefers a KNOWN flavor over a raw sheet cell when both could snap", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [sauceRecipe({ brand: "Aldo's", flavor: "BBQ Chicken" })],
      },
      {},
      { sourceText: workbook, knownFlavors: ["Buffalo Chicken", "Cheese", "Pepperoni"] },
    );
    expect(out.recipes[0].flavor).toBe("Buffalo Chicken");
  });

  it("keeps a recipe flavor that appears verbatim on the sheet (no false snap)", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [sauceRecipe({ brand: "Aldo's", flavor: "Buffalo Chicken" })],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].flavor).toBe("Buffalo Chicken");
    expect(out.warnings).toBeUndefined();
  });

  it("keeps a KNOWN recipe flavor even when it is absent from the source text", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [sauceRecipe({ brand: "Aldo's", flavor: "Hawaiian" })],
      },
      {},
      { sourceText: workbook, knownFlavors: ["Hawaiian"] },
    );
    expect(out.recipes[0].flavor).toBe("Hawaiian");
    expect(out.warnings).toBeUndefined();
  });

  it("flags (keeps + warns) an invented recipe flavor with no plausible match", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [sauceRecipe({ brand: "Aldo's", flavor: "Mission Taco Mexican" })],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].flavor).toBe("Mission Taco Mexican");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Aldo's", flavor: "Mission Taco Mexican" });
    expect(out.warnings![0].message).toContain(
      'Flavor "Mission Taco Mexican" (brand Aldo\'s) was not found',
    );
  });

  it("omits the brand parenthetical from the warning when the recipe has no brand", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [sauceRecipe({ flavor: "Mission Taco Mexican" })],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "", flavor: "Mission Taco Mexican" });
    expect(out.warnings![0].message).toBe(
      'Flavor "Mission Taco Mexican" was not found on the sheet — please verify.',
    );
  });

  it("does NOT false-flag catch-all flavors or the recipe's own kind", () => {
    // "All Varieties" is a whole-brand scope word and "Dough"/"Sauce" are the
    // recipe's own kind used as placeholders — none appear as flavors on the
    // sheet, but they are not inventions and must pass silently.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          sauceRecipe({ brand: "Aldo's", flavor: "All Varieties" }),
          sauceRecipe({ name: "Base Sauce", brand: "Aldo's", flavor: "Sauce" }),
          {
            kind: "dough",
            name: "Thin Dough",
            rows: [{ ingredient: "Flour", lbs: 50 }],
            brand: "Aldo's",
            flavor: "Dough",
          },
        ],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes.map((r) => r.flavor)).toEqual(["All Varieties", "Sauce", "Dough"]);
    expect(out.warnings).toBeUndefined();
  });

  it("DOES ground a cheese recipe's 'Cheese' flavor (a real flavor, not catch-all)", () => {
    // "Cheese" on a cheese recipe is a legitimate flavor name — it must go
    // through grounding like any other; here it appears on the sheet, so no warn.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          {
            kind: "cheese",
            name: "Cheese Blend",
            rows: [{ ingredient: "Mozzarella", lbs: 50 }],
            brand: "Aldo's",
            flavor: "Cheese",
          },
        ],
      },
      {},
      { sourceText: workbook },
    );
    expect(out.recipes[0].flavor).toBe("Cheese");
    expect(out.warnings).toBeUndefined();
  });

  it("leaves recipe flavors untouched when no grounding is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [sauceRecipe({ brand: "Aldo's", flavor: "Totally Invented Flavor" })],
    });
    expect(out.recipes[0].flavor).toBe("Totally Invented Flavor");
    expect(out.warnings).toBeUndefined();
  });

  it("keys the warning to the GROUNDED recipe brand (brand snaps first)", () => {
    // "Aldo Bros" shares the "aldo" token with the "ALDO'S PIZZAS" header
    // cell, so the brand snaps (trailer stripped) BEFORE the flavor warning is
    // keyed — the warning must carry the final brand, not the raw one.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [sauceRecipe({ brand: "Aldo Bros", flavor: "Mission Taco Mexican" })],
      },
      {},
      { sourceText: workbook },
    );
    const flavorWarn = (out.warnings ?? []).find((w) =>
      w.message.includes('Flavor "Mission Taco Mexican"'),
    );
    expect(out.recipes[0].brand).toBe("ALDO'S");
    expect(flavorWarn).toBeDefined();
    expect(flavorWarn!.brand).toBe("ALDO'S");
  });
});

describe("groundRecipeName", () => {
  const known = ["Ultra Thin Dough", "Rising Crust Dough", "Gluten Free Dough"];

  it("passes an exact (case-insensitive) match untouched", () => {
    expect(groundRecipeName("Ultra Thin Dough", known)).toEqual({ kind: "grounded" });
    expect(groundRecipeName("ULTRA THIN DOUGH", known)).toEqual({ kind: "grounded" });
    expect(groundRecipeName("  ultra thin dough  ", known)).toEqual({ kind: "grounded" });
  });

  it("snaps a punctuation/spacing variant of an existing name", () => {
    expect(groundRecipeName("Ultra-Thin Dough", known)).toEqual({
      kind: "snapped",
      name: "Ultra Thin Dough",
    });
  });

  it("snaps when only generic filler words differ (identical distinctive tokens)", () => {
    expect(groundRecipeName("Ultra Thin Dough Recipe", known)).toEqual({
      kind: "snapped",
      name: "Ultra Thin Dough",
    });
    expect(groundRecipeName("Ultra Thin Pizza Dough Mix", known)).toEqual({
      kind: "snapped",
      name: "Ultra Thin Dough",
    });
  });

  it("flags (keeps) a plausible-but-uncertain paraphrase with the closest match", () => {
    // [thin, crust] vs [ultra, thin] and [rising, crust] both share one of two
    // distinctive tokens (score 0.5) — plausible, not certain → flag not snap.
    const res = groundRecipeName("Thin Crust Dough", known);
    expect(res.kind).toBe("flagged");
  });

  it("passes a genuinely new recipe name untouched", () => {
    expect(groundRecipeName("Sourdough Base", known)).toEqual({ kind: "grounded" });
    expect(groundRecipeName("Whole Wheat Dough", known)).toEqual({ kind: "grounded" });
  });

  it("never judges with no known names, a blank name, or an all-generic name", () => {
    expect(groundRecipeName("Ultra-Thin Dough", [])).toEqual({ kind: "grounded" });
    expect(groundRecipeName("   ", known)).toEqual({ kind: "grounded" });
    // "Pizza Dough Mix" has no distinctive tokens at all → no judgment.
    expect(groundRecipeName("Pizza Dough Mix", known)).toEqual({ kind: "grounded" });
  });

  it("downgrades an ambiguous full-overlap tie to a flag instead of snapping", () => {
    // Both known names have the identical distinctive token set as the input
    // once filler is removed — snapping would pick one arbitrarily, so flag.
    const res = groundRecipeName("Marinara", ["Marinara Sauce", "Marinara Blend"]);
    expect(res.kind).toBe("flagged");
  });
});

describe("sanitizeParsedSpecImport — RECIPE NAME grounding", () => {
  const doughRecipe = (name: string) => ({
    kind: "dough",
    name,
    brand: "Aldo's",
    rows: [{ ingredient: "Flour", lbs: 50 }],
  });
  const grounding = {
    knownRecipeNames: { dough: ["Ultra Thin Dough", "Rising Crust Dough"] },
  };

  it("snaps a filler-only variant to the existing recipe name with a warning", () => {
    const out = sanitizeParsedSpecImport(
      { profiles: [], recipes: [doughRecipe("Ultra Thin Dough Recipe")] },
      {},
      grounding,
    );
    expect(out.recipes[0].name).toBe("Ultra Thin Dough");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatchObject({ brand: "Aldo's", flavor: "" });
    expect(out.warnings![0].message).toBe(
      'Matched dough recipe "Ultra Thin Dough Recipe" to existing "Ultra Thin Dough".',
    );
  });

  it("keeps a plausible near-duplicate but flags it with a structured warning", () => {
    const out = sanitizeParsedSpecImport(
      { profiles: [], recipes: [doughRecipe("Thin Crust Dough")] },
      {},
      grounding,
    );
    expect(out.recipes[0].name).toBe("Thin Crust Dough");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0].message).toBe(
      'New dough recipe "Thin Crust Dough" closely matches existing "Ultra Thin Dough" — verify it isn\'t a duplicate.',
    );
  });

  it("passes exact names and genuinely new recipes untouched, silently", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [doughRecipe("ultra thin dough"), doughRecipe("Sourdough Base")],
      },
      {},
      grounding,
    );
    expect(out.recipes.map((r) => r.name)).toEqual(["ultra thin dough", "Sourdough Base"]);
    expect(out.warnings).toBeUndefined();
  });

  it("only grounds against the recipe's OWN kind list", () => {
    // A sauce recipe must not snap/flag against known DOUGH names.
    const out = sanitizeParsedSpecImport(
      {
        profiles: [],
        recipes: [
          {
            kind: "sauce",
            name: "Ultra Thin Dough Recipe",
            rows: [{ ingredient: "Tomato Paste", lbs: 50 }],
          },
        ],
      },
      {},
      grounding,
    );
    expect(out.recipes[0].name).toBe("Ultra Thin Dough Recipe");
    expect(out.warnings).toBeUndefined();
  });

  it("makes no change when no grounding input is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [doughRecipe("Ultra Thin Dough Recipe")],
    });
    expect(out.recipes[0].name).toBe("Ultra Thin Dough Recipe");
    expect(out.warnings).toBeUndefined();
  });

  it("a snapped recipe counts as an UPDATE downstream, not a new recipe", () => {
    const out = sanitizeParsedSpecImport(
      { profiles: [], recipes: [doughRecipe("Ultra Thin Dough Recipe")] },
      {},
      grounding,
    );
    const summary = summarizeSpecImport(
      out,
      () => false,
      (kind, name) => kind === "dough" && name === "Ultra Thin Dough",
    );
    expect(summary.recipesUpdated).toBe(1);
    expect(summary.recipesNew).toBe(0);
  });
});

describe("isCatchAllFlavor", () => {
  it("flags whole-brand scope words, case-insensitively, for any kind", () => {
    for (const f of ["All Varieties", "all", "N/A", "every variety", "", "  "]) {
      expect(isCatchAllFlavor(f, "cheese")).toBe(true);
    }
  });
  it("flags the recipe's own kind as a placeholder for dough/sauce only", () => {
    expect(isCatchAllFlavor("Dough", "dough")).toBe(true);
    expect(isCatchAllFlavor("Sauce", "sauce")).toBe(true);
  });
  it("does NOT treat 'Cheese' as catch-all on a cheese recipe (it is a real flavor)", () => {
    expect(isCatchAllFlavor("Cheese", "cheese")).toBe(false);
    expect(isCatchAllFlavor("cheese", "cheese")).toBe(false);
  });
  it("does not flag a genuine flavor", () => {
    for (const f of ["Pepperoni", "Five Cheese", "Hawaiian", "BBQ Chicken", "Supreme"]) {
      expect(isCatchAllFlavor(f, "cheese")).toBe(false);
    }
  });
});

describe("recipeTargets", () => {
  it("unions the singular brand/flavor with targets[] and de-dupes case-insensitively", () => {
    expect(
      recipeTargets({
        kind: "dough",
        name: "X",
        rows: [],
        brand: "Tombstone",
        flavor: "Pepperoni",
        targets: [
          { brand: "tombstone", flavor: "pepperoni" }, // dup of singular
          { brand: "DiGiorno", flavor: "Supreme" },
        ],
      }),
    ).toEqual([
      { brand: "Tombstone", flavor: "Pepperoni" },
      { brand: "DiGiorno", flavor: "Supreme" },
    ]);
  });
  it("drops entries missing a brand or flavor, returns [] when none tie", () => {
    expect(recipeTargets({ kind: "sauce", name: "S", rows: [], brand: "OnlyBrand" })).toEqual([]);
    expect(
      recipeTargets({
        kind: "sauce",
        name: "S",
        rows: [],
        targets: [{ brand: " Brand ", flavor: " Flavor " }],
      }),
    ).toEqual([{ brand: "Brand", flavor: "Flavor" }]);
  });
});

describe("recipeApplyTargets", () => {
  const profiles = [
    { brand: "Lowes", flavor: "Pepperoni", applicators: [], pepperonis: [] },
    { brand: "Lowes", flavor: "Cheese", applicators: [], pepperonis: [] },
    { brand: "Lowes", flavor: "Pepperoni", applicators: [], pepperonis: [] }, // dup
    { brand: "DiGiorno", flavor: "Supreme", applicators: [], pepperonis: [] },
  ];

  it("uses explicit targets unchanged when present (no broadening)", () => {
    expect(
      recipeApplyTargets(
        {
          kind: "dough",
          name: "D",
          rows: [],
          brand: "Lowes",
          flavor: "Pepperoni",
        },
        profiles,
      ),
    ).toEqual([{ brand: "Lowes", flavor: "Pepperoni" }]);
  });

  it("positive: a brand-only recipe (empty explicit targets) links to all same-brand profiles, de-duped", () => {
    expect(
      recipeApplyTargets({ kind: "dough", name: "D", rows: [], brand: "lowes" }, profiles),
    ).toEqual([
      { brand: "Lowes", flavor: "Pepperoni" },
      { brand: "Lowes", flavor: "Cheese" },
    ]);
  });

  it("fans EVERY brandAnchor to its same-brand profiles (multi-brand shared recipe)", () => {
    expect(
      recipeApplyTargets(
        { kind: "dough", name: "Masa Dough", rows: [], brandAnchors: ["Lowes", "DiGiorno"] },
        profiles,
      ),
    ).toEqual([
      { brand: "Lowes", flavor: "Pepperoni" },
      { brand: "Lowes", flavor: "Cheese" },
      { brand: "DiGiorno", flavor: "Supreme" },
    ]);
  });

  it("appends brandAnchor fan-out to explicit per-flavor targets, de-duped", () => {
    expect(
      recipeApplyTargets(
        {
          kind: "cheese",
          name: "Mix",
          targets: [{ brand: "DiGiorno", flavor: "Supreme" }],
          brandAnchors: ["Lowes"],
        },
        profiles,
      ),
    ).toEqual([
      { brand: "DiGiorno", flavor: "Supreme" },
      { brand: "Lowes", flavor: "Pepperoni" },
      { brand: "Lowes", flavor: "Cheese" },
    ]);
  });

  it("negative: a recipe with no brand anchor links to nothing (never broadcast)", () => {
    expect(recipeApplyTargets({ kind: "sauce", name: "S", rows: [] }, profiles)).toEqual([]);
  });

  it("negative: a brand with no same-brand profile in the import links to nothing", () => {
    expect(
      recipeApplyTargets({ kind: "sauce", name: "S", rows: [], brand: "Unknown" }, profiles),
    ).toEqual([]);
  });
});

describe("summarizeSpecImport", () => {
  it("counts new vs updated for profiles and recipes", () => {
    const parsed = sanitizeParsedSpecImport({
      profiles: [
        { brand: "Tombstone", flavor: "Pepperoni", applicators: [], pepperonis: [] },
        { brand: "New", flavor: "Flavor", applicators: [], pepperonis: [] },
      ],
      recipes: [
        { kind: "dough", name: "Old Dough", rows: [{ ingredient: "Flour", lbs: 1 }] },
        { kind: "sauce", name: "New Sauce", rows: [{ ingredient: "Tomato", lbs: 1 }] },
      ],
    });
    const summary = summarizeSpecImport(
      parsed,
      (b, f) => b === "Tombstone" && f === "Pepperoni",
      (kind, name) => kind === "dough" && name === "Old Dough",
    );
    expect(summary).toEqual({
      profilesNew: 1,
      profilesUpdated: 1,
      recipesNew: 1,
      recipesUpdated: 1,
      totalProfiles: 2,
      totalRecipes: 2,
    });
  });
});

describe("mergeParsedSpecImports", () => {
  it("dedupes profiles by brand|flavor and recipes by kind|name with last-wins, joining notes", () => {
    const a = {
      profiles: [
        { brand: "Tombstone", flavor: "Pepperoni", applicators: [], pepperonis: [], note: "first" },
        { brand: "DiGiorno", flavor: "Supreme", applicators: [], pepperonis: [] },
      ],
      recipes: [
        { kind: "dough" as const, name: "Base Dough", rows: [{ ingredient: "Flour", lbs: 1 }] },
      ],
      note: "file A",
    };
    const b = {
      profiles: [
        // same brand+flavor (different case/spacing) → overrides a's entry
        { brand: " tombstone ", flavor: "PEPPERONI", applicators: [], pepperonis: [], note: "second" },
        { brand: "Newman", flavor: "Cheese", applicators: [], pepperonis: [] },
      ],
      recipes: [
        // same kind+name → overrides
        { kind: "dough" as const, name: "base dough", rows: [{ ingredient: "Flour", lbs: 2 }] },
        { kind: "sauce" as const, name: "Red Sauce", rows: [{ ingredient: "Tomato", lbs: 3 }] },
      ],
      note: "file B",
    };
    const merged = mergeParsedSpecImports([a, b]);
    expect(merged.profiles).toHaveLength(3);
    const tomb = merged.profiles.find(
      (p) => p.brand.trim().toLowerCase() === "tombstone" && p.flavor.toLowerCase() === "pepperoni",
    );
    expect(tomb?.note).toBe("second");
    expect(merged.recipes).toHaveLength(2);
    const dough = merged.recipes.find((r) => r.kind === "dough");
    expect(dough?.rows[0]?.lbs).toBe(2);
    expect(merged.note).toBe("file A\nfile B");
  });

  it("omits note when no inputs carry one", () => {
    const merged = mergeParsedSpecImports([{ profiles: [], recipes: [] }]);
    expect(merged.note).toBeUndefined();
    expect(merged.profiles).toEqual([]);
    expect(merged.recipes).toEqual([]);
  });
});

// Chunk-boundary safety: a big workbook is split into chunks and a product's
// spec block can span the split, so the same brand+flavor comes back from TWO
// chunks with PARTIAL applicator lists. profileSlots:"union" must keep every
// distinct weight instead of the default wholesale later-wins replace (which
// silently dropped the earlier chunk's applicators — the "import missed a
// weight" report).
describe("mergeParsedSpecImports (profileSlots: union — chunks of one workbook)", () => {
  const prof = (applicators: object[], pepperonis: object[] = []) => ({
    profiles: [{ brand: "Aldo's", flavor: "Cheese", applicators, pepperonis }],
    recipes: [],
  });
  const mergedApps = (a: object[], b: object[]) =>
    mergeParsedSpecImports(
      [prof(a) as never, prof(b) as never],
      { profileSlots: "union" },
    ).profiles[0]!.applicators;

  it("unions complementary applicator lists split across chunks", () => {
    const apps = mergedApps(
      [{ type: "Cheese Mix", ozPerPizza: 1.75 }],
      [{ type: "Bacon", ozPerPizza: 0.5 }],
    );
    expect(apps).toHaveLength(2);
    expect(apps.map((a) => a.ozPerPizza).sort()).toEqual([0.5, 1.75]);
  });

  it("keeps the SAME type at two DIFFERENT weights as two entries (two stations)", () => {
    const apps = mergedApps(
      [{ type: "Aldo's Cheese Mix", ozPerPizza: 1.75 }],
      [{ type: "Aldo's Cheese Mix", ozPerPizza: 2.07 }],
    );
    expect(apps).toHaveLength(2);
    expect(apps.map((a) => a.ozPerPizza).sort()).toEqual([1.75, 2.07]);
  });

  it("collapses identical re-emits, enriching slot/batchLbs from the re-emit", () => {
    const apps = mergedApps(
      [{ type: "Cheese Mix", ozPerPizza: 1.75 }],
      [{ type: "cheese mix", ozPerPizza: 1.75, slot: 3, batchLbs: 40 }],
    );
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ ozPerPizza: 1.75, slot: 3, batchLbs: 40 });
  });

  it("drops a 0-oz partial re-emit when the same type also carries a real weight", () => {
    const apps = mergedApps(
      [{ type: "Cheese Mix", ozPerPizza: 0 }],
      [{ type: "Cheese Mix", ozPerPizza: 1.75 }],
    );
    expect(apps).toHaveLength(1);
    expect(apps[0]!.ozPerPizza).toBe(1.75);
  });

  it("unions pepperonis the same way", () => {
    const a = prof([], [{ type: "Pepperoni", sticks: 12, ozPerPizza: 1.2 }]);
    const b = prof([], [
      { type: "Pepperoni", sticks: 12, ozPerPizza: 1.2 },
      { type: "Cheese Stick", sticks: 8, ozPerPizza: 0.9 },
    ]);
    const peps = mergeParsedSpecImports([a as never, b as never], { profileSlots: "union" })
      .profiles[0]!.pepperonis;
    expect(peps).toHaveLength(2);
    expect(peps.map((p) => p.type).sort()).toEqual(["Cheese Stick", "Pepperoni"]);
  });

  it("a >4-entry union still resolves deterministically through slot assignment (4-slot cap)", () => {
    const apps = mergedApps(
      [
        { type: "A", ozPerPizza: 1 },
        { type: "B", ozPerPizza: 2 },
        { type: "C", ozPerPizza: 3 },
      ],
      [
        { type: "D", ozPerPizza: 4 },
        { type: "E", ozPerPizza: 5 },
      ],
    );
    expect(apps).toHaveLength(5);
    const slotted = assignApplicatorSlots(apps).filter((a) => a.type.trim());
    expect(slotted).toHaveLength(4);
    expect(slotted.map((a) => a.type)).toEqual(["A", "B", "C", "D"]);
  });

  it("default mode still replaces wholesale (multi-file corrections)", () => {
    const apps = mergeParsedSpecImports([
      prof([{ type: "Cheese Mix", ozPerPizza: 1.5 }]) as never,
      prof([{ type: "Cheese Mix", ozPerPizza: 1.75 }]) as never,
    ]).profiles[0]!.applicators;
    expect(apps).toHaveLength(1);
    expect(apps[0]!.ozPerPizza).toBe(1.75);
  });
});

describe("SPEC_ALIAS_KINDS", () => {
  it("exposes the full kind set", () => {
    expect(SPEC_ALIAS_KINDS).toContain("brand");
    expect(SPEC_ALIAS_KINDS).toContain("cheeseIngredient");
    expect(new Set(SPEC_ALIAS_KINDS).size).toBe(SPEC_ALIAS_KINDS.length);
  });
});

describe("findTruncatedCells", () => {
  it("returns empty when every cell fits under the clamp", () => {
    const grids: SheetGrid[] = [{ name: "S1", rows: [["short", "also short"], ["ok"]] }];
    expect(findTruncatedCells(grids)).toEqual([]);
  });

  it("reports the sheet, 1-based row, kept preview, and cut length for oversized cells", () => {
    const long = "x".repeat(PROMPT_MAX_CELL_CHARS + 25);
    const grids: SheetGrid[] = [
      { name: "Specs", rows: [["fine"], ["fine", long], ["fine"]] },
    ];
    const found = findTruncatedCells(grids);
    expect(found).toHaveLength(1);
    expect(found[0].sheet).toBe("Specs");
    expect(found[0].row).toBe(2);
    expect(found[0].preview).toBe("x".repeat(PROMPT_MAX_CELL_CHARS));
    expect(found[0].cutChars).toBe(25);
  });

  it("mirrors the prompt path's whitespace collapse (a padded cell that cleans short is NOT truncated)", () => {
    // Raw length is way over the clamp, but the prompt path collapses runs of
    // whitespace first — detection must agree or it would cry wolf.
    const padded = `a${" ".repeat(200)}b`;
    const grids: SheetGrid[] = [{ name: "S1", rows: [[padded]] }];
    expect(findTruncatedCells(grids)).toEqual([]);
    // And a cell that stays long AFTER collapsing is still caught.
    const dense = Array.from({ length: PROMPT_MAX_CELL_CHARS }, (_, i) => `w${i}`).join(" ");
    expect(dense.replace(/\s+/g, " ").length).toBeGreaterThan(PROMPT_MAX_CELL_CHARS);
    expect(findTruncatedCells([{ name: "S1", rows: [[dense]] }])).toHaveLength(1);
  });

  it("ignores cells beyond the column cap (those are dropped, not truncated)", () => {
    const long = "y".repeat(PROMPT_MAX_CELL_CHARS + 5);
    const row = [...Array.from({ length: 60 }, () => "c"), long]; // col 61 > maxCols 60
    expect(findTruncatedCells([{ name: "S1", rows: [row] }])).toEqual([]);
  });

  it("respects a custom maxCellChars limit", () => {
    const grids: SheetGrid[] = [{ name: "S1", rows: [["abcdef"]] }];
    const found = findTruncatedCells(grids, { maxCellChars: 4 });
    expect(found).toHaveLength(1);
    expect(found[0].preview).toBe("abcd");
    expect(found[0].cutChars).toBe(2);
  });

  it("reports multiple truncated cells across sheets in order", () => {
    const long = "z".repeat(PROMPT_MAX_CELL_CHARS + 1);
    const grids: SheetGrid[] = [
      { name: "A", rows: [[long], ["ok"], [long, long]] },
      { name: "B", rows: [["ok"], [long]] },
    ];
    const found = findTruncatedCells(grids);
    expect(found.map((t) => `${t.sheet}:${t.row}`)).toEqual(["A:1", "A:3", "A:3", "B:2"]);
  });
});

describe("formatTruncatedCellsNote", () => {
  it("returns null when nothing was truncated", () => {
    expect(formatTruncatedCellsNote([])).toBeNull();
  });

  it("names the affected sheet/row in plain language for a single cell", () => {
    const note = formatTruncatedCellsNote([
      { sheet: "Specs", row: 4, preview: "…", cutChars: 12 },
    ]);
    expect(note).toBe(
      "1 cell was too long and was shortened before reading — double-check this row: Specs row 4.",
    );
  });

  it("dedupes repeated locations and collapses the overflow to +N more", () => {
    const cells = Array.from({ length: TRUNCATED_NOTE_MAX_LOCATIONS + 3 }, (_, i) => ({
      sheet: "S",
      row: i + 1,
      preview: "…",
      cutChars: 1,
    }));
    // Duplicate location (same sheet+row twice) must not be listed twice.
    const note = formatTruncatedCellsNote([...cells, { sheet: "S", row: 1, preview: "…", cutChars: 9 }]);
    expect(note).toContain(`${cells.length + 1} cells were too long`);
    expect(note).toContain("+3 more");
    expect(note?.match(/S row 1\b/g)).toHaveLength(1);
  });
});

describe("findOverflowColumnRows", () => {
  const wideRow = (cols: number, extra: string[]) => [
    ...Array.from({ length: cols }, () => "c"),
    ...extra,
  ];

  it("returns empty when no row exceeds the column cap", () => {
    const grids: SheetGrid[] = [
      { name: "S1", rows: [["a", "b"], Array.from({ length: 60 }, () => "x")] },
    ];
    expect(findOverflowColumnRows(grids)).toEqual([]);
  });

  it("reports the sheet, 1-based row, and dropped-cell count past the cap", () => {
    const grids: SheetGrid[] = [
      { name: "Specs", rows: [["fine"], wideRow(60, ["lost1", "lost2"]), ["fine"]] },
    ];
    const found = findOverflowColumnRows(grids);
    expect(found).toEqual([{ sheet: "Specs", row: 2, droppedCells: 2 }]);
  });

  it("ignores empty and whitespace-only cells past the cap (mirrors the prompt path's cleanup)", () => {
    const grids: SheetGrid[] = [
      { name: "S1", rows: [wideRow(60, ["", "   ", "\t \n"])] },
    ];
    expect(findOverflowColumnRows(grids)).toEqual([]);
    // But a row mixing blank and real overflow cells counts only the real ones.
    const mixed = findOverflowColumnRows([
      { name: "S1", rows: [wideRow(60, ["", "real", "  ", "also real"])] },
    ]);
    expect(mixed).toEqual([{ sheet: "S1", row: 1, droppedCells: 2 }]);
  });

  it("respects a custom maxCols limit", () => {
    const grids: SheetGrid[] = [{ name: "S1", rows: [["a", "b", "c"]] }];
    expect(findOverflowColumnRows(grids, { maxCols: 2 })).toEqual([
      { sheet: "S1", row: 1, droppedCells: 1 },
    ]);
    expect(findOverflowColumnRows(grids, { maxCols: 3 })).toEqual([]);
  });

  it("reports multiple overflowing rows across sheets in order", () => {
    const grids: SheetGrid[] = [
      { name: "A", rows: [wideRow(60, ["x"]), ["ok"], wideRow(60, ["y", "z"])] },
      { name: "B", rows: [["ok"], wideRow(60, ["w"])] },
    ];
    expect(findOverflowColumnRows(grids)).toEqual([
      { sheet: "A", row: 1, droppedCells: 1 },
      { sheet: "A", row: 3, droppedCells: 2 },
      { sheet: "B", row: 2, droppedCells: 1 },
    ]);
  });

  it("stays disjoint from findTruncatedCells (a long cell past the cap is overflow, not truncation)", () => {
    const long = "y".repeat(PROMPT_MAX_CELL_CHARS + 5);
    const grids: SheetGrid[] = [{ name: "S1", rows: [wideRow(60, [long])] }];
    expect(findTruncatedCells(grids)).toEqual([]);
    expect(findOverflowColumnRows(grids)).toEqual([{ sheet: "S1", row: 1, droppedCells: 1 }]);
  });
});

describe("formatOverflowColumnsNote", () => {
  it("returns null when nothing overflowed", () => {
    expect(formatOverflowColumnsNote([])).toBeNull();
  });

  it("names the affected sheet/row in plain language for a single dropped cell", () => {
    const note = formatOverflowColumnsNote([{ sheet: "Specs", row: 4, droppedCells: 1 }]);
    expect(note).toBe(
      "1 cell sits past column 60 and was not read at all — move that data into the first 60 columns and re-import, or double-check this row: Specs row 4.",
    );
  });

  it("sums dropped cells across rows and collapses excess locations to +N more", () => {
    const rows = Array.from({ length: TRUNCATED_NOTE_MAX_LOCATIONS + 3 }, (_, i) => ({
      sheet: "S",
      row: i + 1,
      droppedCells: 2,
    }));
    const note = formatOverflowColumnsNote(rows);
    expect(note).toContain(`${rows.length * 2} cells sit past column 60`);
    expect(note).toContain("were not read at all");
    expect(note).toContain("+3 more");
  });

  it("reflects a custom column cap in the wording", () => {
    const note = formatOverflowColumnsNote([{ sheet: "S", row: 1, droppedCells: 3 }], 10);
    expect(note).toContain("past column 10");
    expect(note).toContain("first 10 columns");
  });
});

describe("splitGridsForPrompt", () => {
  it("returns a single chunk for a small workbook and never truncates it", () => {
    const grids: SheetGrid[] = [{ name: "S1", rows: [["a", "b"], ["c"]] }];
    const { chunks, droppedRows } = splitGridsForPrompt(grids);
    expect(chunks).toHaveLength(1);
    expect(droppedRows).toBe(0);
    expect(gridsToPromptText(chunks[0])).not.toContain("… (truncated)");
  });

  it("splits one oversized sheet across chunks, each under the budget, losing no rows", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`row-${i}-${"x".repeat(30)}`]);
    const { chunks, droppedRows } = splitGridsForPrompt([{ name: "Big", rows }], { maxTotalChars: 200 }, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(droppedRows).toBe(0);
    // No chunk renders over the budget (so gridsToPromptText won't truncate it).
    for (const c of chunks) {
      expect(gridsToPromptText(c, { maxTotalChars: 200 })).not.toContain("… (truncated)");
    }
    // Every original row survives across the chunks (full ingestion).
    const seen = chunks.flatMap((c) => c.flatMap((s) => s.rows.map((r) => r[0])));
    expect(new Set(seen).size).toBe(40);
  });

  it("caps the number of chunks and reports the dropped rows precisely", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`row-${i}-${"x".repeat(30)}`]);
    const { chunks, droppedRows } = splitGridsForPrompt([{ name: "Big", rows }], { maxTotalChars: 200 }, 2);
    expect(chunks).toHaveLength(2);
    const kept = chunks.flatMap((c) => c.flatMap((s) => s.rows.length));
    const keptRows = kept.reduce((a, b) => a + b, 0);
    expect(keptRows + droppedRows).toBe(40);
    expect(droppedRows).toBeGreaterThan(0);
  });

  it("keeps each chunk within the per-call sheet cap", () => {
    const grids: SheetGrid[] = Array.from({ length: 5 }, (_, i) => ({
      name: `S${i}`,
      rows: [["x"]],
    }));
    const { chunks } = splitGridsForPrompt(grids, { maxSheets: 2 });
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2);
  });

  // Build an exporter-style recipe sheet: N blocks of
  //   Recipe: <name> / Brand: flavor / Ingredient|Lbs / <rows…>
  const recipeSheet = (nBlocks: number, rowsPerBlock: number): SheetGrid => {
    const rows: string[][] = [];
    for (let b = 0; b < nBlocks; b++) {
      rows.push([`Recipe: Blend ${b}`]);
      rows.push([`Brand ${b}: Cheese, Pepperoni`]);
      rows.push(["Ingredient", "Lbs"]);
      for (let r = 0; r < rowsPerBlock; r++) rows.push([`Ingredient ${b}-${r}`, String(r + 1)]);
    }
    return { name: "Cheese Recipes", rows };
  };

  it("never splits a 'Recipe:' block across chunks (block-atomic chunking)", () => {
    const sheet = recipeSheet(12, 6);
    const { chunks, droppedRows } = splitGridsForPrompt([sheet], { maxTotalChars: 400 }, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(droppedRows).toBe(0);
    // Each chunk's slice of the sheet starts at a block header, and every
    // block's rows live in exactly one chunk (header + targets + all rows).
    const byBlock = new Map<string, Set<number>>();
    for (const [ci, c] of chunks.entries()) {
      for (const s of c) {
        expect(s.rows[0][0]).toMatch(/^Recipe:/);
        let current = "";
        for (const row of s.rows) {
          if (/^Recipe:/.test(row[0])) current = row[0];
          const set = byBlock.get(current) ?? new Set<number>();
          set.add(ci);
          byBlock.set(current, set);
        }
      }
    }
    expect(byBlock.size).toBe(12);
    for (const [, set] of byBlock) expect(set.size).toBe(1);
    // No rows lost overall.
    const total = chunks.flatMap((c) => c.flatMap((s) => s.rows)).length;
    expect(total).toBe(sheet.rows.length);
  });

  it("still splits a single block bigger than a whole chunk (forward progress)", () => {
    const sheet = recipeSheet(1, 40);
    const { chunks, droppedRows } = splitGridsForPrompt([sheet], { maxTotalChars: 200 }, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(droppedRows).toBe(0);
    const total = chunks.flatMap((c) => c.flatMap((s) => s.rows)).length;
    expect(total).toBe(sheet.rows.length);
  });

  it("keeps blocks atomic when the sheet follows other sheets in the chunk", () => {
    const filler: SheetGrid = {
      name: "Profiles",
      rows: Array.from({ length: 10 }, (_, i) => [`profile-row-${i}-${"x".repeat(20)}`]),
    };
    const { chunks, droppedRows } = splitGridsForPrompt(
      [filler, recipeSheet(8, 5)],
      { maxTotalChars: 500 },
      50,
    );
    expect(droppedRows).toBe(0);
    for (const c of chunks) {
      for (const s of c) {
        if (s.name !== "Cheese Recipes") continue;
        expect(s.rows[0][0]).toMatch(/^Recipe:/);
      }
    }
  });
});

describe("applyNameMatches", () => {
  const base = (): ParsedSpecImport => ({
    profiles: [
      { brand: "Tombstn", flavor: "Pep", dieType: "", sauceOzPerPizza: 3, applicators: [], pepperonis: [] },
    ],
    recipes: [
      {
        kind: "dough",
        name: "Std",
        rows: [{ ingredient: "Flour", lbs: 1 }],
        brand: "Tombstn",
        flavor: "Pep",
        targets: [{ brand: "Tombstn", flavor: "Pep" }, { brand: "Keep", flavor: "As-Is" }],
      },
    ],
  });

  it("renames brands then brand-scoped flavors across profiles, recipe, and targets", () => {
    const out = applyNameMatches(
      base(),
      [{ candidate: "Tombstn", match: "Tombstone" }],
      [{ brand: "Tombstone", candidate: "Pep", match: "Pepperoni" }],
    );
    expect(out.parsed.profiles[0]).toMatchObject({ brand: "Tombstone", flavor: "Pepperoni" });
    const r = out.parsed.recipes[0];
    expect(r.brand).toBe("Tombstone");
    expect(r.flavor).toBe("Pepperoni");
    expect(r.targets).toEqual([
      { brand: "Tombstone", flavor: "Pepperoni" },
      { brand: "Keep", flavor: "As-Is" },
    ]);
  });

  it("emits learnable alias pairs and skips self-references", () => {
    const out = applyNameMatches(
      base(),
      [
        { candidate: "Tombstn", match: "Tombstone" },
        { candidate: "Same", match: "Same" }, // self-ref → dropped
      ],
      [{ brand: "Tombstone", candidate: "Pep", match: "Pepperoni" }],
    );
    expect(out.aliases).toHaveLength(2);
    expect(out.aliases.find((a) => a.kind === "brand")?.canonicalName).toBe("Tombstone");
    const flavor = out.aliases.find((a) => a.kind === "flavor");
    expect(flavor).toMatchObject({ canonicalName: "Pepperoni", context: "Tombstone" });
  });

  it("leaves the parse untouched when there are no matches", () => {
    const out = applyNameMatches(base(), [], []);
    expect(out.parsed.profiles[0].brand).toBe("Tombstn");
    expect(out.aliases).toEqual([]);
  });

  it("applies kind-scoped ingredient + applicator/pepperoni matches and records aliases", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        {
          brand: "Tombstone",
          flavor: "Pepperoni",
          dieType: "",
          applicators: [{ type: "Mozz", lbs: 1 }],
          pepperonis: [{ type: "Pep Cup", count: 30 }],
        },
      ],
      recipes: [
        { kind: "dough", name: "D", rows: [{ ingredient: "Bread Flr", lbs: 1 }] },
        { kind: "sauce", name: "S", rows: [{ ingredient: "Tom Paste", lbs: 2 }] },
      ],
    };
    const out = applyNameMatches(parsed, [], [], {
      ingredientMatches: [
        { kind: "dough", candidate: "Bread Flr", match: "Bread Flour" },
        { kind: "sauce", candidate: "Tom Paste", match: "Tomato Paste" },
      ],
      appTypeMatches: [{ candidate: "Mozz", match: "Mozzarella" }],
      pepTypeMatches: [{ candidate: "Pep Cup", match: "Pepperoni Cup" }],
    });
    expect(out.parsed.recipes[0].rows[0].ingredient).toBe("Bread Flour");
    expect(out.parsed.recipes[1].rows[0].ingredient).toBe("Tomato Paste");
    expect(out.parsed.profiles[0].applicators[0].type).toBe("Mozzarella");
    expect(out.parsed.profiles[0].pepperonis[0].type).toBe("Pepperoni Cup");
    expect(out.aliases.find((a) => a.kind === "doughIngredient")?.canonicalName).toBe("Bread Flour");
    expect(out.aliases.find((a) => a.kind === "sauceIngredient")?.canonicalName).toBe("Tomato Paste");
    expect(out.aliases.find((a) => a.kind === "appType")?.canonicalName).toBe("Mozzarella");
    expect(out.aliases.find((a) => a.kind === "pepType")?.canonicalName).toBe("Pepperoni Cup");
  });

  it("does NOT rename an ingredient match under a different recipe kind", () => {
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [{ kind: "cheese", name: "C", rows: [{ ingredient: "Bread Flr", lbs: 1 }] }],
    };
    const out = applyNameMatches(parsed, [], [], {
      ingredientMatches: [{ kind: "dough", candidate: "Bread Flr", match: "Bread Flour" }],
    });
    expect(out.parsed.recipes[0].rows[0].ingredient).toBe("Bread Flr");
  });
});

describe("collectMatchCandidates", () => {
  const known: SpecMatchKnown = {
    brands: ["Tombstone"],
    flavorsByBrand: { Tombstone: ["Pepperoni"] },
    doughIngredients: ["Bread Flour"],
    sauceIngredients: ["Tomato Paste"],
    cheeseIngredients: ["Mozzarella"],
    appTypes: ["Mozzarella"],
    pepTypes: ["Pepperoni Cup"],
  };

  it("collects only names absent from the known lists", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        {
          brand: "Newco",
          flavor: "Spicy",
          dieType: "",
          applicators: [{ type: "Mozz", lbs: 1 }, { type: "Mozzarella", lbs: 1 }],
          pepperonis: [{ type: "Pep Cup", count: 1 }],
        },
        // Flavor under a KNOWN brand that isn't saved yet → collected.
        { brand: "Tombstone", flavor: "Sausage", dieType: "", applicators: [], pepperonis: [] },
        // Flavor under a known brand that IS saved → not collected.
        { brand: "Tombstone", flavor: "Pepperoni", dieType: "", applicators: [], pepperonis: [] },
      ],
      recipes: [
        { kind: "dough", name: "D", rows: [{ ingredient: "Bread Flr", lbs: 1 }, { ingredient: "Bread Flour", lbs: 1 }] },
      ],
    };
    const c = collectMatchCandidates(parsed, known);
    expect(c.brands).toEqual(["Newco"]);
    // "Spicy" is under a NEW brand → not collected (matcher scopes flavors to a known brand).
    expect(c.flavors).toEqual([{ brand: "Tombstone", flavor: "Sausage" }]);
    expect(c.ingredients).toEqual([{ kind: "dough", name: "Bread Flr" }]);
    expect(c.appTypes).toEqual(["Mozz"]);
    expect(c.pepTypes).toEqual(["Pep Cup"]);
  });

  it("dedupes case-insensitively and returns empty arrays when everything is known", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        { brand: "newco", flavor: "x", dieType: "", applicators: [], pepperonis: [] },
        { brand: "NEWCO", flavor: "x", dieType: "", applicators: [], pepperonis: [] },
      ],
      recipes: [],
    };
    const c = collectMatchCandidates(parsed, known);
    expect(c.brands).toHaveLength(1);

    const allKnown: ParsedSpecImport = {
      profiles: [
        { brand: "Tombstone", flavor: "Pepperoni", dieType: "", applicators: [{ type: "Mozzarella", lbs: 1 }], pepperonis: [{ type: "Pepperoni Cup", count: 1 }] },
      ],
      recipes: [{ kind: "dough", name: "D", rows: [{ ingredient: "Bread Flour", lbs: 1 }] }],
    };
    const c2 = collectMatchCandidates(allKnown, known);
    expect(c2.brands).toEqual([]);
    expect(c2.flavors).toEqual([]);
    expect(c2.ingredients).toEqual([]);
    expect(c2.appTypes).toEqual([]);
    expect(c2.pepTypes).toEqual([]);
  });
});

describe("crossFillSpecImport", () => {
  const mk = (over: Partial<ParsedSpecImport["profiles"][number]>) => ({
    brand: "Lowes 7in",
    flavor: "X",
    dieType: "",
    applicators: [],
    pepperonis: [],
    ...over,
  });

  it("fills a blank dieType from same-brand siblings when they agree", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        mk({ flavor: "Pepperoni", dieType: "7in Die" }),
        mk({ flavor: "Cheese", dieType: "" }),
      ],
      recipes: [],
    };
    const { parsed: out, filledCount } = crossFillSpecImport(parsed);
    expect(out.profiles[1].dieType).toBe("7in Die");
    expect(filledCount).toBe(1);
  });

  it("does NOT fill when same-brand siblings disagree (ambiguous)", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        mk({ flavor: "A", dieType: "7in Die" }),
        mk({ flavor: "B", dieType: "Other Die" }),
        mk({ flavor: "C", dieType: "" }),
      ],
      recipes: [],
    };
    const { parsed: out, filledCount } = crossFillSpecImport(parsed);
    expect(out.profiles[2].dieType).toBe("");
    expect(filledCount).toBe(0);
  });

  it("never overrides an existing value and does not cross different brands", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        mk({ brand: "Lowes 7in", flavor: "A", dieType: "7in Die" }),
        mk({ brand: "Lowes 11in", flavor: "B", dieType: "" }), // different brand → untouched
        mk({ brand: "Lowes 7in", flavor: "C", dieType: "Keep Me" }), // existing → untouched
      ],
      recipes: [],
    };
    const { parsed: out, filledCount } = crossFillSpecImport(parsed);
    expect(out.profiles[1].dieType).toBe("");
    expect(out.profiles[2].dieType).toBe("Keep Me");
    expect(filledCount).toBe(0);
  });

  it("fills a blank sauceOzPerPizza (including 0) from agreeing siblings", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        mk({ flavor: "A", sauceOzPerPizza: 0 }),
        mk({ flavor: "B" }),
      ],
      recipes: [],
    };
    const { parsed: out, filledCount } = crossFillSpecImport(parsed);
    expect(out.profiles[1].sauceOzPerPizza).toBe(0);
    expect(filledCount).toBe(1);
  });
});

describe("mergeParsedSpecImports (nameless recipes)", () => {
  it("does not collapse several nameless recipes of the same kind", () => {
    const a: ParsedSpecImport = {
      profiles: [],
      recipes: [{ kind: "sauce", name: "", rows: [{ ingredient: "Tomato", lbs: 10 }] }],
    };
    const b: ParsedSpecImport = {
      profiles: [],
      recipes: [{ kind: "sauce", name: "", rows: [{ ingredient: "Basil", lbs: 2 }] }],
    };
    const out = mergeParsedSpecImports([a, b]);
    expect(out.recipes).toHaveLength(2);
  });
  it("still de-dupes named recipes by kind+name (later wins)", () => {
    const a: ParsedSpecImport = {
      profiles: [],
      recipes: [{ kind: "dough", name: "Std", rows: [{ ingredient: "Flour", lbs: 10 }] }],
    };
    const b: ParsedSpecImport = {
      profiles: [],
      recipes: [{ kind: "dough", name: "std", rows: [{ ingredient: "Flour", lbs: 20 }] }],
    };
    const out = mergeParsedSpecImports([a, b]);
    expect(out.recipes).toHaveLength(1);
    expect(out.recipes[0].rows[0].lbs).toBe(20);
  });
});

describe("partitionTombstonedParse", () => {
  const parsed: ParsedSpecImport = {
    profiles: [
      { brand: "Basha's", flavor: "Cheese", applicators: [], pepperonis: [] },
      { brand: "Gone", flavor: "Pepperoni", applicators: [], pepperonis: [] },
    ],
    recipes: [
      { kind: "sauce", name: "House Sauce", rows: [{ ingredient: "Tomato", lbs: 10 }] },
      { kind: "cheese", name: "Old Blend", rows: [{ ingredient: "Mozz", lbs: 5 }] },
      { kind: "dough", name: "", rows: [{ ingredient: "Flour", lbs: 50 }] },
    ],
    note: "hi",
  };
  it("splits merged-away profiles and recipes into skipped, preserving the note", () => {
    const { kept, skipped } = partitionTombstonedParse(
      parsed,
      (brand) => brand === "Gone",
      (kind, name) => kind === "cheese" && name === "Old Blend",
    );
    expect(kept.profiles.map((p) => p.brand)).toEqual(["Basha's"]);
    expect(kept.recipes.map((r) => r.name)).toEqual(["House Sauce", ""]);
    expect(skipped.profiles.map((p) => p.brand)).toEqual(["Gone"]);
    expect(skipped.recipes.map((r) => r.name)).toEqual(["Old Blend"]);
    expect(kept.note).toBe("hi");
  });
  it("never treats a blank-name recipe as tombstoned", () => {
    const { kept, skipped } = partitionTombstonedParse(
      parsed,
      () => false,
      () => true, // predicate would tombstone everything...
    );
    // ...but the blank-name dough is exempt so it can be rescued in review.
    expect(kept.recipes.map((r) => r.name)).toEqual([""]);
    expect(skipped.recipes).toHaveLength(2);
  });
});

describe("recipeApplyIssue / profileApplyIssue", () => {
  it("flags missing name then missing rows", () => {
    expect(recipeApplyIssue({ kind: "sauce", name: "", rows: [{ ingredient: "T", lbs: 1 }] })).toBe(
      "missing-name",
    );
    expect(recipeApplyIssue({ kind: "sauce", name: "S", rows: [] })).toBe("no-rows");
    expect(recipeApplyIssue({ kind: "sauce", name: "S", rows: [{ ingredient: "T", lbs: 1 }] })).toBeNull();
  });
  it("flags missing brand then missing flavor", () => {
    expect(profileApplyIssue({ brand: "", flavor: "X", applicators: [], pepperonis: [] })).toBe(
      "missing-brand",
    );
    expect(profileApplyIssue({ brand: "B", flavor: "", applicators: [], pepperonis: [] })).toBe(
      "missing-flavor",
    );
    expect(profileApplyIssue({ brand: "B", flavor: "F", applicators: [], pepperonis: [] })).toBeNull();
  });
});

describe("AI parse-pass retry rule", () => {
  const bigChunk = "x".repeat(RETRY_MIN_CHUNK_CHARS);
  const tinyChunk = "x".repeat(RETRY_MIN_CHUNK_CHARS - 1);
  const emptyPass = { profiles: [], recipes: [] };
  const notedPass = { profiles: [], recipes: [], note: "response was cut off" };
  const goodPass = { profiles: [{ brand: "B" }], recipes: [] };
  const notedButPartialPass = {
    profiles: [{ brand: "B" }],
    recipes: [],
    note: "sheet 2 unreadable",
  };

  describe("isFailedParsePass", () => {
    it("treats an empty parse (no profiles, no recipes) as failed", () => {
      expect(isFailedParsePass(emptyPass)).toBe(true);
    });
    it("treats empty + note as failed", () => {
      expect(isFailedParsePass(notedPass)).toBe(true);
    });
    it("treats a parse WITH results but a failure note as failed", () => {
      expect(isFailedParsePass(notedButPartialPass)).toBe(true);
    });
    it("treats a parse with results and no note as usable", () => {
      expect(isFailedParsePass(goodPass)).toBe(false);
      expect(isFailedParsePass({ profiles: [], recipes: [{ kind: "dough" }] })).toBe(false);
    });
  });

  describe("shouldRetryParsePass", () => {
    it("retries an empty+note pass on a non-trivial chunk", () => {
      expect(shouldRetryParsePass(notedPass, bigChunk)).toBe(true);
      expect(shouldRetryParsePass(emptyPass, bigChunk)).toBe(true);
    });
    it("never retries a tiny chunk, even when the pass failed", () => {
      expect(shouldRetryParsePass(notedPass, tinyChunk)).toBe(false);
      expect(shouldRetryParsePass(emptyPass, "")).toBe(false);
    });
    it("never retries a successful pass, regardless of chunk size", () => {
      expect(shouldRetryParsePass(goodPass, bigChunk)).toBe(false);
      expect(shouldRetryParsePass(goodPass, tinyChunk)).toBe(false);
    });
    it("retries exactly at the threshold boundary", () => {
      expect(bigChunk.length).toBe(RETRY_MIN_CHUNK_CHARS);
      expect(shouldRetryParsePass(notedPass, bigChunk)).toBe(true);
      expect(shouldRetryParsePass(notedPass, tinyChunk)).toBe(false);
    });
  });

  describe("resolveRetriedParsePass", () => {
    it("a successful retry replaces the failed pass", () => {
      expect(resolveRetriedParsePass(notedPass, goodPass)).toBe(goodPass);
    });
    it("a failed retry keeps the original noted result (note still surfaces)", () => {
      expect(resolveRetriedParsePass(notedPass, emptyPass)).toBe(notedPass);
      const retryWithNote = { profiles: [], recipes: [], note: "cut off again" };
      expect(resolveRetriedParsePass(notedPass, retryWithNote)).toBe(notedPass);
    });
    it("a retry that returns results but carries a failure note is still rejected", () => {
      expect(resolveRetriedParsePass(notedPass, notedButPartialPass)).toBe(notedPass);
    });
  });
});

describe("embedded applicator blends (deterministic unpack)", () => {
  const ALDOS = "Aldo's Cheese Mix 1.75 Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan";
  const FAJITA =
    "White Fajita Mix (0.375 Red Pepper Strips Blanched, 0.375 Green Pepper Strips, 0.25 Onion Strips)";

  describe("parseEmbeddedBlend", () => {
    it("extracts name and number+ingredient rows", () => {
      const b = parseEmbeddedBlend(ALDOS);
      expect(b?.name).toBe("Aldo's Cheese Mix");
      expect(b?.rows).toEqual([
        { ingredient: "Pizella", lbs: 1.75 },
        { ingredient: "Part Skim Mozzarella", lbs: 1.0 },
        { ingredient: "Grated Parmesan", lbs: 0.1 },
      ]);
    });
    it("handles parenthesized compositions (name kept clean of the paren)", () => {
      const b = parseEmbeddedBlend(FAJITA);
      expect(b?.name).toBe("White Fajita Mix");
      expect(b?.rows.length).toBe(3);
      expect(b?.rows[0]).toEqual({ ingredient: "Red Pepper Strips Blanched", lbs: 0.375 });
    });
    it("leaves plain types and supplier codes alone", () => {
      expect(parseEmbeddedBlend("Pepperoni")).toBeNull();
      expect(parseEmbeddedBlend("Diced Pepperoni (Sugardale - 02032)")).toBeNull();
      expect(parseEmbeddedBlend("Bacon (Tri Meats - TM3514U or C&F - 001ANUB40)")).toBeNull();
      // Single pair never qualifies (sizes, one-off numbers).
      expect(parseEmbeddedBlend("Lowes 7in Crust")).toBeNull();
      // Big numbers are product codes, not lbs parts.
      expect(parseEmbeddedBlend("Chicken Diced House of Raeford 28501 or 28502 something")).toBeNull();
    });
    it("survives a truncated trailing pair", () => {
      const b = parseEmbeddedBlend("Basha's Cheese Mix 2.0 Whole Milk Mozzarella, 1.0 Provolone, 0.");
      expect(b?.name).toBe("Basha's Cheese Mix");
      expect(b?.rows.length).toBe(2);
    });
  });

  describe("extractEmbeddedApplicatorBlends", () => {
    const prof = (apps: string[]): ParsedSpecImport["profiles"][number] => ({
      brand: "B",
      flavor: apps[0] ?? "F",
      applicators: apps.map((type) => ({ type, ozPerPizza: 5 })),
      pepperonis: [],
    });

    it("cleans the applicator type and emits ONE cheese recipe shared across profiles", () => {
      const out = extractEmbeddedApplicatorBlends({
        profiles: [
          { ...prof([ALDOS]), flavor: "Cheese" },
          { ...prof([ALDOS]), flavor: "Pepperoni" },
        ],
        recipes: [],
      });
      expect(out.profiles.map((p) => p.applicators[0].type)).toEqual([
        "Aldo's Cheese Mix",
        "Aldo's Cheese Mix",
      ]);
      const cheese = out.recipes.filter((r) => r.kind === "cheese");
      expect(cheese.length).toBe(1);
      expect(cheese[0].name).toBe("Aldo's Cheese Mix");
      expect(cheese[0].rows.length).toBe(3);
    });

    it("reuses an AI-emitted recipe of the same clean name instead of duplicating", () => {
      const out = extractEmbeddedApplicatorBlends({
        profiles: [prof([ALDOS])],
        recipes: [
          { kind: "cheese", name: "Aldo's Cheese Mix", rows: [{ ingredient: "Pizella", lbs: 2 }] },
        ],
      });
      expect(out.profiles[0].applicators[0].type).toBe("Aldo's Cheese Mix");
      expect(out.recipes.filter((r) => r.kind === "cheese").length).toBe(1);
      expect(out.recipes[0].rows).toEqual([{ ingredient: "Pizella", lbs: 2 }]);
    });

    it("collapses the SAME named mix applied at different per-pizza weights to ONE recipe", () => {
      // Real spec sheets express cheese as per-pizza ounces, so one named blend
      // legitimately shows different component amounts across pizzas. It must
      // stay a single pool recipe (first composition wins), never split in two.
      const heavier = "Aldo's Cheese Mix 2.07 Pizella, 1.19 Part Skim Mozzarella, 0.26 Grated Parmesan";
      const out = extractEmbeddedApplicatorBlends({
        profiles: [{ ...prof([heavier]), flavor: "Cheese" }, { ...prof([ALDOS]), flavor: "Deluxe" }],
        recipes: [],
      });
      const cheese = out.recipes.filter((r) => r.kind === "cheese");
      expect(cheese.length).toBe(1);
      expect(cheese[0].name).toBe("Aldo's Cheese Mix");
      // First composition seen wins.
      expect(cheese[0].rows.find((r) => /pizella/i.test(r.ingredient))?.lbs).toBe(2.07);
      expect(out.profiles.map((p) => p.applicators[0].type)).toEqual([
        "Aldo's Cheese Mix",
        "Aldo's Cheese Mix",
      ]);
    });

    it("collapses a same-named blend even when the ingredients differ (name is the identity)", () => {
      const a = "House Blend Mix 1.0 Mozzarella, 0.5 Provolone";
      const b = "House Blend Mix 1.0 Cheddar, 0.5 Monterey Jack";
      const out = extractEmbeddedApplicatorBlends({
        profiles: [prof([a]), { ...prof([b]), flavor: "Other" }],
        recipes: [],
      });
      const cheese = out.recipes.filter((r) => r.kind === "cheese");
      expect(cheese.length).toBe(1);
      expect(cheese[0].name).toBe("House Blend Mix");
      expect(out.profiles[0].applicators[0].type).toBe(out.profiles[1].applicators[0].type);
    });

    it("collapses same-named blends across chunks when extraction runs AFTER the raw merge", () => {
      // Two chunks of one workbook, same base name, different per-pizza amounts —
      // the real import path merges raw chunks first, then extracts once.
      const chunkA: ParsedSpecImport = {
        profiles: [{ ...prof([ALDOS]), flavor: "Cheese" }],
        recipes: [],
      };
      const chunkB: ParsedSpecImport = {
        profiles: [
          { ...prof(["Aldo's Cheese Mix 2.0 Pizella, 0.5 Part Skim Mozzarella"]), flavor: "Deluxe" },
        ],
        recipes: [],
      };
      const out = extractEmbeddedApplicatorBlends(mergeParsedSpecImports([chunkA, chunkB]));
      const cheese = out.recipes.filter((r) => r.kind === "cheese");
      expect(cheese.length).toBe(1);
      expect(cheese[0].name).toBe("Aldo's Cheese Mix");
      const typeByFlavor = new Map(out.profiles.map((p) => [p.flavor, p.applicators[0].type]));
      expect(typeByFlavor.get("Cheese")).toBe("Aldo's Cheese Mix");
      expect(typeByFlavor.get("Deluxe")).toBe("Aldo's Cheese Mix");
    });

    it("leaves plain applicator types and existing recipes untouched", () => {
      const input: ParsedSpecImport = {
        profiles: [prof(["Pepperoni", "Diced Pepperoni (Sugardale - 02032)"])],
        recipes: [{ kind: "dough", name: "Thin", rows: [] }],
      };
      const out = extractEmbeddedApplicatorBlends(input);
      expect(out.profiles[0].applicators.map((a) => a.type)).toEqual([
        "Pepperoni",
        "Diced Pepperoni (Sugardale - 02032)",
      ]);
      expect(out.recipes).toEqual(input.recipes);
    });
  });
});
