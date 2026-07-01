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

// Regression guard: the prompt must NOT hand the model incoherent (cyclic/
// chained) learned aliases. A polluted pool (e.g. CHICKEN TIKKA MASALA =>
// Red Hot Chicken alongside Red Hot Chicken => Red Hot, and a PEPPERONI <=>
// ULTIMATE PEPPERONI cycle) previously made the AI mis-rename and collide
// valid flavors so imports produced nothing. The de-confliction guard must
// strip those before they reach the model, while keeping coherent aliases.
describe("buildParseSpecSheetPrompt alias de-confliction", () => {
  it("drops cyclic/chained aliases but keeps coherent ones", () => {
    const { user } = buildParseSpecSheetPrompt(
      input({
        aliases: [
          { kind: "flavor", externalName: "CHICKEN TIKKA MASALA", canonicalName: "Red Hot Chicken", context: null },
          { kind: "flavor", externalName: "Red Hot Chicken", canonicalName: "Red Hot", context: null },
          { kind: "flavor", externalName: "PEPPERONI", canonicalName: "ULTIMATE PEPPERONI", context: null },
          { kind: "flavor", externalName: "ULTIMATE PEPPERONI", canonicalName: "PEPPERONI", context: null },
          { kind: "flavor", externalName: "Buffalo Chicken", canonicalName: "BBQ Chicken", context: null },
        ],
      } as Partial<ParseSpecSheetInput>),
    );
    expect(user).not.toContain("Red Hot Chicken");
    expect(user).not.toContain("ULTIMATE PEPPERONI");
    expect(user).not.toContain("CHICKEN TIKKA MASALA");
    // The coherent alias survives.
    expect(user).toContain('"Buffalo Chicken" => "BBQ Chicken"');
  });

  it("omits the alias block entirely when every alias is conflicting", () => {
    const { user } = buildParseSpecSheetPrompt(
      input({
        aliases: [
          { kind: "flavor", externalName: "PEPPERONI", canonicalName: "ULTIMATE PEPPERONI", context: null },
          { kind: "flavor", externalName: "ULTIMATE PEPPERONI", canonicalName: "PEPPERONI", context: null },
        ],
      } as Partial<ParseSpecSheetInput>),
    );
    expect(user).not.toContain("KNOWN ALIASES");
  });
});

// Regression guard for the numeric-accuracy rule: the model must copy numbers
// verbatim and never swap per-pizza ounces with recipe pounds. Pinned here so
// the instruction can't be silently dropped from the prompt.
describe("buildParseSpecSheetPrompt numeric accuracy", () => {
  it("tells the model to read numbers exactly and never swap oz/lbs units", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("READ NUMBERS EXACTLY");
    expect(system).toContain("never round");
    expect(system).toContain("NEVER swap units");
    expect(system).toContain("per-pizza ounce");
  });
});
