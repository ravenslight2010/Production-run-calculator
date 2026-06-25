import { describe, it, expect } from "vitest";
import {
  specAliasKey,
  pickAlias,
  canonicalize,
  collectSpecAliases,
  gridsToPromptText,
  splitGridsForPrompt,
  applyNameMatches,
  collectMatchCandidates,
  crossFillSpecImport,
  recipeTargets,
  sanitizeParsedSpecImport,
  summarizeSpecImport,
  mergeParsedSpecImports,
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
