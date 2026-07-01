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

// Regression guard for the standalone-procedure rule. A sheet that is one whole
// sauce/dough/cheese procedure for a single product line (brand in the title,
// no per-flavor grid) must produce a brand-only recipe (flavor + targets EMPTY)
// so it attaches to every flavor of that brand — never a targetless recipe (which
// attaches to nothing) or an invented "Dough" flavor / size-suffixed brand.
describe("buildParseSpecSheetPrompt standalone procedure rule", () => {
  it("tells the model to take the brand from the title and leave flavor/targets empty", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("standalone PROCEDURE");
    expect(system).toContain("BRAND from the sheet title or tab name");
    expect(system).toContain("LEAVE `flavor` EMPTY and `targets` EMPTY");
    // Explicit anti-patterns it must avoid.
    expect(system).toContain("Do NOT " + "invent a placeholder flavor like 'Dough'");
    expect(system).toContain("do NOT fold the size into the");
    // But an explicit per-flavor cheese-tab mapping still populates targets.
    expect(system).toContain("EXPLICITLY maps a recipe to");
  });

  it("distinguishes a customer/product-line title from a sauce/dough TYPE title", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // A recipe-TYPE title (no customer) must not become a junk brand.
    expect(system).toContain("distinguish a CUSTOMER/product-line name from a SAUCE/DOUGH");
    expect(system).toContain("is NOT a brand");
    expect(system).toContain("LEAVE `brand` EMPTY");
    // A body note naming customers routes to targets, not a guessed brand.
    expect(system).toContain("This recipe used for Hannaford and Lucia");
  });

  it("forbids inventing a flavor for a shared procedure (whole-brand empty precedence)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // Shared-procedure customer notes must never fabricate a specific flavor.
    expect(system).toContain("NEVER invent or guess a specific flavor");
    expect(system).toContain("do not turn 'Masa' into 'Masala'");
    // The older no-known-flavors fallback must also leave the flavor empty, not
    // guess a "best reading" flavor (older contradictory wording removed).
    expect(system).toContain("add ONE whole-brand target with the `flavor` LEFT EMPTY");
    expect(system).not.toContain("best reading of its brand and flavor");
  });

  it("splits a multi-customer brand cell but keeps a single '&' company name whole", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // "Lucia's Craft & 4Hands" must fan out into one target per customer...
    expect(system).toContain("SPLIT it into one target PER");
    // ...while a legitimate single '&' company name stays one brand.
    expect(system).toContain("Maria & Son");
  });

  it("reads a doughball/yield table as per-customer targets (parenthesized flavor optional)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("Hannaford (Masala Pizza)");
    expect(system).toContain("flavor = the parenthesized");
  });

  it("keeps a standalone procedure's full title as the name (no junk first-word brand)", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // 'MYSTIC PIZZA SAUCE PROCEDURE' -> name 'Mystic Pizza Sauce', not brand 'Mystic'.
    expect(system).toContain("Mystic Pizza Sauce");
    expect(system).toContain("do NOT peel the first");
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
