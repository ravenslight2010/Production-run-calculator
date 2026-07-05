import { describe, it, expect } from "vitest";
import {
  repointMixesForBrandMerge,
  repointMixesForFlavorMerge,
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
