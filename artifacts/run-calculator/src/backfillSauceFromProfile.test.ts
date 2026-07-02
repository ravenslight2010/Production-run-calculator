// @vitest-environment jsdom
//
// Regression guard for the scheduled-run sauce backfill. Scheduled/imported
// runs snapshot the brand profile at scheduling time, so a sauce recipe added
// to the profile AFTERWARD never reached them (the user saw applicator fields
// "auto-apply" while the sauce stayed blank). `backfillSauceFromProfile` fills
// ONLY blank sauce fields from the CURRENT saved profile at pull-up/save time
// and must never overwrite a sauce the run already carries.

import { describe, it, expect, beforeEach } from "vitest";
import { backfillSauceFromProfile } from "./storage";
import { PROFILE_KEY, DEFAULT_VALUES, type FormValues } from "./types";

const BRAND = "Corner Booth";
const FLAVOR = "MEAT LOVER";

function seedProfile(extra: Partial<FormValues>): void {
  localStorage.setItem(
    PROFILE_KEY(BRAND, FLAVOR),
    JSON.stringify({ ...DEFAULT_VALUES, ...extra }),
  );
}

const PROFILE_SAUCE: Partial<FormValues> = {
  frontlineRecipeName: "Mystic Pizza Sauce",
  frontlineRecipe: [{ ingredient: "Tomato Paste", lbs: 120 }],
  sauceOzPerPizza: 6,
};

describe("backfillSauceFromProfile", () => {
  beforeEach(() => localStorage.clear());

  it("fills blank sauce fields from the current profile", () => {
    seedProfile(PROFILE_SAUCE);
    const out = backfillSauceFromProfile({ ...DEFAULT_VALUES }, BRAND, FLAVOR);
    expect(out.frontlineRecipeName).toBe("Mystic Pizza Sauce");
    expect(out.frontlineRecipe).toEqual([{ ingredient: "Tomato Paste", lbs: 120 }]);
    expect(out.sauceOzPerPizza).toBe(6);
  });

  it("never overwrites a run that already has a sauce name", () => {
    seedProfile(PROFILE_SAUCE);
    const vals: FormValues = { ...DEFAULT_VALUES, frontlineRecipeName: "House Red", sauceOzPerPizza: 5 };
    const out = backfillSauceFromProfile(vals, BRAND, FLAVOR);
    expect(out.frontlineRecipeName).toBe("House Red");
    expect(out.frontlineRecipe).toEqual(DEFAULT_VALUES.frontlineRecipe);
    expect(out.sauceOzPerPizza).toBe(5);
  });

  it("treats recipe rows with lbs>0 as an existing sauce even without a name", () => {
    seedProfile(PROFILE_SAUCE);
    const vals: FormValues = {
      ...DEFAULT_VALUES,
      frontlineRecipe: [{ ingredient: "Crushed Tomatoes", lbs: 80 }],
    };
    const out = backfillSauceFromProfile(vals, BRAND, FLAVOR);
    expect(out.frontlineRecipeName).toBe("");
    expect(out.frontlineRecipe).toEqual([{ ingredient: "Crushed Tomatoes", lbs: 80 }]);
  });

  it("keeps a positive stored sauceOzPerPizza when only oz differs", () => {
    seedProfile(PROFILE_SAUCE);
    const vals: FormValues = { ...DEFAULT_VALUES, sauceOzPerPizza: 4 };
    const out = backfillSauceFromProfile(vals, BRAND, FLAVOR);
    // Sauce name/rows blank → backfilled; but the positive oz is preserved.
    expect(out.frontlineRecipeName).toBe("Mystic Pizza Sauce");
    expect(out.sauceOzPerPizza).toBe(4);
  });

  it("is a no-op when the profile has no sauce either", () => {
    seedProfile({});
    const vals = { ...DEFAULT_VALUES };
    const out = backfillSauceFromProfile(vals, BRAND, FLAVOR);
    expect(out).toEqual(vals);
  });

  it("is a no-op when no profile exists or brand is missing", () => {
    const vals = { ...DEFAULT_VALUES };
    expect(backfillSauceFromProfile(vals, BRAND, FLAVOR)).toEqual(vals);
    expect(backfillSauceFromProfile(vals, undefined, FLAVOR)).toEqual(vals);
  });
});
