import { describe, it, expect, beforeEach } from "vitest";
import { saveProfile, loadProfile, profileHasRealData } from "./storage";
import { DEFAULT_VALUES } from "./types";
import type { FormValues } from "./types";

/**
 * Regression guard for the "ghost" brand/flavor profiles bug: a form whose only
 * content is a dough recipe must NOT count as a real profile, or it gets saved
 * as a permanent brand+flavor setup that the dough-ignoring spec-sheet cleanup
 * (@workspace/profile-cleanup) can't recognize as blank — so the empty setups
 * kept reappearing. Dough alone is not "real"; sauce/cheese/app/pep/die is.
 */
describe("dough-only profiles are not treated as real (ghost prevention)", () => {
  beforeEach(() => localStorage.clear());

  it("refuses to persist a form that only carries a dough recipe", () => {
    const doughOnly: FormValues = {
      ...DEFAULT_VALUES,
      doughRecipeName: "Classic Dough",
      doughRecipe: [{ name: "Flour", lbs: 50 }],
    } as FormValues;

    saveProfile("Ghost Brand", "Ghost Flavor", doughOnly);

    expect(loadProfile("Ghost Brand", "Ghost Flavor")).toBeNull();
    expect(profileHasRealData("Ghost Brand", "Ghost Flavor")).toBe(false);
  });

  it("still persists a form with a real sauce recipe", () => {
    const withSauce: FormValues = {
      ...DEFAULT_VALUES,
      doughRecipeName: "Classic Dough",
      frontlineRecipeName: "Mystic Pizza Sauce",
    } as FormValues;

    saveProfile("Real Brand", "Real Flavor", withSauce);

    expect(loadProfile("Real Brand", "Real Flavor")).not.toBeNull();
    expect(profileHasRealData("Real Brand", "Real Flavor")).toBe(true);
  });

  it("still persists a form with a real applicator topping", () => {
    const withTopping: FormValues = {
      ...DEFAULT_VALUES,
      doughRecipeName: "Classic Dough",
      app1Type: "Diced Pepperoni",
      app1OzPerPizza: 0.5,
    } as FormValues;

    saveProfile("Meat Brand", "Pepp", withTopping);

    expect(profileHasRealData("Meat Brand", "Pepp")).toBe(true);
  });
});
