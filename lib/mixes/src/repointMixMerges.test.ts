import { describe, it, expect } from "vitest";
import {
  repointMixesForBrandMerge,
  repointMixesForFlavorMerge,
  repointMixIngredients,
  renameMixesBrand,
  type Mix,
} from "./index";

function make(over: Partial<Mix>): Mix {
  return {
    id: over.id ?? (over.name ?? "mix").toLowerCase(),
    name: over.name ?? "Mix",
    brand: over.brand ?? "",
    flavor: over.flavor ?? "",
    batchSize: over.batchSize ?? 0,
    daysEarly: over.daysEarly ?? 0,
    amountAlreadyMade: over.amountAlreadyMade ?? 0,
    components: over.components ?? [],
    enabled: over.enabled ?? true,
    ...(over.notes !== undefined ? { notes: over.notes } : {}),
    ...(over.scope !== undefined ? { scope: over.scope } : {}),
  };
}

describe("repointMixesForBrandMerge", () => {
  it("re-points only mixes whose brand is a merged-away source (case-insensitive)", () => {
    const mixes = [
      make({ id: "1", brand: "Bobo Pizza", name: "Veggie" }),
      make({ id: "2", brand: "bobo's", name: "Meat" }),
      make({ id: "3", brand: "Other", name: "Cheese" }),
    ];
    const changed = repointMixesForBrandMerge(mixes, ["Bobo Pizza", "Bobo's"], "Bobo");
    expect(changed.map((m) => m.id).sort()).toEqual(["1", "2"]);
    expect(changed.every((m) => m.brand === "Bobo")).toBe(true);
  });

  it("returns nothing when no mix names a source, when target is blank, or on a no-op", () => {
    const mixes = [make({ id: "1", brand: "Alpha" })];
    expect(repointMixesForBrandMerge(mixes, ["Zeta"], "Beta")).toEqual([]);
    expect(repointMixesForBrandMerge(mixes, ["Alpha"], "   ")).toEqual([]);
    expect(repointMixesForBrandMerge(mixes, ["Alpha"], "Alpha")).toEqual([]);
  });
});

describe("renameMixesBrand", () => {
  it("renames every mix in the brand group (case-insensitive match) and returns only changed rows", () => {
    const mixes = [
      make({ id: "1", brand: "Bobo Pizza", name: "Veggie" }),
      make({ id: "2", brand: "bobo pizza", name: "Meat" }),
      make({ id: "3", brand: "Other", name: "Cheese" }),
    ];
    const changed = renameMixesBrand(mixes, "Bobo Pizza", "Bobo");
    expect(changed.map((m) => m.id).sort()).toEqual(["1", "2"]);
    expect(changed.every((m) => m.brand === "Bobo")).toBe(true);
  });

  it("allows a case-only respelling (unlike the merge repoint helper)", () => {
    const mixes = [make({ id: "1", brand: "aldos" })];
    const changed = renameMixesBrand(mixes, "aldos", "Aldos");
    expect(changed).toHaveLength(1);
    expect(changed[0].brand).toBe("Aldos");
  });

  it("merging into an existing brand's spelling rewrites only the source group's rows", () => {
    const mixes = [
      make({ id: "1", brand: "Bobo's" }),
      make({ id: "2", brand: "Bobo" }),
    ];
    const changed = renameMixesBrand(mixes, "Bobo's", "Bobo");
    expect(changed.map((m) => m.id)).toEqual(["1"]);
    expect(changed[0].brand).toBe("Bobo");
  });

  it("returns nothing for a blank target, a blank source (No brand group), or an exact no-op", () => {
    const mixes = [make({ id: "1", brand: "Alpha" }), make({ id: "2", brand: "" })];
    expect(renameMixesBrand(mixes, "Alpha", "   ")).toEqual([]);
    expect(renameMixesBrand(mixes, "   ", "Beta")).toEqual([]);
    expect(renameMixesBrand(mixes, "Alpha", "Alpha")).toEqual([]);
  });
});

describe("repointMixesForFlavorMerge", () => {
  it("re-points only same-brand mixes whose flavor is a merged-away source", () => {
    const mixes = [
      make({ id: "1", brand: "Bobo", flavor: "Pep" }),
      make({ id: "2", brand: "Bobo", flavor: "peperoni" }),
      make({ id: "3", brand: "Bobo", flavor: "Cheese" }),
      // Same source flavor, but a DIFFERENT brand — flavor merges are per-brand.
      make({ id: "4", brand: "Other", flavor: "Pep" }),
    ];
    const changed = repointMixesForFlavorMerge(mixes, "Bobo", ["Pep", "peperoni"], "Pepperoni");
    expect(changed.map((m) => m.id).sort()).toEqual(["1", "2"]);
    expect(changed.every((m) => m.flavor === "Pepperoni")).toBe(true);
  });

  it("returns nothing without a brand, without a target, or on a no-op", () => {
    const mixes = [make({ id: "1", brand: "Bobo", flavor: "Pep" })];
    expect(repointMixesForFlavorMerge(mixes, "   ", ["Pep"], "Pepperoni")).toEqual([]);
    expect(repointMixesForFlavorMerge(mixes, "Bobo", ["Pep"], "   ")).toEqual([]);
    expect(repointMixesForFlavorMerge(mixes, "Bobo", ["Pep"], "Pep")).toEqual([]);
  });
});

describe("repointMixIngredients", () => {
  it("rewrites matching component ingredient names (case-insensitive) and returns only changed mixes", () => {
    const mixes = [
      make({ id: "1", components: [{ ingredient: "Mozz", perPizza: 2 }, { ingredient: "Sauce", perPizza: 1 }] }),
      make({ id: "2", components: [{ ingredient: "Cheddar", perPizza: 3 }] }),
    ];
    const changed = repointMixIngredients(mixes, ["mozz"], "Mozzarella");
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe("1");
    expect(changed[0].components).toEqual([
      { ingredient: "Mozzarella", perPizza: 2 },
      { ingredient: "Sauce", perPizza: 1 },
    ]);
  });

  it("keeps both rows (no combine) when two components collapse to the same target", () => {
    const mixes = [make({ id: "1", components: [{ ingredient: "Mozz", perPizza: 2 }, { ingredient: "Mozzarella", perPizza: 3 }] })];
    const changed = repointMixIngredients(mixes, ["Mozz"], "Mozzarella");
    expect(changed[0].components).toEqual([
      { ingredient: "Mozzarella", perPizza: 2 },
      { ingredient: "Mozzarella", perPizza: 3 },
    ]);
  });

  it("returns [] for no matches, empty target, or a source equal to the target", () => {
    const mixes = [make({ id: "1", components: [{ ingredient: "Mozz", perPizza: 2 }] })];
    expect(repointMixIngredients(mixes, ["Onion"], "Onions")).toEqual([]);
    expect(repointMixIngredients(mixes, ["Mozz"], "   ")).toEqual([]);
    expect(repointMixIngredients(mixes, ["Mozz"], "Mozz")).toEqual([]);
  });
});
