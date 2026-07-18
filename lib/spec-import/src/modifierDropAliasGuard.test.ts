import { describe, it, expect } from "vitest";
import {
  isModifierDropNamePair,
  sanitizeSpecAliases,
  canonicalize,
  applyNameMatches,
  type SpecImportAlias,
  type ParsedSpecImport,
} from "./index";

const alias = (
  kind: SpecImportAlias["kind"],
  externalName: string,
  canonicalName: string,
  context: string | null = null,
): SpecImportAlias => ({ kind, externalName, canonicalName, context });

describe("isModifierDropNamePair", () => {
  it("flags pairs where one token set is a proper subset of the other", () => {
    expect(isModifierDropNamePair("Sea Salt", "Salt")).toBe(true);
    expect(isModifierDropNamePair("SALT", "SEA SALT")).toBe(true);
    expect(isModifierDropNamePair("Red Hot Chicken Mix", "Red Hot Mix")).toBe(true);
  });

  it("does not flag pure typos or unrelated names", () => {
    expect(isModifierDropNamePair("Slat", "Salt")).toBe(false);
    expect(isModifierDropNamePair("Sea Slat", "Sea Salt")).toBe(false);
    expect(isModifierDropNamePair("Sea Salt", "Kosher Salt")).toBe(false);
    expect(isModifierDropNamePair("Honey", "Sugar")).toBe(false);
  });

  it("does not flag case/punctuation variants of the same name", () => {
    expect(isModifierDropNamePair("SEA-SALT", "Sea Salt")).toBe(false);
  });
});

describe("sanitizeSpecAliases modifier-drop guard", () => {
  it("drops ingredient-kind subset aliases (Sea Salt → Salt)", () => {
    for (const kind of ["doughIngredient", "sauceIngredient", "cheeseIngredient"] as const) {
      expect(sanitizeSpecAliases([alias(kind, "SEA SALT", "SALT")])).toEqual([]);
    }
  });

  it("keeps legitimate ingredient typo aliases", () => {
    const a = alias("doughIngredient", "SEA SLAT", "SEA SALT");
    expect(sanitizeSpecAliases([a])).toEqual([a]);
  });

  it("leaves review-driven kinds (recipeName/appType) untouched by the subset rule", () => {
    const link = alias("recipeName", "Malted Barley", "Modified Malted Barley Dough", "dough");
    const blend = alias("appType", "Cheeseburger Cheese Mix", "Cheeseburger Blend");
    expect(sanitizeSpecAliases([link, blend])).toEqual([link, blend]);
  });
});

describe("canonicalize with a poisoned subset ingredient alias", () => {
  it("falls through to exact/new instead of renaming", () => {
    const aliases = [alias("doughIngredient", "SEA SALT", "SALT")];
    const r = canonicalize("SEA SALT", ["SALT", "SEA SALT"], aliases, "doughIngredient");
    expect(r.value).toBe("SEA SALT");
    expect(r.source).toBe("exact");
    // Even when Sea Salt is unknown, it must NOT collapse onto Salt.
    const r2 = canonicalize("SEA SALT", ["SALT"], aliases, "doughIngredient");
    expect(r2.value).toBe("SEA SALT");
    expect(r2.source).toBe("new");
  });
});

describe("applyNameMatches ingredient guard", () => {
  const parsed: ParsedSpecImport = {
    profiles: [],
    recipes: [
      {
        kind: "dough",
        name: "Malted Barley Dough",
        rows: [{ ingredient: "SEA SALT", lbs: 1 }],
      } as ParsedSpecImport["recipes"][number],
    ],
  } as ParsedSpecImport;

  it("never auto-applies or learns a modifier-dropping AI ingredient match", () => {
    const out = applyNameMatches(parsed, [], [], {
      ingredientMatches: [{ kind: "dough", candidate: "SEA SALT", match: "SALT" }],
    });
    expect(out.parsed.recipes[0].rows[0].ingredient).toBe("SEA SALT");
    expect(out.aliases).toEqual([]);
  });

  it("still applies and learns a legitimate typo ingredient match", () => {
    const typo: ParsedSpecImport = {
      ...parsed,
      recipes: [
        { ...parsed.recipes[0], rows: [{ ingredient: "SEA SLAT", lbs: 1 }] },
      ],
    } as ParsedSpecImport;
    const out = applyNameMatches(typo, [], [], {
      ingredientMatches: [{ kind: "dough", candidate: "SEA SLAT", match: "SEA SALT" }],
    });
    expect(out.parsed.recipes[0].rows[0].ingredient).toBe("SEA SALT");
    expect(out.aliases).toEqual([
      { kind: "doughIngredient", externalName: "SEA SLAT", canonicalName: "SEA SALT", context: null },
    ]);
  });
});
