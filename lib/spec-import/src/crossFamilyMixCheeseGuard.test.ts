// The mix ↔ cheese-family crossing guard: an appType alias that adds/removes
// the word "cheese" between a mix-family and cheese-family name renames a
// DIFFERENT product (prod incident: `appType: "Bobo Breakfast Mix" →
// "Bobo's Breakfast Cheese Mix"` swapped the egg/bacon premix for the
// mozzarella blend on every re-import). Such pairs must never be applied
// (sanitizeSpecAliases) nor learned (applySpecMatches).
import { describe, expect, it } from "vitest";

import {
  isCrossFamilyMixCheesePair,
  sanitizeSpecAliases,
  applyNameMatches,
  type SpecImportAlias,
  type ParsedSpecImport,
} from "./index";

describe("isCrossFamilyMixCheesePair", () => {
  it("flags mix-family vs cheese-family names (the Bobo incident pair)", () => {
    expect(isCrossFamilyMixCheesePair("Bobo Breakfast Mix", "Bobo's Breakfast Cheese Mix")).toBe(true);
    expect(isCrossFamilyMixCheesePair("Bobo's Breakfast Cheese Mix", "Bobo Breakfast Mix")).toBe(true);
    expect(isCrossFamilyMixCheesePair("Cheeseburger Mix", "Cheeseburger Cheese Mix")).toBe(true);
  });

  it("does not flag same-family or neutral names", () => {
    // Both cheese-family (a "cheese mix" IS cheese-family — cheese wins).
    expect(isCrossFamilyMixCheesePair("Bobo Breakfast Cheese", "Bobo's Breakfast Cheese Mix")).toBe(false);
    // Both mix-family.
    expect(isCrossFamilyMixCheesePair("Red Hot Mix", "Lowe's Red Hot Chicken Mix")).toBe(false);
    // Neutral side ("cheeseburger" is one token, not "cheese"; "Blend" is neither).
    expect(isCrossFamilyMixCheesePair("Cheeseburger Cheese Mix", "Cheeseburger Blend")).toBe(false);
    expect(isCrossFamilyMixCheesePair("Whole Mozzarella", "Whole Milk Mozzarella")).toBe(false);
    // Neutral vs mix — one side has no family token.
    expect(isCrossFamilyMixCheesePair("Sausage", "Sausage Mix")).toBe(false);
  });
});

describe("sanitizeSpecAliases cross-family rule", () => {
  const alias = (
    kind: SpecImportAlias["kind"],
    externalName: string,
    canonicalName: string,
  ): SpecImportAlias => ({ kind, externalName, canonicalName, context: null });

  it("drops cross-family appType aliases and keeps same-family ones", () => {
    const poison = alias("appType", "Bobo Breakfast Mix", "Bobo's Breakfast Cheese Mix");
    const fine = alias("appType", "Bobo Breakfast Cheese", "Bobo's Breakfast Cheese Mix");
    const kept = sanitizeSpecAliases([poison, fine]);
    expect(kept).toEqual([fine]);
  });

  it("leaves non-appType kinds alone (recipeName picks may cross)", () => {
    const recipePick = alias("recipeName", "Bobo Breakfast Mix", "Bobo's Breakfast Cheese Mix");
    expect(sanitizeSpecAliases([recipePick])).toEqual([recipePick]);
  });
});

describe("applyNameMatches appType learn loop", () => {
  it("never learns a cross-family appType pair, still learns same-family ones", () => {
    const parsed: ParsedSpecImport = { profiles: [], recipes: [] } as unknown as ParsedSpecImport;
    const { aliases } = applyNameMatches(parsed, [], [], {
      appTypeMatches: [
        { candidate: "Bobo Breakfast Mix", match: "Bobo's Breakfast Cheese Mix" },
        { candidate: "Bobo Breakfast Cheese", match: "Bobo's Breakfast Cheese Mix" },
      ],
    });
    const appTypes = aliases.filter((a) => a.kind === "appType");
    expect(appTypes).toHaveLength(1);
    expect(appTypes[0].externalName).toBe("Bobo Breakfast Cheese");
  });
});
