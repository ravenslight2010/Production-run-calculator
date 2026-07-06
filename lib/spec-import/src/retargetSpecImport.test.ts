import { describe, it, expect } from "vitest";
import {
  buildSpecRenameMaps,
  remapRecipeForRenames,
  retargetSpecImport,
  type ParsedRecipe,
  type ParsedSpecImport,
  type SpecProfileRename,
} from "./index";

const dough = (over: Partial<ParsedRecipe> = {}): ParsedRecipe => ({
  kind: "dough",
  name: "Sheet Dough",
  rows: [{ ingredient: "Flour", lbs: 40 }],
  ...over,
});

describe("buildSpecRenameMaps", () => {
  it("builds a per-pair map and an unambiguous brand map", () => {
    const maps = buildSpecRenameMaps([
      { from: { brand: "Basha", flavor: "Plain" }, to: { brand: "Basha Ultra", flavor: "Plain" } },
      { from: { brand: "Basha", flavor: "Pep" }, to: { brand: "Basha Ultra", flavor: "Pep" } },
    ]);
    expect(maps.pairs.get("basha\u0000plain")).toEqual({ brand: "Basha Ultra", flavor: "Plain" });
    expect(maps.brands.get("basha")).toBe("Basha Ultra");
  });

  it("drops a brand from the brand map when its renames disagree", () => {
    const maps = buildSpecRenameMaps([
      { from: { brand: "Basha", flavor: "Plain" }, to: { brand: "Basha Ultra", flavor: "Plain" } },
      { from: { brand: "Basha", flavor: "Pep" }, to: { brand: "Basha Thin", flavor: "Pep" } },
    ]);
    // Ambiguous brand → not in brand map (per-flavor pairs still work).
    expect(maps.brands.has("basha")).toBe(false);
    expect(maps.pairs.get("basha\u0000plain")).toEqual({ brand: "Basha Ultra", flavor: "Plain" });
    expect(maps.pairs.get("basha\u0000pep")).toEqual({ brand: "Basha Thin", flavor: "Pep" });
  });

  it("ignores empty from/to entries", () => {
    const maps = buildSpecRenameMaps([
      { from: { brand: "", flavor: "" }, to: { brand: "X", flavor: "Y" } },
      { from: { brand: "A", flavor: "B" }, to: { brand: "", flavor: "" } },
    ]);
    expect(maps.pairs.size).toBe(0);
    expect(maps.brands.size).toBe(0);
  });
});

describe("remapRecipeForRenames", () => {
  const renames: SpecProfileRename[] = [
    { from: { brand: "Basha", flavor: "Plain" }, to: { brand: "Basha Ultra", flavor: "Plain" } },
    { from: { brand: "Basha", flavor: "Pep" }, to: { brand: "Basha Ultra", flavor: "Pep" } },
  ];
  const maps = buildSpecRenameMaps(renames);

  it("remaps the singular brand+flavor", () => {
    const out = remapRecipeForRenames(dough({ brand: "Basha", flavor: "Plain" }), maps);
    expect(out.brand).toBe("Basha Ultra");
    expect(out.flavor).toBe("Plain");
  });

  it("remaps each entry in targets[]", () => {
    const out = remapRecipeForRenames(
      dough({ targets: [{ brand: "Basha", flavor: "Plain" }, { brand: "Basha", flavor: "Pep" }] }),
      maps,
    );
    expect(out.targets).toEqual([
      { brand: "Basha Ultra", flavor: "Plain" },
      { brand: "Basha Ultra", flavor: "Pep" },
    ]);
  });

  it("remaps a flavorless brand and brandAnchors via the brand map", () => {
    const out = remapRecipeForRenames(
      dough({ brand: "Basha", flavor: undefined, brandAnchors: ["Basha"] }),
      maps,
    );
    expect(out.brand).toBe("Basha Ultra");
    expect(out.brandAnchors).toEqual(["Basha Ultra"]);
  });

  it("passes through values with no matching rename", () => {
    const out = remapRecipeForRenames(dough({ brand: "Other", flavor: "Cheese" }), maps);
    expect(out.brand).toBe("Other");
    expect(out.flavor).toBe("Cheese");
  });

  it("does not mutate the input recipe", () => {
    const input = dough({ brand: "Basha", flavor: "Plain", targets: [{ brand: "Basha", flavor: "Pep" }] });
    const snapshot = JSON.parse(JSON.stringify(input));
    remapRecipeForRenames(input, maps);
    expect(input).toEqual(snapshot);
  });
});

describe("retargetSpecImport", () => {
  it("re-points recipe targets to the confirmed product names", () => {
    const parsed: ParsedSpecImport = {
      // profiles are already renamed (the confirmed products from step 1).
      profiles: [{ brand: "Basha Ultra", flavor: "Plain", applicators: [], pepperonis: [] }],
      recipes: [dough({ brand: "Basha", flavor: "Plain" })],
    };
    const out = retargetSpecImport(parsed, [
      { from: { brand: "Basha", flavor: "Plain" }, to: { brand: "Basha Ultra", flavor: "Plain" } },
    ]);
    expect(out.recipes[0].brand).toBe("Basha Ultra");
    expect(out.recipes[0].flavor).toBe("Plain");
  });

  it("re-runs cross-fill against the corrected same-brand grouping", () => {
    // Two flavors that were originally different brands become the SAME brand
    // after the rename; one carries a die, the other is blank. Cross-fill should
    // now fill the blank from its new same-brand sibling.
    const parsed: ParsedSpecImport = {
      profiles: [
        { brand: "Merged", flavor: "Plain", dieType: "10in", applicators: [], pepperonis: [] },
        { brand: "Merged", flavor: "Pep", applicators: [], pepperonis: [] },
      ],
      recipes: [],
    };
    const out = retargetSpecImport(parsed, [
      { from: { brand: "OldA", flavor: "Plain" }, to: { brand: "Merged", flavor: "Plain" } },
      { from: { brand: "OldB", flavor: "Pep" }, to: { brand: "Merged", flavor: "Pep" } },
    ]);
    expect(out.profiles[1].dieType).toBe("10in");
  });

  it("preserves note and warnings", () => {
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [],
      note: "heads up",
      warnings: [{ brand: "B", flavor: "F", message: "check" }],
    };
    const out = retargetSpecImport(parsed, []);
    expect(out.note).toBe("heads up");
    expect(out.warnings).toEqual([{ brand: "B", flavor: "F", message: "check" }]);
  });
});
