// Deterministic dough-name backstop: when the parse model omits `doughName`
// but the sheet's crust row unambiguously names exactly one dough inside a
// generic-crust parenthetical, sanitize backfills every profile missing one.

import { describe, it, expect } from "vitest";
import {
  extractSheetCrustDoughName,
  buildProfileDoughGrounding,
  sanitizeParsedSpecImport,
} from "./index";

const ctxFor = (sourceText: string) =>
  buildProfileDoughGrounding({ sourceText });

describe("extractSheetCrustDoughName", () => {
  it("extracts the single dough named by a generic-crust wrapper cell", () => {
    const ctx = ctxFor(
      'Cheese Pizza\nParbake crust (CRB Recipe - 12" Dies)\t7.50\nSauce\t4.0',
    );
    expect(extractSheetCrustDoughName(ctx)).toBe("CRB Recipe");
  });

  it("returns empty when the sheet names no dough", () => {
    const ctx = ctxFor("Cheese Pizza\nParbake crust\t7.50\nSauce\t4.0");
    expect(extractSheetCrustDoughName(ctx)).toBe("");
  });

  it("returns empty when the sheet names TWO different doughs (never guesses)", () => {
    const ctx = ctxFor(
      'Crust (CRB Recipe - 12" Dies)\nCrust (Ultra Thin - 11" Dies)',
    );
    expect(extractSheetCrustDoughName(ctx)).toBe("");
  });

  it("dedupes the same dough repeated on many rows (case-insensitive)", () => {
    const ctx = ctxFor(
      'Crust (CRB Recipe - 12" Dies)\nParbake Crust (crb recipe - 12" Dies)',
    );
    expect(extractSheetCrustDoughName(ctx)).toBe("CRB Recipe");
  });

  it("ignores non-generic bases and qualifier-only parens", () => {
    const ctx = ctxFor(
      "Aldo's Dough (made in house)\nMozzarella (shredded)\t5.0",
    );
    expect(extractSheetCrustDoughName(ctx)).toBe("");
  });

  it("returns empty without a grounding context", () => {
    expect(extractSheetCrustDoughName(undefined)).toBe("");
  });
});

describe("sanitizeParsedSpecImport dough-name backfill", () => {
  const sourceText =
    'Cheese Pizza\nParbake crust (CRB Recipe - 12" Dies)\t7.50\nLucia Pizza Sauce\t4.0';

  it("backfills a missing doughName from the sheet's crust row", () => {
    const parsed = sanitizeParsedSpecImport(
      {
        profiles: [
          {
            brand: "Lucia",
            flavor: "Cheese Pizza",
            sauceOzPerPizza: 4,
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [],
      },
      {},
      { sourceText },
    );
    expect(parsed.profiles?.[0]?.doughName).toBe("CRB Recipe");
  });

  it("does NOT override a doughName the parse already carried", () => {
    const parsed = sanitizeParsedSpecImport(
      {
        profiles: [
          {
            brand: "Lucia",
            flavor: "Cheese Pizza",
            doughName: "CRB Recipe",
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [],
      },
      {},
      { sourceText },
    );
    expect(parsed.profiles?.[0]?.doughName).toBe("CRB Recipe");
  });
});
