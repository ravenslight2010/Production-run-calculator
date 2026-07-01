import { describe, it, expect } from "vitest";
import {
  buildParseSpecSheetPrompt,
  type ParseSpecSheetInput,
} from "./aiParseSpecSheet";

function input(overrides: Partial<ParseSpecSheetInput> = {}): ParseSpecSheetInput {
  return {
    workbookText: "Brand\tFlavor\tSize\nLowes\tPepperoni\t7in\n",
    ...overrides,
  } as ParseSpecSheetInput;
}

// Regression guard for the spec-sheet importer BRAND rule. The primary
// differentiator is the product-line header (e.g. "Basha's Original" vs
// "Basha's Ultra Thin Crust"): those must stay separate brands and never
// collapse to a bare company name, or their identical flavor names overwrite
// each other. Folding SIZE into the brand ("Lowes 7in") is only the fallback
// when a sheet has no product-line qualifier. The instructions live in the
// system prompt; these tests pin them so they can't be silently dropped.
describe("buildParseSpecSheetPrompt brand rule", () => {
  it("keeps the full product-line brand and never collapses to a bare company name", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // Distinguishing product-line qualifiers are kept in the brand.
    expect(system).toContain("product-line");
    expect(system).toContain("Ultra Thin");
    // Worked example: two product lines from one company are distinct brands.
    expect(system).toContain("brand='Basha's Original'");
    expect(system).toContain("brand='Basha's Ultra Thin Crust'");
    // The explicit anti-pattern it must avoid.
    expect(system).toContain("never");
    expect(system).toContain("bare company name");
    // And it must not re-collapse via a shorter KNOWN brand match.
    expect(system).toContain("Do NOT match a qualified");
  });

  it("still folds SIZE into the brand as the fallback (never into the flavor)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("size INTO THE BRAND");
    expect(system).toContain("brand='Lowes 7in'");
    expect(system).toContain("flavor='Pepperoni'");
    expect(system).toContain("NOT brand='Lowes', flavor='7in Pepperoni'");
  });

  it("applies the same brand rule to recipes and targets", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("recipe brand/flavor and `targets` the same way");
  });
});
