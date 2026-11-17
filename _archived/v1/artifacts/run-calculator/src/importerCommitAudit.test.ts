// Targeted audit tests for commit-path correctness across the main importers and
// the setup-profile autofill pipeline. These tests do NOT mock the network: they
// exercise the pure merge functions that the commit orchestrators delegate to,
// plus the profileAutofill shipping-guide priority path.
//
// Coverage intent:
//   - mergeCheeseRecipes (from @workspace/cheese-recipes): upsert semantics,
//     ordering preservation, existing-not-in-import retained.
//   - mergePremixIntoMixes (from @workspace/premix-import): upsert semantics,
//     amountAlreadyMade + enabled preserved from existing, note policy, extra
//     existing mixes retained.
//   - desiredFromShipping inside buildProfileAutofillPlan: flavor-specific row
//     wins over brand-wide row within the same guide; newest guide wins across
//     guides when fields disagree.

import { describe, it, expect } from "vitest";
import { mergeCheeseRecipes } from "@workspace/cheese-recipes";
import { mergePremixIntoMixes } from "@workspace/premix-import";
import { buildProfileAutofillPlan } from "./profileAutofill";
import { DEFAULT_VALUES, type FormValues } from "./types";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";
import type { ParsedSpecImport } from "@workspace/spec-import";

function emptyData(): ParsedSpecImport {
  return { profiles: [], recipes: [] } as unknown as ParsedSpecImport;
}

function values(overrides: Partial<FormValues> = {}): FormValues {
  return { ...DEFAULT_VALUES, ...overrides } as FormValues;
}

function cheeseRecipe(overrides: Partial<CheeseRecipe> & { id: string; name: string; brand: string }): CheeseRecipe {
  return {
    flavors: [],
    components: [],
    enabled: true,
    ...overrides,
  } as CheeseRecipe;
}

function mix(overrides: Partial<Mix> & { id: string; name: string }): Mix {
  return {
    components: [],
    enabled: true,
    amountAlreadyMade: 0,
    ...overrides,
  } as unknown as Mix;
}

