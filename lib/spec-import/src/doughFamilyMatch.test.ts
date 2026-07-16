import { describe, it, expect } from "vitest";
import {
  findSpecImportDoughFamilyMatch,
  linkSpecImportNamedRecipesToExisting,
  type ParsedSpecImport,
} from "./index";

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

  it("snaps BOTH the recipe and the profile onto the base when THIS import carries a variant dough recipe", () => {
    // One recipe per dough family: an incoming variant recipe folds into the
    // existing base recipe (its rows/doughball weight ride along) and the
    // profile tie survives because both land on the base name. Keeping the
    // variant name stranded the recipe payload (pool guard dropped it) and
    // broke the profile↔recipe tie when the profile snapped but the recipe
    // did not.
    const withRecipe = {
      ...base,
      recipes: [
        { kind: "dough", name: "CRB Heavy Plus recipe", rows: [{ name: "Flour", lbs: 1 }] },
      ],
    } as unknown as ParsedSpecImport;
    const linked = linkSpecImportNamedRecipesToExisting(withRecipe, "dough", ["CRB Dough"]);
    expect(linked.recipes?.[0]?.name).toBe("CRB Dough");
    expect(linked.profiles?.[0]?.doughName).toBe("CRB Dough");
  });

  it("collapses row-identical dough siblings onto the family a sibling matched (customer-only labels)", () => {
    // One mixing table = one family: a yield row named ONLY after the customer
    // ("Basha's Original") shares no token with "CRB Dough", but it carries the
    // exact same ingredient rows as a sibling that DID match — it must become a
    // variant of the same family, never a standalone dough recipe.
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
    const linked = linkSpecImportNamedRecipesToExisting(parsed, "dough", ["CRB Dough"]);
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
    // The profile's dough reference follows the collapse.
    expect(linked.profiles?.[0]?.doughName).toBe("CRB Dough");
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
