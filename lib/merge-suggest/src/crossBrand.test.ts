// The cross-brand guard: names that clearly belong to DIFFERENT known brands
// (e.g. "Lowes 7in 5 Cheese Mix" vs a Bashas cheese) are never the same
// real-world item, so any suggestion pairing them is stripped before it is
// shown — regardless of whether it came from the AI, remembered groups, or the
// deterministic near-dup scan.
import { describe, it, expect } from "vitest";
import {
  buildBrandMentionMatcher,
  namesMentionDifferentBrands,
  filterCrossBrandSuggestions,
  type MergeSuggestion,
} from "./index";

const BRANDS = ["Lowes", "Bashas", "Corner Booth", "The Pizza Co"];

describe("buildBrandMentionMatcher", () => {
  const mentions = buildBrandMentionMatcher(BRANDS);

  it("detects a brand mentioned anywhere in a name (case-insensitive)", () => {
    expect(mentions("Lowes 7in 5 Cheese Mix").size).toBe(1);
    expect(mentions("lowes cheese").size).toBe(1);
    expect(mentions("7in BASHAS blend").size).toBe(1);
  });

  it("requires ALL distinguishing tokens of a multi-word brand", () => {
    expect(mentions("Corner Booth Dough").size).toBe(1);
    expect(mentions("Corner Dough").size).toBe(0);
    expect(mentions("Booth Special").size).toBe(0);
  });

  it("ignores generic filler tokens when matching a brand", () => {
    // "The Pizza Co" reduces to no distinguishing tokens — it can never match,
    // rather than matching every name containing the word "pizza".
    expect(mentions("Pizza Cheese Mix").size).toBe(0);
    expect(mentions("The Pizza Co Blend").size).toBe(0);
  });

  it("returns empty for names that mention no known brand", () => {
    expect(mentions("5 Cheese Mix").size).toBe(0);
    expect(mentions("").size).toBe(0);
  });

  it("handles an empty/blank brand list", () => {
    const none = buildBrandMentionMatcher([]);
    expect(none("Lowes Cheese").size).toBe(0);
    const blank = buildBrandMentionMatcher(["", "  "]);
    expect(blank("Lowes Cheese").size).toBe(0);
  });
});

describe("namesMentionDifferentBrands", () => {
  const mentions = buildBrandMentionMatcher(BRANDS);

  it("true for two names carrying different known brands", () => {
    expect(
      namesMentionDifferentBrands("Lowes 7in 5 Cheese Mix", "Bashas 5 Cheese Mix", mentions),
    ).toBe(true);
  });

  it("false when either name mentions no known brand", () => {
    expect(namesMentionDifferentBrands("5 Cheese Mix", "Bashas 5 Cheese Mix", mentions)).toBe(
      false,
    );
    expect(namesMentionDifferentBrands("Lowes Mix", "Cheese Mix", mentions)).toBe(false);
  });

  it("false when the names share a mentioned brand", () => {
    expect(
      namesMentionDifferentBrands("Bashas Thin Cheese", "BASHAS 5 Cheese Mix", mentions),
    ).toBe(false);
  });
});

describe("filterCrossBrandSuggestions", () => {
  it("drops a source that brand-conflicts with the target", () => {
    const out = filterCrossBrandSuggestions(
      [{ target: "Bashas 5 Cheese Mix", sources: ["Lowes 7in 5 Cheese Mix"] }],
      BRANDS,
    );
    expect(out).toEqual([]);
  });

  it("keeps brand-compatible pairings", () => {
    const suggestions: MergeSuggestion[] = [
      { target: "Bashas 5 Cheese Mix", sources: ["bashas 5 cheese mix ", "5 Cheese Mix"] },
    ];
    const out = filterCrossBrandSuggestions(suggestions, BRANDS);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(["bashas 5 cheese mix ", "5 Cheese Mix"]);
  });

  it("keeps only the compatible sources of a mixed group", () => {
    const out = filterCrossBrandSuggestions(
      [
        {
          target: "Bashas 5 Cheese Mix",
          sources: ["Bashas Five Cheese Mix", "Lowes 5 Cheese Mix"],
        },
      ],
      BRANDS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(["Bashas Five Cheese Mix"]);
  });

  it("stops a brand-neutral target from collapsing two brands' items", () => {
    const out = filterCrossBrandSuggestions(
      [
        {
          target: "5 Cheese Mix",
          sources: ["Lowes 5 Cheese Mix", "Bashas 5 Cheese Mix"],
        },
      ],
      BRANDS,
    );
    expect(out).toHaveLength(1);
    // The first source is kept; the second conflicts with it and is dropped.
    expect(out[0].sources).toEqual(["Lowes 5 Cheese Mix"]);
  });

  it("preserves extra suggestion fields (e.g. review verdicts) on kept groups", () => {
    type Reviewed = MergeSuggestion & { review: string };
    const out = filterCrossBrandSuggestions<Reviewed>(
      [{ target: "Bashas Mix", sources: ["Bashas Mixx"], review: "ok" }],
      BRANDS,
    );
    expect(out[0].review).toBe("ok");
  });

  it("is a no-op when the known-brand list is empty", () => {
    const suggestions = [{ target: "Lowes Mix", sources: ["Bashas Mix"] }];
    expect(filterCrossBrandSuggestions(suggestions, [])).toEqual(suggestions);
  });
});
