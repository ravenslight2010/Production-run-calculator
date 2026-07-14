// @vitest-environment jsdom
//
// Regression guard for "the importer keeps pulling my new flavors back onto
// deleted old ones". The spec-import match universe (loadSpecImportKnown) fed
// the alias/exact/fuzzy layers EVERY existing flavor — including ones the user
// deliberately deleted. A renamed sheet's "4 Cheese Meltdown" then grounded
// onto the deleted "FOUR CHEESE MELTDOWN" (the digit guard folds "four" → "4"),
// so profiles landed under invisible names and autofill found nothing.
// Deleted names (tombstoned, un-delete stamp not winning) must be EXCLUDED
// from the match universe; an un-deleted (re-added) name comes back.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  loadSpecImportKnown,
  saveBrandFlavors,
  tombstoneDeleted,
  clearDeleted,
  isNameDeleted,
  flavorNamespace,
} from "./storage";

const BRAND = "Lucia's Craft";
const NS = flavorNamespace(BRAND);

describe("spec-import match universe excludes deleted names", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("a deleted flavor is dropped from flavorsByBrand", () => {
    saveBrandFlavors({ [BRAND]: ["FOUR CHEESE MELTDOWN", "BRAT"] });
    tombstoneDeleted(NS, "FOUR CHEESE MELTDOWN");
    expect(loadSpecImportKnown().flavorsByBrand[BRAND]).toEqual(["BRAT"]);
  });

  it("an un-deleted (re-added) flavor stays in the universe", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    saveBrandFlavors({ [BRAND]: ["FOUR CHEESE MELTDOWN"] });
    tombstoneDeleted(NS, "FOUR CHEESE MELTDOWN");
    vi.setSystemTime(2_000_000);
    clearDeleted(NS, "FOUR CHEESE MELTDOWN");
    expect(loadSpecImportKnown().flavorsByBrand[BRAND]).toEqual(["FOUR CHEESE MELTDOWN"]);
  });

  it("a deleted brand is dropped from brands", () => {
    localStorage.setItem("run-calc-brands", JSON.stringify(["Lucia's Craft", "Bobo's"]));
    tombstoneDeleted("brands", "Bobo's");
    expect(loadSpecImportKnown().brands).toEqual(["Lucia's Craft"]);
  });

  it("isNameDeleted mirrors the stamp arbitration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    tombstoneDeleted(NS, "House Special");
    expect(isNameDeleted(NS, "house SPECIAL")).toBe(true);
    vi.setSystemTime(2_000_000);
    clearDeleted(NS, "House Special");
    expect(isNameDeleted(NS, "House Special")).toBe(false);
    vi.setSystemTime(3_000_000);
    tombstoneDeleted(NS, "House Special");
    expect(isNameDeleted(NS, "House Special")).toBe(true);
  });
});
