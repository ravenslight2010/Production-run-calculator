import { describe, it, expect } from "vitest";
import {
  specAliasKey,
  pickAlias,
  canonicalize,
  collectSpecAliases,
  gridsToPromptText,
  recipeTargets,
  sanitizeParsedSpecImport,
  summarizeSpecImport,
  SPEC_ALIAS_KINDS,
  type SpecImportAlias,
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

describe("SPEC_ALIAS_KINDS", () => {
  it("exposes the full kind set", () => {
    expect(SPEC_ALIAS_KINDS).toContain("brand");
    expect(SPEC_ALIAS_KINDS).toContain("cheeseIngredient");
    expect(new Set(SPEC_ALIAS_KINDS).size).toBe(SPEC_ALIAS_KINDS.length);
  });
});
