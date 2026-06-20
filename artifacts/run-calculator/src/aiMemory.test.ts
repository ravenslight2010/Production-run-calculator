// Tests for the shared corrections-memory logic in @workspace/ai-memory.
// Web and mobile both consume this lib, so testing it once here covers both.
import { describe, it, expect } from "vitest";
import {
  correctionKey,
  normalizeCorrections,
  filterCorrectionsByDomain,
  buildCorrectionsBlock,
  MAX_CORRECTION_TEXT_LEN,
  type AiCorrection,
} from "@workspace/ai-memory";

describe("correctionKey", () => {
  it("is case-insensitive and trims domain + fromText", () => {
    expect(correctionKey("Ingredient", "  Mozz ")).toBe(correctionKey("ingredient", "mozz"));
  });

  it("separates domain from name so the same name in two domains differs", () => {
    expect(correctionKey("brand", "Acme")).not.toBe(correctionKey("flavor", "Acme"));
  });
});

describe("normalizeCorrections", () => {
  it("trims, drops blanks, and drops self-references", () => {
    const out = normalizeCorrections([
      { domain: "ingredient", fromText: "  Mozz ", toText: " Mozzarella " },
      { domain: "ingredient", fromText: "Same", toText: "same" },
      { domain: "", fromText: "x", toText: "y" },
      { domain: "brand", fromText: "  ", toText: "y" },
      { domain: "brand", fromText: "x", toText: "" },
      null,
      undefined,
    ]);
    expect(out).toEqual([{ domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" }]);
  });

  it("dedupes by (domain, fromText) case-insensitively with last write winning", () => {
    const out = normalizeCorrections([
      { domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" },
      { domain: "Ingredient", fromText: "MOZZ", toText: "Whole Milk Mozzarella" },
    ]);
    expect(out).toEqual([
      { domain: "Ingredient", fromText: "MOZZ", toText: "Whole Milk Mozzarella" },
    ]);
  });

  it("keeps the same name across different domains as separate entries", () => {
    const out = normalizeCorrections([
      { domain: "brand", fromText: "Acme", toText: "Acme Foods" },
      { domain: "flavor", fromText: "Acme", toText: "Acme Classic" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("caps each field to the max length", () => {
    const long = "x".repeat(MAX_CORRECTION_TEXT_LEN + 50);
    const out = normalizeCorrections([{ domain: "d".repeat(300), fromText: long, toText: "y" }]);
    expect(out[0]?.domain.length).toBe(MAX_CORRECTION_TEXT_LEN);
    expect(out[0]?.fromText.length).toBe(MAX_CORRECTION_TEXT_LEN);
  });

  it("bounds the count when limit is given", () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({
      domain: "ingredient",
      fromText: `from-${i}`,
      toText: `to-${i}`,
    }));
    expect(normalizeCorrections(raw, { limit: 3 })).toHaveLength(3);
  });

  it("returns [] for null/undefined/garbage", () => {
    expect(normalizeCorrections(null)).toEqual([]);
    expect(normalizeCorrections(undefined)).toEqual([]);
    expect(normalizeCorrections([42 as unknown as AiCorrection])).toEqual([]);
  });
});

describe("filterCorrectionsByDomain", () => {
  const pool: AiCorrection[] = [
    { domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" },
    { domain: "brand", fromText: "Acme", toText: "Acme Foods" },
    { domain: "flavor", fromText: "Pep", toText: "Pepperoni" },
  ];

  it("keeps only allow-listed domains, case-insensitively", () => {
    const out = filterCorrectionsByDomain(pool, ["Ingredient", "FLAVOR"]);
    expect(out.map((c) => c.domain)).toEqual(["ingredient", "flavor"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterCorrectionsByDomain(pool, ["die"])).toEqual([]);
  });
});

describe("buildCorrectionsBlock", () => {
  const pool: AiCorrection[] = [
    { domain: "ingredient", fromText: "Mozz", toText: "Mozzarella" },
    { domain: "brand", fromText: "Acme", toText: "Acme Foods" },
  ];

  it("returns an empty string for an empty pool", () => {
    expect(buildCorrectionsBlock([])).toBe("");
  });

  it("renders a heading plus one line per correction with domain tags", () => {
    const block = buildCorrectionsBlock(pool);
    expect(block).toContain("GLOBAL KNOWN CORRECTIONS");
    expect(block).toContain('[ingredient] "Mozz" => "Mozzarella"');
    expect(block).toContain('[brand] "Acme" => "Acme Foods"');
  });

  it("honors a custom heading and a limit (keeps the first N)", () => {
    const block = buildCorrectionsBlock(pool, { heading: "PAST FIXES:", limit: 1 });
    expect(block).toContain("PAST FIXES:");
    expect(block).toContain("Mozz");
    expect(block).not.toContain("Acme");
  });
});
