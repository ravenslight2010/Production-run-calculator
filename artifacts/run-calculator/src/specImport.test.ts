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
  sanitizeParsedSpecImport,
  summarizeSpecImport,
  mergeParsedSpecImports,
  partitionTombstonedParse,
  recipeApplyIssue,
  profileApplyIssue,
  isFailedParsePass,
  shouldRetryParsePass,
  resolveRetriedParsePass,
  RETRY_MIN_CHUNK_CHARS,
  SPEC_ALIAS_KINDS,
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
      { kind: "brand", result: mk("fuzzy", "Tombstoen", "Tombstone") },
      { kind: "brand", result: mk("exact", "tombstone", "Tombstone") }, // case-only → skipped
      { kind: "brand", result: mk("new", "Totino's", "Totino's") }, // new → skipped
      { kind: "flavor", result: mk("alias", "Pep", "Pepperoni"), context: "Tombstone" },
    ]);
    // fuzzy(differs) + alias(differs) = 2; case-only and new are skipped
    expect(out).toHaveLength(2);
    const fuzzy = out.find((a) => a.externalName === "Tombstoen");
    expect(fuzzy?.canonicalName).toBe("Tombstone");
    const flavor = out.find((a) => a.kind === "flavor");
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
      { kind: "brand", result: mk("fuzzy", "Tmb", "Tombstone") },
      { kind: "brand", result: mk("fuzzy", "tmb", "DiGiorno") },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].canonicalName).toBe("DiGiorno");
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
    expect(out.note).toContain('Corrected flavor "BBQ Chicken" to "Buffalo Chicken"');
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
  });

  it("is case/punctuation-insensitive when checking the sheet for the flavor", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "Buffalo-Chicken" }],
        recipes: [],
      },
      {},
      { sourceText: "BUFFALO   CHICKEN\t2.5\t4\n" },
    );
    expect(out.profiles[0].flavor).toBe("Buffalo-Chicken");
    expect(out.note).toBeUndefined();
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
    expect(out.note).toContain('Flavor "Mission Taco Mexican" (brand Aldo\'s) was not found');
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
    expect(out.note).toBeTruthy(); // corrected or flagged — never silent
  });

  it("leaves profiles untouched when no grounding is supplied (back-compat)", () => {
    const out = sanitizeParsedSpecImport({
      profiles: [{ brand: "Aldo's", flavor: "Totally Invented Flavor" }],
      recipes: [],
    });
    expect(out.profiles[0].flavor).toBe("Totally Invented Flavor");
    expect(out.note).toBeUndefined();
  });

  it("appends the flavor warnings after an existing model note", () => {
    const out = sanitizeParsedSpecImport(
      {
        profiles: [{ brand: "Aldo's", flavor: "BBQ Chicken" }],
        recipes: [],
        note: "Could not parse the second sheet.",
      },
      {},
      { sourceText: workbook },
    );
    expect(out.note).toContain("Could not parse the second sheet.");
    expect(out.note).toContain('Corrected flavor "BBQ Chicken" to "Buffalo Chicken"');
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

describe("SPEC_ALIAS_KINDS", () => {
  it("exposes the full kind set", () => {
    expect(SPEC_ALIAS_KINDS).toContain("brand");
    expect(SPEC_ALIAS_KINDS).toContain("cheeseIngredient");
    expect(new Set(SPEC_ALIAS_KINDS).size).toBe(SPEC_ALIAS_KINDS.length);
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
