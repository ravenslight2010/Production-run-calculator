import { describe, expect, it } from "vitest";
import {
  filterConflictingSuggestions,
  namesHaveConflictingTerms,
  type MergeSuggestion,
} from "./index";

describe("namesHaveConflictingTerms", () => {
  it("flags cured vs natural (either direction, any casing)", () => {
    expect(namesHaveConflictingTerms("Pepperoni Cured", "Pepperoni Natural")).toBe(true);
    expect(namesHaveConflictingTerms("Natural Pepperoni", "Cured Pepperoni")).toBe(true);
    expect(namesHaveConflictingTerms("CURED", "natural")).toBe(true);
  });

  it("does not flag names sharing the same descriptor or lacking one", () => {
    expect(namesHaveConflictingTerms("Pepperoni Cured", "Peperoni Cured")).toBe(false);
    expect(namesHaveConflictingTerms("Pepperoni Natural", "Natural Pepperoni")).toBe(false);
    expect(namesHaveConflictingTerms("Pepperoni", "Pepperoni Craft")).toBe(false);
    expect(namesHaveConflictingTerms("Pepperoni Cured", "Pepperoni")).toBe(false);
  });

  it("matches whole words only — 'Uncured' is not 'cured'", () => {
    expect(namesHaveConflictingTerms("Uncured Pepperoni", "Natural Pepperoni")).toBe(false);
    expect(namesHaveConflictingTerms("Uncured Pepperoni", "Cured Pepperoni")).toBe(false);
  });

  it("treats a name containing BOTH terms as ambiguous (no conflict)", () => {
    expect(
      namesHaveConflictingTerms("Natural Cured Pepperoni", "Cured Pepperoni"),
    ).toBe(false);
    expect(
      namesHaveConflictingTerms("Natural Cured Pepperoni", "Natural Pepperoni"),
    ).toBe(false);
  });

  it("never throws on blank/odd input", () => {
    expect(namesHaveConflictingTerms("", "")).toBe(false);
    expect(namesHaveConflictingTerms("  ", "Natural")).toBe(false);
  });
});

describe("filterConflictingSuggestions", () => {
  it("drops a source that conflicts with the target", () => {
    const out = filterConflictingSuggestions([
      { target: "Pepperoni Cured", sources: ["Pepperoni Natural", "Peperoni Cured"] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(["Peperoni Cured"]);
  });

  it("drops the whole group when no sources survive", () => {
    const out = filterConflictingSuggestions([
      { target: "Cured Pepperoni", sources: ["Natural Pepperoni"] },
    ]);
    expect(out).toEqual([]);
  });

  it("prevents a neutral target from collapsing a cured and a natural source", () => {
    const out = filterConflictingSuggestions([
      { target: "Pepperoni", sources: ["Pepperoni Cured", "Pepperoni Natural"] },
    ]);
    expect(out).toHaveLength(1);
    // First source is kept; the later conflicting one is dropped.
    expect(out[0].sources).toEqual(["Pepperoni Cured"]);
  });

  it("leaves unrelated suggestions untouched (including extra fields)", () => {
    const input: (MergeSuggestion & { review?: string })[] = [
      { target: "Mozzarella", sources: ["Mozarella"], reason: "typo", review: "ok" },
    ];
    const out = filterConflictingSuggestions(input);
    expect(out).toEqual(input);
  });

  it("handles empty input and missing sources safely", () => {
    expect(filterConflictingSuggestions([])).toEqual([]);
    expect(
      filterConflictingSuggestions([{ target: "X", sources: [] }]),
    ).toEqual([]);
  });
});
