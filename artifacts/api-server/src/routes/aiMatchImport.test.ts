import { describe, it, expect } from "vitest";
import {
  validateMatchImportBody,
  sanitizeMatchImport,
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
