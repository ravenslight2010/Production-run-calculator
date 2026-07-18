import { describe, expect, it } from "vitest";
import { stripPurchasedCrustDie } from "./index";

describe("stripPurchasedCrustDie", () => {
  it("moves a crust-named dieType into an empty doughName and clears the die (Mauro's Pinsa shape)", () => {
    const out = stripPurchasedCrustDie<{ dieType?: string; doughName?: string }>({
      dieType: 'Pedone Crust 7"x12" Oval',
    });
    expect(out.dieType).toBeUndefined();
    expect(out.doughName).toBe('Pedone Crust 7"x12" Oval');
  });

  it("clears a crust-named dieType without overwriting an existing doughName", () => {
    const out = stripPurchasedCrustDie({
      dieType: "Parbake Crust (Bonici 12\")",
      doughName: 'Bonici 12"',
    });
    expect(out.dieType).toBeUndefined();
    expect(out.doughName).toBe('Bonici 12"');
  });

  it("clears a size die minted from a purchased-crust doughName (Lucia's Pinsa shape)", () => {
    const out = stripPurchasedCrustDie({
      dieType: '12"',
      doughName: 'Pinsa 12" Crust - Pedone (WBF-1200-R)',
    });
    expect(out.dieType).toBeUndefined();
    expect(out.doughName).toBe('Pinsa 12" Crust - Pedone (WBF-1200-R)');
  });

  it("keeps the die when the dough name is an in-house recipe/dough", () => {
    for (const doughName of ["CRB Recipe", "Ultra Thin Dough", "Thin Crust Dough"]) {
      const p = { dieType: '12"', doughName };
      expect(stripPurchasedCrustDie(p)).toBe(p);
    }
  });

  it("keeps a real die alongside a crust name that mentions dies", () => {
    const p = { dieType: "Argus Dies", doughName: 'Crust (CRB - 12" Dies)' };
    expect(stripPurchasedCrustDie(p)).toBe(p);
  });

  it("returns the same object when there is nothing to do", () => {
    const empty = {};
    expect(stripPurchasedCrustDie(empty)).toBe(empty);
    const noDie = { doughName: 'Pinsa 12" Crust' };
    expect(stripPurchasedCrustDie(noDie)).toBe(noDie);
    const normal = { dieType: "11in", doughName: "Masa Dough" };
    expect(stripPurchasedCrustDie(normal)).toBe(normal);
  });
});
