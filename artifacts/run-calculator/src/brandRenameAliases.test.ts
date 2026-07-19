// Customer (brand) rename resurrection guard: after a manager renames a
// customer group in the Cheese Recipes / Mixes pool managers (or edits the
// last row of a group's brand), the learned `kind:"brand"` spec-import alias
// rows built by buildBrandRenameAliases must be exactly what the importers'
// brand-grounding passes consult, so a re-import of the original workbook maps
// the old tab brand onto the renamed group instead of resurrecting it.
import { describe, it, expect } from "vitest";
import { buildBrandRenameAliases } from "./specImportAliases";
import { remapCheeseRecipeBrands } from "./cheeseImport";
import { pickAlias, sanitizeSpecAliases, type SpecImportAlias } from "@workspace/spec-import";
import { suggestPremixRedirects, type PremixCandidate } from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

describe("buildBrandRenameAliases", () => {
  it("writes a context-free brand row for a rename", () => {
    expect(buildBrandRenameAliases(["Old Pizza Co"], "New Pizza Co")).toEqual([
      { kind: "brand", externalName: "Old Pizza Co", canonicalName: "New Pizza Co", context: null },
    ]);
  });

  it("skips blank targets, blank/self/duplicate sources", () => {
    expect(buildBrandRenameAliases(["A"], "  ")).toEqual([]);
    expect(
      buildBrandRenameAliases(["", "  ", "Target", "target", "Old", "old "], "Target"),
    ).toEqual([{ kind: "brand", externalName: "Old", canonicalName: "Target", context: null }]);
  });

  it("re-points existing brand aliases whose canonical was the old name (chain guard)", () => {
    const existing: SpecImportAlias[] = [
      // A prior sheet label already learned onto the OLD brand — must follow.
      { kind: "brand", externalName: "OPC", canonicalName: "Old Pizza Co", context: null },
      // Other kinds must NOT be touched.
      { kind: "appType", externalName: "Some Mix", canonicalName: "Old Pizza Co", context: null },
      // Unrelated brand aliases must NOT be touched.
      { kind: "brand", externalName: "X", canonicalName: "Unrelated", context: null },
    ];
    const rows = buildBrandRenameAliases(["Old Pizza Co"], "New Pizza Co", existing);
    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: "brand", externalName: "Old Pizza Co", canonicalName: "New Pizza Co", context: null },
        { kind: "brand", externalName: "OPC", canonicalName: "New Pizza Co", context: null },
      ]),
    );
    expect(rows).toHaveLength(2);
    // Result survives the importer-side sanitizer (no chain conflict left).
    expect(sanitizeSpecAliases(rows)).toHaveLength(2);
  });

  it("drops a re-point that would self-alias onto the target", () => {
    const existing: SpecImportAlias[] = [
      { kind: "brand", externalName: "New Pizza Co", canonicalName: "Old Pizza Co", context: null },
    ];
    const rows = buildBrandRenameAliases(["Old Pizza Co"], "New Pizza Co", existing);
    expect(rows).toEqual([
      { kind: "brand", externalName: "Old Pizza Co", canonicalName: "New Pizza Co", context: null },
    ]);
  });
});

describe("re-import consumption of learned brand rename aliases", () => {
  const alias = (from: string, to: string): SpecImportAlias => ({
    kind: "brand",
    externalName: from,
    canonicalName: to,
    context: null,
  });

  it("cheese re-import remaps the old tab brand (and re-derives the recipe id)", () => {
    const r = {
      id: "cheese-old-pizza-co-house-blend",
      name: "House Blend",
      brand: "Old Pizza Co",
      flavors: [],
      shredderSetting: "",
      cellulose: "",
      notes: "",
      components: [],
      enabled: true,
    } as unknown as CheeseRecipe;
    const out = remapCheeseRecipeBrands([r], buildBrandRenameAliases(["Old Pizza Co"], "New Pizza Co"));
    expect(out[0].brand).toBe("New Pizza Co");
    expect(out[0].id).not.toBe(r.id);
  });

  it("spec importer's pickAlias resolves the old brand", () => {
    const usable = sanitizeSpecAliases([alias("Old Pizza Co", "New Pizza Co")]);
    expect(pickAlias(usable, "brand", "old pizza co")).toBe("New Pizza Co");
  });

  it("premix brand-drift fallback redirects a same-name candidate onto the renamed row", () => {
    // After a group rename the pool row keeps its OLD-brand-derived id but
    // carries the new brand; the re-imported candidate's brand is remapped by
    // the learned brand alias so its recomputed id no longer matches. The
    // redirect suggester must land it on the renamed row (no appType alias).
    const existing = [
      { id: "premix-old-pizza-co--veggie-mix", name: "Veggie Mix", brand: "New Pizza Co", flavor: "", components: [] } as unknown as Mix,
    ];
    const candidates: PremixCandidate[] = [
      {
        mix: { id: "premix-new-pizza-co--veggie-mix", name: "Veggie Mix", brand: "New Pizza Co", flavor: "", components: [] } as unknown as Mix,
        status: "new",
      },
    ];
    expect(suggestPremixRedirects(candidates, existing, [])).toEqual({
      "premix-new-pizza-co--veggie-mix": "premix-old-pizza-co--veggie-mix",
    });
  });

  it("premix fallback never redirects onto a DIFFERENT brand's same-named mix", () => {
    const existing = [
      { id: "m-1", name: "Veggie Mix", brand: "Other Brand", flavor: "", components: [] } as unknown as Mix,
    ];
    const candidates: PremixCandidate[] = [
      {
        mix: { id: "cand-1", name: "Veggie Mix", brand: "New Pizza Co", flavor: "", components: [] } as unknown as Mix,
        status: "new",
      },
    ];
    expect(suggestPremixRedirects(candidates, existing, [])).toEqual({});
  });

  it("premix fallback tie-breaks several same-brand matches by flavor, else stays silent", () => {
    const existing = [
      { id: "m-a", name: "Veggie Mix", brand: "B", flavor: "Deluxe", components: [] } as unknown as Mix,
      { id: "m-b", name: "Veggie Mix", brand: "B", flavor: "Classic", components: [] } as unknown as Mix,
    ];
    const hit: PremixCandidate[] = [
      { mix: { id: "c-1", name: "Veggie Mix", brand: "B", flavor: "Deluxe", components: [] } as unknown as Mix, status: "new" },
    ];
    expect(suggestPremixRedirects(hit, existing, [])).toEqual({ "c-1": "m-a" });
    const miss: PremixCandidate[] = [
      { mix: { id: "c-2", name: "Veggie Mix", brand: "B", flavor: "", components: [] } as unknown as Mix, status: "new" },
    ];
    expect(suggestPremixRedirects(miss, existing, [])).toEqual({});
  });

  it("premix fallback skips unbranded candidates", () => {
    const existing = [
      { id: "m-1", name: "Veggie Mix", brand: "B", flavor: "", components: [] } as unknown as Mix,
    ];
    const candidates: PremixCandidate[] = [
      { mix: { id: "c-1", name: "Veggie Mix", brand: "", flavor: "", components: [] } as unknown as Mix, status: "new" },
    ];
    expect(suggestPremixRedirects(candidates, existing, [])).toEqual({});
  });
});
