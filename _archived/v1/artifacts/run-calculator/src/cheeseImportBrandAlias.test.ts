// Brand-merge/rename resurrection guard for the cheese workbook importer:
// a re-imported sheet whose tab still carries a merged/renamed-away customer
// name must snap to the canonical brand (with a recomputed brand-derived id)
// instead of resurrecting the old brand as a "new" pool entry.
import { describe, it, expect } from "vitest";
import { remapCheeseRecipeBrands } from "./cheeseImport";
import { cheeseImportId } from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { SpecImportAlias } from "@workspace/spec-import";

function recipe(brand: string, name: string): CheeseRecipe {
  return {
    id: cheeseImportId(brand, name),
    name,
    brand,
    flavors: [],
    shredderSetting: "",
    cellulose: 0,
    notes: "",
    components: [{ ingredient: "Mozzarella", lbs: 100 }],
    enabled: true,
  } as CheeseRecipe;
}

const brandAlias = (from: string, to: string): SpecImportAlias => ({
  kind: "brand",
  externalName: from,
  canonicalName: to,
  context: null,
});

describe("remapCheeseRecipeBrands", () => {
  it("snaps a merged-away brand to the canonical name and recomputes the id", () => {
    const r = recipe("Old Pizza Co", "House Blend");
    const out = remapCheeseRecipeBrands([r], [brandAlias("Old Pizza Co", "New Pizza Co")]);
    expect(out[0].brand).toBe("New Pizza Co");
    expect(out[0].id).toBe(cheeseImportId("New Pizza Co", "House Blend"));
    expect(out[0].name).toBe("House Blend");
  });

  it("matches aliases case-insensitively", () => {
    const r = recipe("old pizza co", "House Blend");
    const out = remapCheeseRecipeBrands([r], [brandAlias("Old Pizza Co", "New Pizza Co")]);
    expect(out[0].brand).toBe("New Pizza Co");
  });

  it("leaves unaliased brands untouched (same object)", () => {
    const r = recipe("Other Brand", "House Blend");
    const out = remapCheeseRecipeBrands([r], [brandAlias("Old Pizza Co", "New Pizza Co")]);
    expect(out[0]).toBe(r);
  });

  it("ignores digit-mismatch brand aliases (poison guard)", () => {
    // sanitizeSpecAliases drops brand aliases whose digit signatures differ —
    // "Basha 11in" → "Basha 12in" is talking about a DIFFERENT product line.
    const r = recipe("Basha 11in", "House Blend");
    const out = remapCheeseRecipeBrands([r], [brandAlias("Basha 11in", "Basha 12in")]);
    expect(out[0]).toBe(r);
  });
});
