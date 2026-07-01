import { describe, it, expect } from "vitest";
import {
  validateMatchImportBody,
  sanitizeMatchImport,
  conflictingProductLine,
  type MatchImportInput,
} from "./aiMatchImport";

function input(overrides: Partial<MatchImportInput> = {}): MatchImportInput {
  return {
    brands: ["Acme"],
    brandFlavors: { Acme: ["Pepperoni"] },
    unmatchedBrands: ["Akme"],
    unmatchedFlavors: [{ brand: "Acme", flavor: "Peperoni" }],
    knownIngredients: { dough: ["Flour"], sauce: ["Tomato Base"], cheese: ["Mozzarella"] },
    knownAppTypes: ["Spreader"],
    knownPepTypes: ["Cup & Char"],
    unmatchedIngredients: [{ kind: "dough", name: "Floor" }],
    unmatchedAppTypes: ["Spredr"],
    unmatchedPepTypes: ["Cup Char"],
    ...overrides,
  } as MatchImportInput;
}

describe("validateMatchImportBody contract", () => {
  it("accepts knownIngredients keyed by recipe kind (the client shape)", () => {
    const r = validateMatchImportBody(input());
    expect(r.ok).toBe(true);
  });

  // Guards against client/contract drift: the clients once sent a flattened
  // {kind,name}[] which 400s here, and linkParsed's catch silently no-ops the
  // whole match pass. knownIngredients MUST be a record keyed by recipe kind.
  it("rejects a flattened knownIngredients array (the old drift)", () => {
    const r = validateMatchImportBody({
      brands: ["Acme"],
      brandFlavors: {},
      unmatchedBrands: ["Akme"],
      unmatchedFlavors: [],
      knownIngredients: [{ kind: "dough", name: "Flour" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects when there is nothing to match", () => {
    const r = validateMatchImportBody(
      input({
        unmatchedBrands: [],
        unmatchedFlavors: [],
        unmatchedIngredients: [],
        unmatchedAppTypes: [],
        unmatchedPepTypes: [],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("sanitizeMatchImport extra-domain canonicalization", () => {
  it("keeps ingredient/app/pep matches that canonicalize to a known target", () => {
    const out = sanitizeMatchImport(
      {
        brandMatches: [],
        flavorMatches: [],
        ingredientMatches: [{ kind: "dough", candidate: "Floor", match: "Flour" }],
        appTypeMatches: [{ candidate: "Spredr", match: "Spreader" }],
        pepTypeMatches: [{ candidate: "Cup Char", match: "Cup & Char" }],
      },
      input(),
    );
    expect(out.ingredientMatches).toEqual([{ kind: "dough", candidate: "Floor", match: "Flour" }]);
    expect(out.appTypeMatches).toEqual([{ candidate: "Spredr", match: "Spreader" }]);
    expect(out.pepTypeMatches).toEqual([{ candidate: "Cup Char", match: "Cup & Char" }]);
  });

  it("drops a hallucinated ingredient match whose target is not a saved name", () => {
    const out = sanitizeMatchImport(
      {
        ingredientMatches: [{ kind: "dough", candidate: "Floor", match: "Nonexistent Flour Blend" }],
      },
      input(),
    );
    expect(out.ingredientMatches).toEqual([]);
  });

  it("drops a wrong-kind ingredient match (sauce target proposed for a dough candidate)", () => {
    const out = sanitizeMatchImport(
      {
        ingredientMatches: [{ kind: "dough", candidate: "Floor", match: "Tomato Base" }],
      },
      input(),
    );
    expect(out.ingredientMatches).toEqual([]);
  });

  it("drops matches whose candidate was never asked about", () => {
    const out = sanitizeMatchImport(
      {
        appTypeMatches: [{ candidate: "Never Asked", match: "Spreader" }],
        pepTypeMatches: [{ candidate: "Never Asked", match: "Cup & Char" }],
      },
      input(),
    );
    expect(out.appTypeMatches).toEqual([]);
    expect(out.pepTypeMatches).toEqual([]);
  });
});

describe("conflictingProductLine", () => {
  it("treats two different product-line qualifiers as a conflict", () => {
    expect(
      conflictingProductLine("Basha's Ultra Thin Crust Pizzas", "Basha's Original Pizzas"),
    ).toBe(true);
  });

  it("treats a qualified brand vs a bare company brand as a conflict", () => {
    expect(conflictingProductLine("Basha's Original", "Basha")).toBe(true);
    expect(conflictingProductLine("Basha's Ultra Thin Crust", "Basha")).toBe(true);
  });

  it("allows typo/case/word-order variants of the SAME product line", () => {
    expect(conflictingProductLine("Bashas Original Pizzas", "Basha's Original Pizzas")).toBe(false);
    expect(conflictingProductLine("BASHA", "Basha")).toBe(false);
  });

  // The lexicon can't list every qualifier; the structural check must still catch
  // distinct sibling lines that use words not in PRODUCT_LINE_QUALIFIERS.
  it("catches unlisted qualifiers via the structural (dictionary-free) check", () => {
    expect(conflictingProductLine("Basha's Stone Fired", "Basha's Artisan")).toBe(true);
    expect(conflictingProductLine("Basha's Cauliflower Crust", "Basha")).toBe(true);
  });

  it("ignores generic suffix words (Pizzas / Foods / Co) when comparing", () => {
    expect(conflictingProductLine("Basha Foods", "Basha")).toBe(false);
    expect(conflictingProductLine("Basha Pizzas", "Basha Co")).toBe(false);
  });

  it("does not flag a company-name typo (differing FIRST token) as a line split", () => {
    expect(conflictingProductLine("Bashas Stone Fired", "Basha Stone Fired")).toBe(false);
  });
});

describe("sanitizeMatchImport brand product-line guard", () => {
  // The reported bug: a second spec sheet ("Ultra Thin Crust") folded onto the
  // saved "Original" brand, so both product lines collapsed into one.
  it("drops a brand fold across different product lines", () => {
    const out = sanitizeMatchImport(
      {
        brandMatches: [
          {
            candidate: "Basha's Ultra Thin Crust Pizzas",
            match: "Basha's Original Pizzas",
          },
        ],
      },
      input({
        brands: ["Basha's Original Pizzas"],
        brandFlavors: {},
        unmatchedBrands: ["Basha's Ultra Thin Crust Pizzas"],
        unmatchedFlavors: [],
      }),
    );
    expect(out.brandMatches).toEqual([]);
  });

  it("drops a fold of a qualified brand onto a bare company brand", () => {
    const out = sanitizeMatchImport(
      { brandMatches: [{ candidate: "Basha's Original", match: "Basha" }] },
      input({
        brands: ["Basha"],
        brandFlavors: {},
        unmatchedBrands: ["Basha's Original"],
        unmatchedFlavors: [],
      }),
    );
    expect(out.brandMatches).toEqual([]);
  });

  it("keeps a genuine typo match within the same product line", () => {
    const out = sanitizeMatchImport(
      {
        brandMatches: [
          { candidate: "Bashas Original Pizzas", match: "Basha's Original Pizzas" },
        ],
      },
      input({
        brands: ["Basha's Original Pizzas"],
        brandFlavors: {},
        unmatchedBrands: ["Bashas Original Pizzas"],
        unmatchedFlavors: [],
      }),
    );
    expect(out.brandMatches).toEqual([
      { candidate: "Bashas Original Pizzas", match: "Basha's Original Pizzas" },
    ]);
  });
});
