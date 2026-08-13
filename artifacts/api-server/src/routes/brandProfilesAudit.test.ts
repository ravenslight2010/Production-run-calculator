// Unit tests for the applicator-audit contamination-detection logic.
//
// `computeApplicatorAudit` is a pure function (no DB) that takes a list of
// profile objects and returns the AuditItems it detects. Tests here seed a
// small set of mock profiles and assert that each of the three signals fires
// exactly when expected — and that legitimate same-brand stacking is NOT flagged.

import { describe, it, expect } from "vitest";
import { computeApplicatorAudit } from "./brandProfiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProfileValues = Record<string, unknown>;

function profile(
  brand: string,
  flavor: string,
  values: ProfileValues = {},
) {
  return {
    key: `${brand.toLowerCase()}__${flavor.toLowerCase()}`,
    brand,
    flavor,
    values,
  };
}

// ---------------------------------------------------------------------------
// Signal 1: cross-profile
// ---------------------------------------------------------------------------

describe("computeApplicatorAudit — Signal 1: cross-profile", () => {
  it("flags app3 when its recipe is the primary (app1) of a DIFFERENT profile", () => {
    const profiles = [
      // Profile A owns "Mozz Blend" as its primary app1.
      profile("Basha's", "Pepperoni", {
        app1CheeseRecipeName: "Mozz Blend",
      }),
      // Profile B incorrectly has "Mozz Blend" at app3.
      profile("Basha's", "BBQ Chicken", {
        app3CheeseRecipeName: "Mozz Blend",
        app3Type: "cheese",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "basha's__bbq chicken",
      slot: "app3",
      recipeName: "Mozz Blend",
      reason: "cross-profile",
    });
  });

  it("flags app4 when its recipe is primary (app2) on another profile", () => {
    const profiles = [
      profile("Craft", "Supreme", { app2CheeseRecipeName: "Four Cheese Blend" }),
      profile("Craft", "Margherita", {
        app4CheeseRecipeName: "Four Cheese Blend",
        app4Type: "cheese",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slot: "app4",
      recipeName: "Four Cheese Blend",
      reason: "cross-profile",
    });
  });

  it("does NOT flag when the recipe appears as primary on BOTH this profile AND another (shared primary)", () => {
    // Two profiles genuinely share the same app1 recipe — not contamination.
    const profiles = [
      profile("Brand A", "Pepperoni", { app1CheeseRecipeName: "Shared Blend" }),
      // This profile lists "Shared Blend" at both app1 AND app3 — own-primary exclusion applies.
      profile("Brand A", "Supreme", {
        app1CheeseRecipeName: "Shared Blend",
        app3CheeseRecipeName: "Shared Blend",
        app3Type: "cheese",
      }),
    ];

    // The second profile's app3 is its OWN primary — must not be flagged.
    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(0);
  });

  it("does NOT flag when there are no other profiles that own the recipe as primary", () => {
    // Only one profile in the pool — nothing else to contaminate from.
    const profiles = [
      profile("Solo Brand", "Pepperoni", {
        app1CheeseRecipeName: "Mozz",
        app3CheeseRecipeName: "Extra Blend",
        app3Type: "cheese",
      }),
    ];

    // "Extra Blend" is not primary on ANY profile, so no cross-profile signal.
    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(0);
  });

  it("is case-insensitive when matching recipe names across profiles", () => {
    const profiles = [
      profile("Alpha", "Classic", { app1CheeseRecipeName: "MOZZ BLEND" }),
      profile("Alpha", "Deluxe", {
        app3CheeseRecipeName: "mozz blend",
        app3Type: "cheese",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe("cross-profile");
  });
});

// ---------------------------------------------------------------------------
// Signal 2: cross-brand
// ---------------------------------------------------------------------------

describe("computeApplicatorAudit — Signal 2: cross-brand", () => {
  it("flags app3 when the recipe name contains a different brand's name substring", () => {
    const profiles = [
      // Hannaford profile — contributes "hannaford" to the brand-name set.
      profile("Hannaford", "Pepperoni", { app1CheeseRecipeName: "Hannaford Mozz" }),
      // Craft profile has a Hannaford-named recipe at app3 — wrong brand.
      profile("Craft", "Supreme", {
        app3CheeseRecipeName: "Hannaford BBQ Chicken",
        app3Type: "cheese",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "craft__supreme",
      slot: "app3",
      recipeName: "Hannaford BBQ Chicken",
      reason: "cross-brand",
    });
  });

  it("does NOT flag when the recipe name contains the SAME profile's own brand", () => {
    const profiles = [
      profile("Hannaford", "BBQ Chicken", {
        app1CheeseRecipeName: "Hannaford Mozz",
        app3CheeseRecipeName: "Hannaford Gouda Blend",
        app3Type: "cheese",
      }),
    ];

    // The brand substring matches the profile's OWN brand — not contamination.
    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(0);
  });

  it("excludes short brand names (≤ 3 chars) from the brand-name set to avoid false positives", () => {
    // Brand "Red" is ≤ 3 chars — should NOT trigger a cross-brand flag.
    const profiles = [
      profile("Red", "Classic", { app1CheeseRecipeName: "Red Special Blend" }),
      profile("BrandB", "Supreme", {
        app3CheeseRecipeName: "Hot Red Pepper Blend",
        app3Type: "cheese",
      }),
    ];

    // "red" is ≤ 3 chars so it is NOT in the brand-name set.
    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(0);
  });

  it("is case-insensitive when matching brand names in recipe name substrings", () => {
    const profiles = [
      profile("Lucia's", "Classic", { app1CheeseRecipeName: "Lucia's Blend" }),
      profile("OtherBrand", "Supreme", {
        app3CheeseRecipeName: "LUCIA'S Red Hot Chicken",
        app3Type: "cheese",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe("cross-brand");
  });
});

// ---------------------------------------------------------------------------
// Signal 3: orphaned-type
// ---------------------------------------------------------------------------

describe("computeApplicatorAudit — Signal 3: orphaned-type", () => {
  it("flags app3 when app3Type is set but app3CheeseRecipeName is blank", () => {
    const profiles = [
      profile("Basha's", "Pepperoni", {
        app3Type: "cheese",
        app3CheeseRecipeName: "",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "basha's__pepperoni",
      slot: "app3",
      recipeName: "",
      appType: "cheese",
      reason: "orphaned-type",
    });
  });

  it("flags app4 when app4Type is set but app4CheeseRecipeName is blank", () => {
    const profiles = [
      profile("Craft", "Supreme", {
        app4Type: "Pepperoni",
        app4CheeseRecipeName: "",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slot: "app4",
      appType: "Pepperoni",
      reason: "orphaned-type",
    });
  });

  it("does NOT flag when app3Type is 'none' (explicit empty slot)", () => {
    const profiles = [
      profile("Basha's", "Pepperoni", {
        app3Type: "none",
        app3CheeseRecipeName: "",
      }),
    ];

    expect(computeApplicatorAudit(profiles)).toHaveLength(0);
  });

  it("does NOT flag when app3Type is 'None' (case-insensitive)", () => {
    const profiles = [
      profile("Basha's", "Pepperoni", {
        app3Type: "None",
        app3CheeseRecipeName: "",
      }),
    ];

    expect(computeApplicatorAudit(profiles)).toHaveLength(0);
  });

  it("does NOT flag when app3Type is 'mix' (a valid empty-recipe mix slot)", () => {
    const profiles = [
      profile("Basha's", "Pepperoni", {
        app3Type: "mix",
        app3CheeseRecipeName: "",
      }),
    ];

    expect(computeApplicatorAudit(profiles)).toHaveLength(0);
  });

  it("does NOT flag when app3Type is blank (slot is genuinely empty)", () => {
    const profiles = [
      profile("Craft", "Supreme", {
        app3Type: "",
        app3CheeseRecipeName: "",
      }),
    ];

    expect(computeApplicatorAudit(profiles)).toHaveLength(0);
  });

  it("does NOT flag when app3Type is absent (undefined)", () => {
    const profiles = [
      profile("Craft", "Supreme", {
        app3CheeseRecipeName: "",
      }),
    ];

    expect(computeApplicatorAudit(profiles)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ownPrimary exclusion: same-brand stacking at app3/4 must not be flagged
// ---------------------------------------------------------------------------

describe("computeApplicatorAudit — ownPrimary exclusion", () => {
  it("does NOT flag app3 when it holds the same recipe as this profile's own app1", () => {
    // A profile with app1 AND app3 both set to "Mozz Blend" (legitimate stacking).
    const profiles = [
      profile("Basha's", "Pepperoni", {
        app1CheeseRecipeName: "Mozz Blend",
        app3CheeseRecipeName: "Mozz Blend",
        app3Type: "cheese",
      }),
      // Another profile also has "Mozz Blend" as primary (so it IS in primaryOwners
      // mapped to a different key) — the ownPrimary exclusion must still protect.
      profile("Basha's", "Supreme", {
        app1CheeseRecipeName: "Mozz Blend",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    // Neither profile should be flagged — both own "Mozz Blend" as a primary.
    expect(items).toHaveLength(0);
  });

  it("does NOT flag app4 when it holds the same recipe as this profile's own app2", () => {
    const profiles = [
      // Profile A: app2 = "Sharp Cheddar", app4 = "Sharp Cheddar" → own primary.
      profile("Alpha", "Classic", {
        app2CheeseRecipeName: "Sharp Cheddar",
        app4CheeseRecipeName: "Sharp Cheddar",
        app4Type: "cheese",
      }),
      // Profile B also uses "Sharp Cheddar" as primary.
      profile("Beta", "Supreme", {
        app1CheeseRecipeName: "Sharp Cheddar",
      }),
    ];

    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple signals in one call
// ---------------------------------------------------------------------------

describe("computeApplicatorAudit — multiple signals coexist", () => {
  it("returns one item per flagged (profile, slot) pair across all signal types", () => {
    const profiles = [
      // Profile A: contributes primary "Hannaford Mozz" and brand "hannaford".
      profile("Hannaford", "Classic", {
        app1CheeseRecipeName: "Hannaford Mozz",
      }),
      // Profile B: cross-profile at app3, orphaned-type at app4.
      profile("Craft", "Supreme", {
        app3CheeseRecipeName: "Hannaford Mozz",
        app3Type: "cheese",
        app4CheeseRecipeName: "",
        app4Type: "Pepperoni",
      }),
      // Profile C: cross-brand at app3 (Hannaford recipe on non-Hannaford profile).
      profile("BrandXYZ", "Deluxe", {
        app3CheeseRecipeName: "Hannaford BBQ Chicken",
        app3Type: "cheese",
      }),
    ];

    const items = computeApplicatorAudit(profiles);

    // Profile B app3 → cross-profile, Profile B app4 → orphaned-type,
    // Profile C app3 → cross-brand.
    expect(items).toHaveLength(3);

    const reasons = items.map((i) => i.reason).sort();
    expect(reasons).toEqual(["cross-brand", "cross-profile", "orphaned-type"]);
  });

  it("returns an empty list when all profiles are clean", () => {
    const profiles = [
      profile("Basha's", "Pepperoni", {
        app1CheeseRecipeName: "Mozz Blend",
        app2CheeseRecipeName: "Provolone Mix",
      }),
      profile("Craft", "Supreme", {
        app1CheeseRecipeName: "Craft Blend",
        app3CheeseRecipeName: "Craft Blend",
        app3Type: "cheese",
      }),
    ];

    expect(computeApplicatorAudit(profiles)).toHaveLength(0);
  });

  it("handles an empty profile list without error", () => {
    expect(computeApplicatorAudit([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("computeApplicatorAudit — edge cases", () => {
  it("treats missing values fields (undefined) as blank strings without throwing", () => {
    const profiles = [
      profile("Brand A", "Classic", {
        // app3CheeseRecipeName intentionally absent
        app3Type: "cheese",
      }),
    ];

    // app3Type set but recipe absent (treated as blank) → orphaned-type.
    const items = computeApplicatorAudit(profiles);
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe("orphaned-type");
  });

  it("handles profiles with no values keys at all without throwing", () => {
    const profiles = [profile("Brand A", "Classic", {})];
    expect(computeApplicatorAudit(profiles)).toEqual([]);
  });

  it("does not flag cross-profile when the profile is the ONLY owner of the recipe name", () => {
    // "Unique Blend" is only at app1 of profile A and also at app3 of profile A —
    // but since A is the only owner, it is caught by the ownPrimary exclusion.
    const profiles = [
      profile("Brand A", "Classic", {
        app1CheeseRecipeName: "Unique Blend",
        app3CheeseRecipeName: "Unique Blend",
        app3Type: "cheese",
      }),
    ];

    expect(computeApplicatorAudit(profiles)).toHaveLength(0);
  });
});
