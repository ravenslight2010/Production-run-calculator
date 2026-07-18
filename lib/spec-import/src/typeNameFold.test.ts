import { describe, it, expect } from "vitest";
import { canonicalize, collectSpecAliases, specImportTypeNameFoldKey } from "./index";

describe("specImportTypeNameFoldKey", () => {
  it("drops the neutral 'milk' descriptor", () => {
    expect(specImportTypeNameFoldKey("Whole Milk Mozzarella")).toBe(
      specImportTypeNameFoldKey("Whole Mozzarella"),
    );
  });

  it("keeps a name that is only the neutral token", () => {
    expect(specImportTypeNameFoldKey("Milk")).toBe("milk");
  });

  it("does not fold 'cheese' (cheese sticks != sticks)", () => {
    expect(specImportTypeNameFoldKey("Cheese Sticks")).not.toBe(
      specImportTypeNameFoldKey("Sticks"),
    );
  });
});

describe("canonicalize neutral-descriptor fold for TYPE names", () => {
  it("snaps an appType with an extra 'milk' token to the known name", () => {
    const r = canonicalize(
      "Whole Milk Mozzarella",
      ["Whole Mozzarella", "Parmesan"],
      [],
      "appType",
    );
    expect(r.value).toBe("Whole Mozzarella");
    expect(r.source).toBe("exact");
  });

  it("snaps the reverse direction too (raw lacks the descriptor)", () => {
    const r = canonicalize(
      "Whole Mozzarella",
      ["Whole Milk Mozzarella"],
      [],
      "appType",
    );
    expect(r.value).toBe("Whole Milk Mozzarella");
    expect(r.source).toBe("exact");
  });

  it("applies to pepType as well", () => {
    const r = canonicalize(
      "Whole Milk Mozz Shred",
      ["Whole Mozz Shred"],
      [],
      "pepType",
    );
    expect(r.value).toBe("Whole Mozz Shred");
  });

  it("skips when two known names fold to the same key (ambiguity guard)", () => {
    const r = canonicalize(
      "Whole Milk Mozzarella",
      ["Whole Mozzarella", "WHOLE  MOZZARELLA!"],
      [],
      "appType",
    );
    expect(r.source).toBe("new");
    expect(r.value).toBe("Whole Milk Mozzarella");
  });

  it("does NOT fold for non-type kinds (brand keeps its own product line)", () => {
    const r = canonicalize("Milk Farms", ["Farms"], [], "brand");
    expect(r.source).toBe("new");
    expect(r.value).toBe("Milk Farms");
  });

  it("learns the fold match as an alias (counted as exact)", () => {
    const r = canonicalize("Whole Milk Mozzarella", ["Whole Mozzarella"], [], "appType");
    const aliases = collectSpecAliases([{ kind: "appType", result: r }]);
    expect(aliases).toEqual([
      expect.objectContaining({
        kind: "appType",
        externalName: "Whole Milk Mozzarella",
        canonicalName: "Whole Mozzarella",
      }),
    ]);
  });

  it("keeps the meaningful-extra-word guard for other tokens", () => {
    const r = canonicalize(
      "Red Hot Chicken Mix",
      ["Red Hot Mix"],
      [],
      "appType",
    );
    expect(r.source).toBe("new");
    expect(r.value).toBe("Red Hot Chicken Mix");
  });
});
