// @vitest-environment jsdom
//
// Apply-path brand canonicalization contract. A parse saved BEFORE the
// sanitizer's known-brand snap can carry a punctuation-typo brand (`Aldo"s`
// for the real `Aldo's`). Re-applying such a parse must update the EXISTING
// brand's profile — never mint a near-duplicate brand.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applySpecImport,
  loadProfile,
  saveProfile,
  saveBrandFlavors,
  loadBrandFlavors,
  DEFAULT_VALUES,
} from "./storage";
import type { ParsedSpecImport } from "@workspace/spec-import";

beforeEach(() => {
  localStorage.clear();
});

function typoBrandImport(): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: 'Aldo"s',
        flavor: "SAUSAGE",
        sauceOzPerPizza: 4,
        sauceName: "Aldo Pizza Sauce",
        applicators: [],
        pepperonis: [],
      },
    ],
    recipes: [],
  } as unknown as ParsedSpecImport;
}

describe("applySpecImport brand canonicalization onto existing spellings", () => {
  it("updates the existing Aldo's profile instead of minting an Aldo\"s brand", () => {
    saveBrandFlavors({ "Aldo's": ["SAUSAGE"] });
    saveProfile("Aldo's", "SAUSAGE", { ...DEFAULT_VALUES });

    const touched = applySpecImport(typoBrandImport());

    expect(touched).toEqual([{ brand: "Aldo's", flavor: "SAUSAGE" }]);
    const prof = loadProfile("Aldo's", "SAUSAGE");
    expect(prof?.sauceOzPerPizza).toBe(4);
    expect(prof?.frontlineRecipeName).toBe("Aldo Pizza Sauce");
    // No near-duplicate brand appeared in the registry.
    expect(Object.keys(loadBrandFlavors())).toEqual(["Aldo's"]);
  });

  it("keeps a genuinely new brand verbatim when no registry brand shares its key", () => {
    saveBrandFlavors({ "Corner Booth": ["BBQ CHICKEN"] });

    applySpecImport(typoBrandImport());

    // New brand imports under its own (typo) spelling — canonicalization only
    // snaps onto EXISTING brands, it never blocks a real new-brand import.
    expect(loadProfile('Aldo"s', "SAUSAGE")?.sauceOzPerPizza).toBe(4);
  });
});