// ---------------------------------------------------------------------------
// mergeCheeseRecipes — commit-path upsert semantics
// ---------------------------------------------------------------------------
describe("mergeCheeseRecipes — commit-path upsert semantics", () => {
  it("inserts a new recipe when the id is not in existing", () => {
    const existing = [cheeseRecipe({ id: "r1", name: "Mozzarella Blend", brand: "Aldo's" })];
    const imported = [cheeseRecipe({ id: "r2", name: "Provolone Blend", brand: "Aldo's" })];
    const result = mergeCheeseRecipes(existing, imported);
    expect(result.length).toBe(2);
    expect(result.some(r => r.id === "r1")).toBe(true);
    expect(result.some(r => r.id === "r2")).toBe(true);
  });

  it("updates an existing recipe (overwrites) when the id already exists", () => {
    const existing = [cheeseRecipe({ id: "r1", name: "Old Name", brand: "Aldo's" })];
    const imported = [cheeseRecipe({ id: "r1", name: "New Name", brand: "Aldo's" })];
    const result = mergeCheeseRecipes(existing, imported);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("New Name");
  });

  it("preserves existing recipes that are NOT in the import (non-destructive)", () => {
    const existing = [
      cheeseRecipe({ id: "r1", name: "Mozzarella", brand: "Aldo's" }),
      cheeseRecipe({ id: "r2", name: "Provolone", brand: "Corner Booth" }),
    ];
    const imported = [cheeseRecipe({ id: "r1", name: "Mozzarella Updated", brand: "Aldo's" })];
    const result = mergeCheeseRecipes(existing, imported);
    // r2 must survive — commit does NOT wipe unrelated recipes
    expect(result.some(r => r.id === "r2" && r.name === "Provolone")).toBe(true);
    expect(result.length).toBe(2);
  });

  it("preserves existing ordering: existing recipes come first, new ones append", () => {
    const existing = [
      cheeseRecipe({ id: "r1", name: "A", brand: "X" }),
      cheeseRecipe({ id: "r2", name: "B", brand: "X" }),
    ];
    const imported = [cheeseRecipe({ id: "r3", name: "C", brand: "X" })];
    const result = mergeCheeseRecipes(existing, imported);
    expect(result.map(r => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("handles an empty import (returns existing unchanged)", () => {
    const existing = [cheeseRecipe({ id: "r1", name: "Mozzarella", brand: "Aldo's" })];
    const result = mergeCheeseRecipes(existing, []);
    expect(result).toEqual(existing);
  });

  it("handles an empty existing pool (full-insert)", () => {
    const imported = [cheeseRecipe({ id: "r1", name: "Mozzarella", brand: "Aldo's" })];
    const result = mergeCheeseRecipes([], imported);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("r1");
  });
});

// ---------------------------------------------------------------------------
// mergePremixIntoMixes — commit-path upsert semantics
// ---------------------------------------------------------------------------
describe("mergePremixIntoMixes — commit-path upsert semantics", () => {
  it("inserts a new mix when the id is not in existing", () => {
    const existing = [mix({ id: "m1", name: "Garlic Butter" })];
    const imported = [mix({ id: "m2", name: "Ranch" })];
    const result = mergePremixIntoMixes(existing, imported);
    expect(result.some(m => m.id === "m1")).toBe(true);
    expect(result.some(m => m.id === "m2")).toBe(true);
  });

  it("updates an existing mix's spec fields while preserving amountAlreadyMade", () => {
    // The floor may have partially tracked this mix; the import must not reset it.
    const existing = [mix({ id: "m1", name: "Garlic Butter", amountAlreadyMade: 42 })];
    const imported = [mix({ id: "m1", name: "Garlic Butter Updated", amountAlreadyMade: 0 })];
    const result = mergePremixIntoMixes(existing, imported);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Garlic Butter Updated");
    expect(result[0].amountAlreadyMade).toBe(42); // floor progress preserved
  });

  it("preserves enabled flag from existing (import must not re-enable a disabled mix)", () => {
    const existing = [mix({ id: "m1", name: "Ranch", enabled: false })];
    const imported = [mix({ id: "m1", name: "Ranch", enabled: true })];
    const result = mergePremixIntoMixes(existing, imported);
    expect(result[0].enabled).toBe(false);
  });

  it("preserves existing mixes that are NOT in the import (non-destructive)", () => {
    const existing = [
      mix({ id: "m1", name: "Garlic Butter" }),
      mix({ id: "m2", name: "Ranch" }),
    ];
    const imported = [mix({ id: "m1", name: "Garlic Butter v2" })];
    const result = mergePremixIntoMixes(existing, imported);
    expect(result.some(m => m.id === "m2" && m.name === "Ranch")).toBe(true);
  });

  it("handles an empty import (returns existing unchanged)", () => {
    const existing = [mix({ id: "m1", name: "Garlic Butter" })];
    const result = mergePremixIntoMixes(existing, []);
    expect(result.map(m => m.id)).toEqual(["m1"]);
  });

  it("handles an empty existing pool (full-insert)", () => {
    const imported = [mix({ id: "m1", name: "Ranch" })];
    const result = mergePremixIntoMixes([], imported);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("m1");
  });
});

// ---------------------------------------------------------------------------
// desiredFromShipping (via buildProfileAutofillPlan) — guide row priority
// ---------------------------------------------------------------------------
describe("buildProfileAutofillPlan — shipping guide row priority", () => {
  function guide(
    createdAt: number,
    rows: Array<{ brand: string; flavors?: string[]; patch: Record<string, unknown> }>,
    label = "Guide",
  ) {
    return { label, sourceKey: `guide-${createdAt}`, createdAt, rows } as never;
  }

  const NO_MIXES: ReadonlySet<string> = new Set();

  function plan(shippingGuides: ReturnType<typeof guide>[]) {
    return buildProfileAutofillPlan({
      sheets: [{ id: 1, label: "Sheet 1", sourceKey: "s1.xlsx", createdAt: 1,
        data: { ...emptyData() } as ParsedSpecImport }],
      brand: "Aldo's",
      flavor: "Pepperoni",
      current: values(),
      mixNamesLower: NO_MIXES,
      shippingGuides,
    });
  }

  it("flavor-specific row wins over brand-wide row within the same guide", () => {
    // Brand-wide says 12 pizzas/case; Pepperoni-specific says 16.
    // The flavor-specific row must win so wrong packaging doesn't get
    // suggested to the wrong flavor.
    const p = plan([
      guide(100, [
        { brand: "Aldo's", flavors: [], patch: { pizzasPerCase: 12 } },
        { brand: "Aldo's", flavors: ["Pepperoni"], patch: { pizzasPerCase: 16 } },
      ]),
    ]);
    expect(p.fills.find(f => f.field === "pizzasPerCase")?.specValue).toBe(16);
  });

  it("brand-wide row fills when there is no flavor-specific row", () => {
    const p = plan([
      guide(100, [
        { brand: "Aldo's", flavors: [], patch: { pizzasPerCase: 12 } },
      ]),
    ]);
    expect(p.fills.find(f => f.field === "pizzasPerCase")?.specValue).toBe(12);
  });

  it("brand-wide row does not fill when flavor does not match the brand", () => {
    // Guide row is for "Corner Booth", not "Aldo's" — must not fill.
    const p = plan([
      guide(100, [
        { brand: "Corner Booth", flavors: [], patch: { pizzasPerCase: 12 } },
      ]),
    ]);
    expect(p.fills.find(f => f.field === "pizzasPerCase")).toBeUndefined();
  });

  it("newest guide wins when two guides list different values for the same field", () => {
    // Guides are sorted newest-first; the first value written wins and later
    // guides cannot overwrite it (earliest import = lowest createdAt loses).
    const p = plan([
      guide(100, [{ brand: "Aldo's", flavors: [], patch: { pizzasPerCase: 12 } }]),
      guide(200, [{ brand: "Aldo's", flavors: [], patch: { pizzasPerCase: 16 } }]),
    ]);
    expect(p.fills.find(f => f.field === "pizzasPerCase")?.specValue).toBe(16);
  });

  it("fields from different guides are unioned (each guide may cover different columns)", () => {
    // Guide A supplies pizzasPerCase, guide B supplies casesPerSkid.
    // Both must appear as fills (no conflict on distinct fields).
    const p = plan([
      guide(100, [{ brand: "Aldo's", flavors: [], patch: { casesPerSkid: 40 } }]),
      guide(200, [{ brand: "Aldo's", flavors: [], patch: { pizzasPerCase: 16 } }]),
    ]);
    expect(p.fills.find(f => f.field === "pizzasPerCase")?.specValue).toBe(16);
    expect(p.fills.find(f => f.field === "casesPerSkid")?.specValue).toBe(40);
  });
});
