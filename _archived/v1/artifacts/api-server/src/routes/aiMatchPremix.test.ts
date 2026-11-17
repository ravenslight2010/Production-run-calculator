import { describe, it, expect } from "vitest";
import {
  buildMatchPremixPrompt,
  sanitizeMatchPremix,
  validateMatchPremixBody,
  resolveDeterministicMatchPremix,
  MAX_KNOWN_BRANDS,
  MAX_UNMATCHED_NAMES,
  type MatchPremixInput,
} from "./aiMatchPremix";

function input(overrides: Partial<MatchPremixInput> = {}): MatchPremixInput {
  return {
    brands: ["Bobo's", "Hannaford"],
    brandFlavors: { "Bobo's": ["Deluxe"], Hannaford: ["White Fajita"] },
    unmatchedNames: ["Bobos Deluxe Veggie Mix"],
    ...overrides,
  } as MatchPremixInput;
}

describe("validateMatchPremixBody", () => {
  it("rejects an empty unmatchedNames list", () => {
    const r = validateMatchPremixBody(input({ unmatchedNames: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects too many brands / names", () => {
    const tooManyBrands = validateMatchPremixBody(
      input({ brands: Array.from({ length: MAX_KNOWN_BRANDS + 1 }, (_, i) => `B${i}`) }),
    );
    expect(tooManyBrands.ok).toBe(false);
    const tooManyNames = validateMatchPremixBody(
      input({ unmatchedNames: Array.from({ length: MAX_UNMATCHED_NAMES + 1 }, (_, i) => `N${i}`) }),
    );
    expect(tooManyNames.ok).toBe(false);
  });

  it("accepts a well-formed body", () => {
    const r = validateMatchPremixBody(input());
    expect(r.ok).toBe(true);
  });
});

describe("resolveDeterministicMatchPremix", () => {
  it("grounds known brand and flavor names without a model", () => {
    const out = resolveDeterministicMatchPremix(
      input({
        brands: ["Bobo's"],
        brandFlavors: { "Bobo's": ["Deluxe"] },
        unmatchedNames: ["Bobos Deluxe Mix"],
      }),
    );
    expect(out.matches).toEqual([
      { name: "Bobos Deluxe Mix", brand: "Bobo's", flavor: "Deluxe" },
    ]);
    expect(out.unresolvedNames).toEqual([]);
  });

  it("keeps ambiguous or unknown products for AI/manual review", () => {
    const out = resolveDeterministicMatchPremix(
      input({
        brands: ["Bobo's"],
        brandFlavors: { "Bobo's": ["Deluxe Chicken", "Chicken Deluxe"] },
        unmatchedNames: ["Bobos Deluxe Mix", "Unknown Mix"],
      }),
    );
    expect(out.matches).toEqual([]);
    expect(out.unresolvedNames).toEqual(["Bobos Deluxe Mix", "Unknown Mix"]);
  });
});

describe("sanitizeMatchPremix", () => {
  it("keeps a known brand match and drops hallucinated brands", () => {
    const raw = {
      matches: [
        { name: "Bobos Deluxe Veggie Mix", brand: "Bobo's", flavor: "Deluxe" },
        { name: "Bobos Deluxe Veggie Mix", brand: "Totally Made Up XYZ", flavor: "Nope" },
      ],
    };
    const out = sanitizeMatchPremix(raw, input());
    expect(out).toEqual([{ name: "Bobos Deluxe Veggie Mix", brand: "Bobo's", flavor: "Deluxe" }]);
  });

  it("drops matches for names that were not asked about", () => {
    const raw = { matches: [{ name: "Some Other Product", brand: "Bobo's", flavor: "Deluxe" }] };
    expect(sanitizeMatchPremix(raw, input())).toEqual([]);
  });

  it("never throws on garbage input", () => {
    expect(sanitizeMatchPremix(null, input())).toEqual([]);
    expect(sanitizeMatchPremix({ matches: "nope" }, input())).toEqual([]);
  });
});

describe("buildMatchPremixPrompt", () => {
  it("lists saved brands, flavors, and the imported names; forbids invention", () => {
    const { system, user } = buildMatchPremixPrompt(input());
    expect(system).toContain("NEVER invent a brand or flavor");
    expect(user).toContain("SAVED BRANDS:");
    expect(user).toContain("- Bobo's");
    expect(user).toContain("SAVED FLAVORS BY BRAND:");
    expect(user).toContain('"Bobos Deluxe Veggie Mix"');
    expect(user).toContain('"matches"');
  });
});
