import { describe, expect, it } from "vitest";
import {
  cleanSpecDoughName,
  cleanSpecSauceName,
  canonicalizeSpecImportNamedRecipeNames,
  linkSpecImportNamedRecipesToExisting,
  type ParsedSpecImport,
} from "./index";

describe("cleanSpecSauceName", () => {
  it("strips sourcing qualifiers", () => {
    expect(cleanSpecSauceName("Aldo's Sauce (made in house)")).toBe(
      "Aldo's Sauce",
    );
    expect(cleanSpecSauceName("BBQ Sauce (Legacy)")).toBe("BBQ Sauce");
    expect(cleanSpecSauceName("Lucia's Sauce (Lucia's Recipe)")).toBe(
      "Lucia's Sauce",
    );
    expect(cleanSpecSauceName("Marinara (UFI - Made in House)")).toBe(
      "Marinara",
    );
  });

  it("keeps qualifier when base would be generic", () => {
    expect(cleanSpecSauceName("Sauce (Lucia Recipe)")).toBe(
      "Sauce (Lucia Recipe)",
    );
  });

  it("leaves non-qualifier parentheticals alone", () => {
    expect(cleanSpecSauceName("Wing Sauce (Mild)")).toBe("Wing Sauce (Mild)");
    expect(cleanSpecSauceName("Plain Sauce")).toBe("Plain Sauce");
    expect(cleanSpecSauceName("")).toBe("");
  });
});

describe("cleanSpecDoughName", () => {
  it("unwraps parbake-crust wrapping, dropping die segment and size", () => {
    expect(
      cleanSpecDoughName('Parbake Crust (11" CRB recipe - 11" Dies)'),
    ).toBe("CRB recipe");
    expect(
      cleanSpecDoughName("Parbake crust (Aldo's recipe - 12\" Dies)"),
    ).toBe("Aldo's recipe");
    expect(cleanSpecDoughName('Crust (7" CRB recipe - 7" Dies)')).toBe(
      "CRB recipe",
    );
  });

  it("strips sourcing qualifiers on named doughs", () => {
    expect(cleanSpecDoughName("Aldo's Dough (made in house)")).toBe(
      "Aldo's Dough",
    );
  });

  it("strips a trailing die segment on unwrapped names", () => {
    expect(cleanSpecDoughName('Ultra Thin Dough - 16" Dies')).toBe(
      "Ultra Thin Dough",
    );
  });

  it("leaves real names alone", () => {
    expect(cleanSpecDoughName("Ultra Thin Dough")).toBe("Ultra Thin Dough");
    expect(cleanSpecDoughName("")).toBe("");
  });
});

const base = (over: Partial<ParsedSpecImport>): ParsedSpecImport =>
  ({ profiles: [], recipes: [], ...over }) as ParsedSpecImport;

describe("canonicalizeSpecImportNamedRecipeNames", () => {
  it("cleans dough/sauce recipe names and profile references in lockstep", () => {
    const parsed = base({
      recipes: [
        {
          kind: "dough",
          name: 'Parbake Crust (11" CRB recipe - 11" Dies)',
          rows: [],
        } as any,
        { kind: "sauce", name: "Aldo's Sauce (made in house)", rows: [] } as any,
        { kind: "cheese", name: "Aldo's Cheese Mix 2.07", rows: [] } as any,
      ],
      profiles: [
        {
          brand: "Aldo's",
          flavor: "Cheese",
          doughName: 'Parbake Crust (11" CRB recipe - 11" Dies)',
          sauceName: "Aldo's Sauce (made in house)",
          applicators: [],
          pepperonis: [],
        } as any,
      ],
    });
    const out = canonicalizeSpecImportNamedRecipeNames(parsed);
    expect(out.recipes?.map((r) => r.name)).toEqual([
      "CRB recipe",
      "Aldo's Sauce",
      "Aldo's Cheese Mix 2.07", // cheese untouched here
    ]);
    expect(out.profiles?.[0]?.doughName).toBe("CRB recipe");
    expect(out.profiles?.[0]?.sauceName).toBe("Aldo's Sauce");
  });

  it("never rewrites a user-typed name and no-ops when clean", () => {
    const parsed = base({
      recipes: [
        {
          kind: "sauce",
          name: "Aldo's Sauce (made in house)",
          userNamed: true,
          rows: [],
        } as any,
      ],
    });
    const out = canonicalizeSpecImportNamedRecipeNames(parsed);
    expect(out.recipes?.[0]?.name).toBe("Aldo's Sauce (made in house)");
    const clean = base({
      recipes: [{ kind: "dough", name: "CRB recipe", rows: [] } as any],
    });
    expect(canonicalizeSpecImportNamedRecipeNames(clean)).toBe(clean);
  });
});

describe("linkSpecImportNamedRecipesToExisting + cleanup", () => {
  it("snaps a cleaned import onto a pool entry still saved under the raw name", () => {
    const parsed = base({
      recipes: [{ kind: "dough", name: "CRB recipe", rows: [] } as any],
      profiles: [
        {
          brand: "B",
          flavor: "F",
          doughName: "CRB recipe",
          applicators: [],
          pepperonis: [],
        } as any,
      ],
    });
    const out = linkSpecImportNamedRecipesToExisting(parsed, "dough", [
      'Parbake Crust (11" CRB recipe - 11" Dies)',
    ]);
    expect(out.recipes?.[0]?.name).toBe(
      'Parbake Crust (11" CRB recipe - 11" Dies)',
    );
    expect(out.profiles?.[0]?.doughName).toBe(
      'Parbake Crust (11" CRB recipe - 11" Dies)',
    );
  });

  it("snaps a raw import onto a pool entry already renamed to the clean name", () => {
    const parsed = base({
      recipes: [
        {
          kind: "sauce",
          name: "Aldo's Sauce (made in house)",
          rows: [],
        } as any,
      ],
    });
    const out = linkSpecImportNamedRecipesToExisting(parsed, "sauce", [
      "Aldo's Sauce",
    ]);
    expect(out.recipes?.[0]?.name).toBe("Aldo's Sauce");
  });
});
