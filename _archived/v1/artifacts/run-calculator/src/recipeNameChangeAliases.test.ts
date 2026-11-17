// Merge/rename resurrection guard for recipe NAMES (mixes / cheese / dough /
// sauce): after a manager merges or renames a recipe, the learned spec-import
// alias rows built by buildRecipeNameChangeAliases must be exactly what each
// importer's link pass consults, so a re-import of the original workbook maps
// the old sheet name onto the survivor instead of resurrecting it.
import { describe, it, expect } from "vitest";
import { buildRecipeNameChangeAliases } from "./specImportAliases";
import { pickAlias, sanitizeSpecAliases, type SpecImportAlias } from "@workspace/spec-import";
import { suggestPremixRedirects, type PremixCandidate } from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import {
  buildCheeseAliasLinkMaps,
  withCheeseLinks,
  type CheeseImportCandidate,
} from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

describe("buildRecipeNameChangeAliases shapes", () => {
  it("mixes/cheese write appType rows: context-free plus brand-scoped when brand known", () => {
    const rows = buildRecipeNameChangeAliases("mixes", ["Old Cheese Mix"], "House Cheese Mix", {
      brandContext: "Aldo's",
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: "appType", externalName: "Old Cheese Mix", canonicalName: "House Cheese Mix", context: null },
        { kind: "appType", externalName: "Old Cheese Mix", canonicalName: "House Cheese Mix", context: "Aldo's" },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("cheese without a brand writes only the context-free appType row", () => {
    const rows = buildRecipeNameChangeAliases("cheese", ["WM Blend"], "Whole Mozz Blend");
    expect(rows).toEqual([
      { kind: "appType", externalName: "WM Blend", canonicalName: "Whole Mozz Blend", context: null },
    ]);
  });

  it("dough/sauce write recipeName rows with the kind as context", () => {
    expect(buildRecipeNameChangeAliases("dough", ["Old Dough"], "House Dough")).toEqual([
      { kind: "recipeName", externalName: "Old Dough", canonicalName: "House Dough", context: "dough" },
    ]);
    expect(buildRecipeNameChangeAliases("sauce", ["Old Sauce"], "House Sauce")).toEqual([
      { kind: "recipeName", externalName: "Old Sauce", canonicalName: "House Sauce", context: "sauce" },
    ]);
  });

  it("skips blank targets, blank/self/duplicate sources", () => {
    expect(buildRecipeNameChangeAliases("mixes", ["A"], "  ")).toEqual([]);
    const rows = buildRecipeNameChangeAliases("mixes", ["", "  ", "Target", "target", "Old", "old "], "Target");
    expect(rows).toEqual([
      { kind: "appType", externalName: "Old", canonicalName: "Target", context: null },
    ]);
  });

  it("re-points existing aliases whose canonical is a merged-away source (chain guard)", () => {
    const existing: SpecImportAlias[] = [
      // A prior workbook label already learned onto the OLD name — must follow.
      { kind: "recipeName", externalName: "Sheet Dough v2", canonicalName: "Old Dough", context: "dough" },
      // Different kind/context rows must NOT be touched.
      { kind: "recipeName", externalName: "Sheet Sauce", canonicalName: "Old Dough", context: "sauce" },
      { kind: "appType", externalName: "Some Mix", canonicalName: "Old Dough", context: null },
    ];
    const rows = buildRecipeNameChangeAliases("dough", ["Old Dough"], "House Dough", {
      existingAliases: existing,
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: "recipeName", externalName: "Old Dough", canonicalName: "House Dough", context: "dough" },
        { kind: "recipeName", externalName: "Sheet Dough v2", canonicalName: "House Dough", context: "dough" },
      ]),
    );
    expect(rows).toHaveLength(2);
    // Result survives the importer-side sanitizer (no chain conflict left).
    expect(sanitizeSpecAliases(rows)).toHaveLength(2);
  });

  it("re-points appType aliases across contexts for blend merges", () => {
    const existing: SpecImportAlias[] = [
      { kind: "appType", externalName: "Chz Mix", canonicalName: "Old Blend", context: "Aldo's" },
    ];
    const rows = buildRecipeNameChangeAliases("cheese", ["Old Blend"], "New Blend", {
      brandContext: "Aldo's",
      existingAliases: existing,
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: "appType", externalName: "Chz Mix", canonicalName: "New Blend", context: "Aldo's" },
      ]),
    );
  });
});

describe("re-import consumption of learned merge/rename aliases", () => {
  it("premix re-import redirects the old mix name onto the surviving mix", () => {
    const aliases = buildRecipeNameChangeAliases("mixes", ["Old Cheese Mix"], "House Cheese Mix", {
      brandContext: "Aldo's",
    });
    const existing = [
      { id: "mix-1", name: "House Cheese Mix", brand: "Aldo's", flavor: "", components: [] } as unknown as Mix,
    ];
    const candidates: PremixCandidate[] = [
      {
        mix: { id: "cand-1", name: "Old Cheese Mix", brand: "Aldo's", flavor: "", components: [] } as unknown as Mix,
        status: "new",
      },
    ];
    expect(suggestPremixRedirects(candidates, existing, aliases)).toEqual({ "cand-1": "mix-1" });
  });

  it("cheese re-import links the old blend name onto the surviving recipe", () => {
    const aliases = buildRecipeNameChangeAliases("cheese", ["WM Blend"], "Whole Mozz Blend", {
      brandContext: "Aldo's",
    });
    const existing = [
      {
        id: "cr-1",
        name: "Whole Mozz Blend",
        brand: "Aldo's",
        flavors: [],
        shredderSetting: "",
        cellulose: 0,
        notes: "",
        components: [{ ingredient: "Mozzarella", lbs: 100 }],
        enabled: true,
      } as unknown as CheeseRecipe,
    ];
    const candidates: CheeseImportCandidate[] = [
      {
        recipe: {
          id: "cand-cr",
          name: "WM Blend",
          brand: "Aldo's",
          flavors: [],
          shredderSetting: "",
          cellulose: 0,
          notes: "",
          components: [{ ingredient: "Mozzarella", lbs: 100 }],
          enabled: true,
        } as unknown as CheeseRecipe,
        status: "new",
      },
    ];
    const out = withCheeseLinks(candidates, existing, buildCheeseAliasLinkMaps(aliases));
    expect(out[0].linkTo?.id).toBe("cr-1");
  });

  it("spec re-import resolves old dough/sauce names via pickAlias(recipeName, kind)", () => {
    const dough = buildRecipeNameChangeAliases("dough", ["Old Dough"], "House Dough");
    const sauce = buildRecipeNameChangeAliases("sauce", ["Old Sauce"], "House Sauce");
    expect(pickAlias(dough, "recipeName", "old dough", "dough")).toBe("House Dough");
    expect(pickAlias(dough, "recipeName", "Old Dough", "sauce")).toBeNull();
    expect(pickAlias(sauce, "recipeName", "OLD SAUCE", "sauce")).toBe("House Sauce");
  });
});
