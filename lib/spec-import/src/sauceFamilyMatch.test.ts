import { describe, expect, it } from "vitest";
import {
  findSpecImportSauceFamilyMatch,
  findSpecImportNamedRecipeFamilyMatch,
  specImportDieTypeMatchKey,
  specImportCheeseRecipeIsMix,
} from "./index";

describe("findSpecImportSauceFamilyMatch", () => {
  const pool = [
    "Lucia Pizza Sauce",
    "Sour Sauce",
    "Sweet Chili Sauce",
    "Modified Medulla Sauce",
  ];

  it("matches variant references onto the pool recipe (generic words + possessive folded)", () => {
    expect(findSpecImportSauceFamilyMatch("Lucia Recipe", pool)).toBe("Lucia Pizza Sauce");
    expect(findSpecImportSauceFamilyMatch("Lucia's", pool)).toBe("Lucia Pizza Sauce");
    expect(findSpecImportSauceFamilyMatch("LUCIA SAUCE", pool)).toBe("Lucia Pizza Sauce");
  });

  it("requires set EQUALITY — never subset (Sweet n Sour must not hit Sour Sauce)", () => {
    expect(findSpecImportSauceFamilyMatch("Sweet n Sour Sauce", pool)).toBeNull();
    expect(findSpecImportSauceFamilyMatch("Medulla Sauce", pool)).toBeNull(); // pool has "Modified Medulla"
  });

  it("never matches on generic-only names", () => {
    expect(findSpecImportSauceFamilyMatch("Pizza Sauce", pool)).toBeNull();
    expect(findSpecImportSauceFamilyMatch("Sauce Recipe", pool)).toBeNull();
    expect(findSpecImportSauceFamilyMatch("", pool)).toBeNull();
  });

  it("returns null when two DIFFERENT pool recipes claim the same key", () => {
    expect(
      findSpecImportSauceFamilyMatch("Lucia", ["Lucia Pizza Sauce", "Lucia's Frontline Recipe"]),
    ).toBeNull();
  });

  it("two pool names that are mere loose-key equivalents are NOT ambiguous — first wins", () => {
    // "Lucia Sauce" and "Lucia Pizza Sauce" share the loose key ("pizza" is
    // filler) — they are the same recipe saved twice, not a conflict.
    expect(
      findSpecImportSauceFamilyMatch("Lucia Recipe", ["Lucia Sauce", "Lucia Pizza Sauce"]),
    ).toBe("Lucia Sauce");
  });

  it("kind-aware wrapper routes dough to subset matching, sauce to equality", () => {
    expect(
      findSpecImportNamedRecipeFamilyMatch("dough", 'Thick CRB recipe', ["CRB Dough"]),
    ).toBe("CRB Dough");
    // subset would match, equality must not:
    expect(
      findSpecImportNamedRecipeFamilyMatch("sauce", "Sweet n Sour Sauce", ["Sour Sauce"]),
    ).toBeNull();
  });
});

describe("specImportDieTypeMatchKey", () => {
  it('folds the generic "Dies" word so 11" == 11" Dies', () => {
    expect(specImportDieTypeMatchKey('11" Dies')).toBe(specImportDieTypeMatchKey('11"'));
    expect(specImportDieTypeMatchKey('12" dies')).toBe(specImportDieTypeMatchKey('12"'));
    expect(specImportDieTypeMatchKey("Argus Dies")).toBe("argus");
  });

  it("keeps an all-generic name keyed to itself", () => {
    expect(specImportDieTypeMatchKey("Dies")).toBe("dies");
  });
});

describe('specImportCheeseRecipeIsMix "Blend" routing', () => {
  it("routes a cheese-less multi-ingredient Blend to Mixes", () => {
    expect(specImportCheeseRecipeIsMix("Red Fajita Blend", new Set(), 4)).toBe(true);
  });
  it("keeps cheese-named blends in Cheese", () => {
    expect(specImportCheeseRecipeIsMix("5 Cheese Blend", new Set(), 4)).toBe(false);
  });
  it("single-ingredient blend is not a mix", () => {
    expect(specImportCheeseRecipeIsMix("Red Fajita Blend", new Set(), 1)).toBe(false);
  });
});
