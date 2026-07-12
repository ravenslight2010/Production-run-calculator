// applySpecImportBlendNameAliases — learned "appType" (blend-name) aliases
// rename cheese/mix RECIPES and their matching profile applicator slots in
// LOCKSTEP at prepare time, so a re-import remembers the user's prior
// review-time link/rename without ever disconnecting a slot from its recipe.

import { describe, it, expect } from "vitest";
import {
  applySpecImportBlendNameAliases,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedSpecImport,
  type SpecImportAlias,
} from "./index";

const profile = (over: Partial<ParsedProfile>): ParsedProfile => ({
  brand: "Aldo's",
  flavor: "Cheese",
  applicators: [],
  pepperonis: [],
  ...over,
});

const cheeseRecipe = (over: Partial<ParsedRecipe>): ParsedRecipe => ({
  kind: "cheese",
  name: "Sheet Blend",
  rows: [{ ingredient: "Mozzarella", lbs: 10 }],
  ...over,
});

const appTypeAlias = (
  externalName: string,
  canonicalName: string,
): SpecImportAlias => ({ kind: "appType", externalName, canonicalName, context: null });

describe("applySpecImportBlendNameAliases", () => {
  it("renames a cheese recipe AND its matching applicator slots together", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        profile({
          applicators: [
            { type: "Sheet Blend", ozPerPizza: 2 },
            { type: "Shredded Mozz", ozPerPizza: 1 },
          ],
        }),
      ],
      recipes: [cheeseRecipe({})],
    };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Sheet Blend", "House Blend"),
    ]);
    expect(out.recipes[0].name).toBe("House Blend");
    expect(out.profiles[0].applicators[0].type).toBe("House Blend");
    // Unrelated slot untouched.
    expect(out.profiles[0].applicators[1].type).toBe("Shredded Mozz");
  });

  it("matches slots loosely (case/punctuation/cleaning) so cleaned variants follow too", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        profile({
          applicators: [{ type: "Applicator - SHEET  BLEND 2.07", ozPerPizza: 2 }],
        }),
      ],
      recipes: [cheeseRecipe({})],
    };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Sheet Blend", "House Blend"),
    ]);
    expect(out.recipes[0].name).toBe("House Blend");
    expect(out.profiles[0].applicators[0].type).toBe("House Blend");
  });

  it("mix-routed (cheese-kind) recipes rename too — raw name lookup, no cleaning needed", () => {
    const parsed: ParsedSpecImport = {
      profiles: [profile({ applicators: [{ type: "Seasoning Mix", ozPerPizza: 1 }] })],
      recipes: [cheeseRecipe({ name: "Seasoning Mix", forcedCategory: "mix" })],
    };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Seasoning Mix", "House Seasoning Mix"),
    ]);
    expect(out.recipes[0].name).toBe("House Seasoning Mix");
    expect(out.profiles[0].applicators[0].type).toBe("House Seasoning Mix");
  });

  it("alias saved against the CLEANED cheese name still hits a raw sheet variant", () => {
    // The recipe name arrives with an embedded weight; the alias was learned
    // from the review (cleaned) name. The cleaned-name fallback must hit.
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [cheeseRecipe({ name: "Sheet Blend 2.07 oz" })],
    };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Sheet Blend", "House Blend"),
    ]);
    expect(out.recipes[0].name).toBe("House Blend");
  });

  it("never rewrites a user-typed (userNamed) recipe name", () => {
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [cheeseRecipe({ userNamed: true })],
    };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Sheet Blend", "House Blend"),
    ]);
    expect(out.recipes[0].name).toBe("Sheet Blend");
  });

  it("dough/sauce recipes are never touched by blend-name aliases", () => {
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [
        { kind: "dough", name: "Sheet Blend", rows: [] },
        { kind: "sauce", name: "Sheet Blend", rows: [] },
      ],
    };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Sheet Blend", "House Blend"),
    ]);
    expect(out.recipes[0].name).toBe("Sheet Blend");
    expect(out.recipes[1].name).toBe("Sheet Blend");
  });

  it("conflicting (cyclic) aliases are dropped, not applied", () => {
    const parsed: ParsedSpecImport = { profiles: [], recipes: [cheeseRecipe({})] };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Sheet Blend", "House Blend"),
      appTypeAlias("House Blend", "Sheet Blend"),
    ]);
    expect(out.recipes[0].name).toBe("Sheet Blend");
    expect(out).toBe(parsed); // identity when nothing renames
  });

  it("no matching alias → same object back (identity, no spurious rewrites)", () => {
    const parsed: ParsedSpecImport = { profiles: [], recipes: [cheeseRecipe({})] };
    expect(applySpecImportBlendNameAliases(parsed, [])).toBe(parsed);
    expect(
      applySpecImportBlendNameAliases(parsed, [appTypeAlias("Other", "Thing")]),
    ).toBe(parsed);
  });

  it("does NOT rename a slot that only matches the alias but no in-import recipe", () => {
    // Slot-only sheets (no cheese recipe parsed) keep their type verbatim —
    // renaming the type without a recipe present is the ordinary appType
    // canonicalize pass's decision, not this one's.
    const parsed: ParsedSpecImport = {
      profiles: [profile({ applicators: [{ type: "Sheet Blend", ozPerPizza: 2 }] })],
      recipes: [],
    };
    const out = applySpecImportBlendNameAliases(parsed, [
      appTypeAlias("Sheet Blend", "House Blend"),
    ]);
    expect(out).toBe(parsed);
  });
});
