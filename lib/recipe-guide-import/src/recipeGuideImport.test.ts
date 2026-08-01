import { describe, it, expect } from "vitest";
import { parseSauceGuide, type SauceGuideRow } from "./parseSauceGuide";
import { parseDoughGuide, type DoughGuideRow } from "./parseDoughGuide";
import { matchGuideName, buildSauceCandidates, buildDoughCandidates } from "./candidates";
import type { SheetGrid } from "@workspace/spec-import";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal SheetGrid from a list of first-column strings. */
function grid(cells: string[]): SheetGrid {
  return { rows: cells.map((c) => [c]) };
}

// ─── parseSauceGuide ─────────────────────────────────────────────────────────

describe("parseSauceGuide — basic parsing", () => {
  it("parses a simple all-varieties line", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on all varieties at 3.5oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject<Partial<SauceGuideRow>>({
      brand: "Acme",
      recipeName: "House Red",
      flavors: null, // all varieties → null
      ozPerPizza: 3.5,
    });
  });

  it("parses a specific-flavor line", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on Classic, Deluxe at 4oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject<Partial<SauceGuideRow>>({
      brand: "Acme",
      recipeName: "House Red",
      flavors: ["Classic", "Deluxe"],
      ozPerPizza: 4,
    });
  });

  it("accepts 'for' as well as 'on' as the preposition", () => {
    const rows = parseSauceGuide(
      "Big Pizza uses Marinara for all varieties at 2oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipeName).toBe("Marinara");
  });

  it("preserves the raw source line", () => {
    const line = "Acme uses House Red on all varieties at 3.5oz";
    const rows = parseSauceGuide(line);
    expect(rows[0].sourceLine).toBe(line);
  });

  it("skips blank lines and lines that don't match the pattern", () => {
    const text = [
      "",
      "This is a header",
      "Acme uses House Red on all varieties at 3.5oz",
      "   ",
      "Random text without the keyword",
    ].join("\n");
    const rows = parseSauceGuide(text);
    expect(rows).toHaveLength(1);
  });

  it("normalises extra whitespace in brand, recipe, and flavor fields", () => {
    const rows = parseSauceGuide(
      "  Big  Brand   uses  My  Sauce  on  all  varieties  at  4oz  ",
    );
    expect(rows[0].brand).toBe("Big Brand");
    expect(rows[0].recipeName).toBe("My Sauce");
  });
});

describe("parseSauceGuide — 'their recipe' expansion", () => {
  it("expands 'their recipe' to the brand name", () => {
    const rows = parseSauceGuide(
      "Acme uses their recipe on all varieties at 3oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipeName).toBe("Acme");
  });

  it("expands 'their sauce recipe' (with qualifier word) to the brand name", () => {
    const rows = parseSauceGuide(
      "Acme uses their sauce recipe on all varieties at 3oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipeName).toBe("Acme");
  });

  it("does NOT expand a recipe name that merely contains 'recipe'", () => {
    const rows = parseSauceGuide(
      "Acme uses Original recipe on all varieties at 3oz",
    );
    expect(rows[0].recipeName).toBe("Original recipe");
  });
});

describe("parseSauceGuide — multi-oz 'and on/for' continuations", () => {
  it("splits a single continuation into two rows", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on Classic at 4oz and on Deluxe at 3.5oz",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ flavors: ["Classic"], ozPerPizza: 4 });
    expect(rows[1]).toMatchObject({ flavors: ["Deluxe"], ozPerPizza: 3.5 });
  });

  it("splits two continuations into three rows", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on Classic at 4oz and on Deluxe at 3.5oz and for Light at 3oz",
    );
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ flavors: ["Light"], ozPerPizza: 3 });
  });

  it("all continuations share the same brand and recipe name", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on Classic at 4oz and on Deluxe at 3.5oz",
    );
    for (const row of rows) {
      expect(row.brand).toBe("Acme");
      expect(row.recipeName).toBe("House Red");
    }
  });

  it("continuation with all-varieties flavors → null", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on Classic at 4oz and on all varieties at 3oz",
    );
    expect(rows[1].flavors).toBeNull();
  });

  it("ignores a malformed continuation with zero oz", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on Classic at 4oz and on Deluxe at 0oz",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("parseSauceGuide — 'all varieties' / 'all other varieties' fallback", () => {
  it("'all varieties' → null flavors", () => {
    const rows = parseSauceGuide("Brand uses Sauce on all varieties at 3oz");
    expect(rows[0].flavors).toBeNull();
  });

  it("'all other varieties' → null flavors", () => {
    const rows = parseSauceGuide("Brand uses Sauce on all other varieties at 3oz");
    expect(rows[0].flavors).toBeNull();
  });

  it("'all sizes' → null flavors", () => {
    const rows = parseSauceGuide("Brand uses Sauce on all sizes at 3oz");
    expect(rows[0].flavors).toBeNull();
  });

  it("'all flavors' → null flavors", () => {
    const rows = parseSauceGuide("Brand uses Sauce on all flavors at 3oz");
    expect(rows[0].flavors).toBeNull();
  });

  it("'all 9\"' → null flavors (size-only variant)", () => {
    const rows = parseSauceGuide(`Brand uses Sauce on all 9" at 3oz`);
    expect(rows[0].flavors).toBeNull();
  });
});

describe("parseSauceGuide — flavor narrowing", () => {
  it("splits comma-separated flavors into an array", () => {
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic, Deluxe, Premium at 4oz",
    );
    expect(rows[0].flavors).toEqual(["Classic", "Deluxe", "Premium"]);
  });

  it("splits ampersand-separated flavors", () => {
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic & Deluxe at 4oz",
    );
    expect(rows[0].flavors).toEqual(["Classic", "Deluxe"]);
  });

  it("filters empty segments after splitting", () => {
    const rows = parseSauceGuide("Brand uses Sauce on Classic, , Deluxe at 4oz");
    expect(rows[0].flavors).toEqual(["Classic", "Deluxe"]);
  });
});

describe("parseSauceGuide — parenthetical size qualifiers in flavor names", () => {
  it("keeps parenthetical qualifier attached to its flavor name", () => {
    // "Classic (9in)" is ONE flavor; the parenthetical must not be split off
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (9in) at 4oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flavors).toEqual(["Classic (9in)"]);
    expect(rows[0].ozPerPizza).toBe(4);
  });

  it("does not leak the parenthetical size into the oz value", () => {
    // Regression: "(9in)" must not confuse the oz parser; oz should still be 4
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (9in), Deluxe at 4oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ozPerPizza).toBe(4);
  });

  it("preserves parenthetical qualifier on the first flavor while splitting remaining flavors", () => {
    // "Classic (9in)" is the first flavor; ", Deluxe" is the second
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (9in), Deluxe at 4oz",
    );
    expect(rows[0].flavors).toEqual(["Classic (9in)", "Deluxe"]);
  });

  it("preserves parenthetical qualifier on a trailing flavor", () => {
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic, Deluxe (Large) at 3.5oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flavors).toEqual(["Classic", "Deluxe (Large)"]);
    expect(rows[0].ozPerPizza).toBe(3.5);
  });

  it("handles multiple flavors all with parenthetical qualifiers", () => {
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (9in), Deluxe (12in) at 4oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flavors).toEqual(["Classic (9in)", "Deluxe (12in)"]);
    expect(rows[0].ozPerPizza).toBe(4);
  });

  it("handles a multi-word flavor with a parenthetical", () => {
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic Original (9in), House Special at 4oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flavors).toEqual(["Classic Original (9in)", "House Special"]);
    expect(rows[0].ozPerPizza).toBe(4);
  });

  it("correctly parses oz when the only flavor has a parenthetical", () => {
    // Ensures the main regex captures oz=3 not something inside the parens
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (Large Size) at 3oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ozPerPizza).toBe(3);
    expect(rows[0].flavors).toEqual(["Classic (Large Size)"]);
  });

  it("handles parenthetical qualifier in a multi-oz continuation flavor", () => {
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (9in) at 4oz and on Deluxe (12in) at 3.5oz",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].flavors).toEqual(["Classic (9in)"]);
    expect(rows[0].ozPerPizza).toBe(4);
    expect(rows[1].flavors).toEqual(["Deluxe (12in)"]);
    expect(rows[1].ozPerPizza).toBe(3.5);
  });

  it("keeps a flavor with a comma inside parentheses as one name, not two fragments", () => {
    // "Classic (9in, 12in)" must be ONE flavor — the comma is inside parens
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (9in, 12in) at 4oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flavors).toEqual(["Classic (9in, 12in)"]);
    expect(rows[0].ozPerPizza).toBe(4);
  });

  it("splits top-level commas while preserving commas inside parentheses", () => {
    // "Classic (9in, 12in)" is one flavor; "Deluxe" is a second — comma between
    // them is at depth 0 so it IS a separator
    const rows = parseSauceGuide(
      "Brand uses Sauce on Classic (9in, 12in), Deluxe at 4oz",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flavors).toEqual(["Classic (9in, 12in)", "Deluxe"]);
    expect(rows[0].ozPerPizza).toBe(4);
  });
});

describe("parseSauceGuide — unmatched / invalid rows", () => {
  it("returns empty array for entirely empty input", () => {
    expect(parseSauceGuide("")).toEqual([]);
  });

  it("skips a line without 'uses'", () => {
    expect(parseSauceGuide("Brand applies Sauce on all varieties at 3oz")).toEqual([]);
  });

  it("skips a line with zero oz", () => {
    expect(parseSauceGuide("Brand uses Sauce on all varieties at 0oz")).toEqual([]);
  });

  it("skips a line without a numeric oz value", () => {
    expect(parseSauceGuide("Brand uses Sauce on all varieties at many oz")).toEqual([]);
  });

  it("parses multiple valid lines from the same text", () => {
    const text = [
      "Acme uses House Red on all varieties at 3.5oz",
      "Bizco uses Marinara on Classic at 4oz",
    ].join("\n");
    const rows = parseSauceGuide(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[1].brand).toBe("Bizco");
  });
});

// ─── parseDoughGuide ──────────────────────────────────────────────────────────

describe("parseDoughGuide — basic parsing", () => {
  it("parses a simple all-flavor row", () => {
    const rows = parseDoughGuide([grid(["Acme (all) = CRB Thin"])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject<Partial<DoughGuideRow>>({
      brand: "Acme",
      doughRecipeName: "CRB Thin",
      flavors: null,
    });
  });

  it("parses a specific-flavor row", () => {
    const rows = parseDoughGuide([grid(["Acme (Classic, Deluxe) = CRB Thick"])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject<Partial<DoughGuideRow>>({
      brand: "Acme",
      doughRecipeName: "CRB Thick",
      flavors: ["Classic", "Deluxe"],
    });
  });

  it("treats ampersand as part of a flavor name, not a separator", () => {
    // In the real dough guide file, & appears inside flavor names (e.g. "S&P",
    // "Alfredo Chicken & Spinach") — it is never used as a list separator.
    // Only commas separate flavors.
    const rows = parseDoughGuide([grid(["Acme (Classic & Deluxe) = CRB Recipe"])]);
    expect(rows[0].flavors).toEqual(["Classic & Deluxe"]);
  });

  it("splits flavors on commas even when names contain ampersands", () => {
    const rows = parseDoughGuide([grid(["Acme (S&P, Meat Lovers) = CRB Recipe"])]);
    expect(rows[0].flavors).toEqual(["S&P", "Meat Lovers"]);
  });

  it("preserves the raw source line", () => {
    const cell = "Acme (all) = CRB Thin";
    const rows = parseDoughGuide([grid([cell])]);
    expect(rows[0].sourceLine).toBe(cell);
  });
});

describe("parseDoughGuide — '(all)' fallback", () => {
  it("'(all)' → null flavors", () => {
    const rows = parseDoughGuide([grid(["Brand (all) = Recipe"])]);
    expect(rows[0].flavors).toBeNull();
  });

  it("case-insensitive: '(ALL)' → null flavors", () => {
    const rows = parseDoughGuide([grid(["Brand (ALL) = Recipe"])]);
    expect(rows[0].flavors).toBeNull();
  });
});

describe("parseDoughGuide — size qualifier in brand label", () => {
  it("preserves size qualifier as part of the brand string", () => {
    const rows = parseDoughGuide([grid([`Brand 7" (all) = CRB 7in Recipe`])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe(`Brand 7"`);
    expect(rows[0].doughRecipeName).toBe("CRB 7in Recipe");
    expect(rows[0].flavors).toBeNull();
  });

  it("handles a size qualifier with specific flavors", () => {
    const rows = parseDoughGuide([grid([`Brand 12" (Classic) = Big Dough`])]);
    expect(rows[0].brand).toBe(`Brand 12"`);
    expect(rows[0].flavors).toEqual(["Classic"]);
  });
});

describe("parseDoughGuide — title / header rows skipped", () => {
  it("skips 'Pizza to Dough List' title row", () => {
    const rows = parseDoughGuide([
      grid(["Pizza to Dough List", "Acme (all) = CRB Thin"]),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("skips 'Pizza Dough' variant header row", () => {
    const rows = parseDoughGuide([
      grid(["Pizza Dough Guide", "Acme (all) = CRB Thin"]),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("skips blank cells", () => {
    const rows = parseDoughGuide([grid(["", "Acme (all) = CRB Thin", ""])]);
    expect(rows).toHaveLength(1);
  });
});

describe("parseDoughGuide — unmatched / invalid rows", () => {
  it("returns empty array for an empty grid", () => {
    expect(parseDoughGuide([grid([])])).toEqual([]);
  });

  it("skips rows without ' = ' separator", () => {
    expect(parseDoughGuide([grid(["Acme (all): CRB Thin"])])).toEqual([]);
  });

  it("skips rows without parentheses around the flavor list", () => {
    expect(parseDoughGuide([grid(["Acme all = CRB Thin"])])).toEqual([]);
  });

  it("skips rows where the recipe name is empty", () => {
    expect(parseDoughGuide([grid(["Acme (all) = "])])).toEqual([]);
  });

  it("processes rows from multiple sheets", () => {
    const rows = parseDoughGuide([
      grid(["Acme (all) = CRB Thin"]),
      grid(["Bizco (Classic) = Alt Dough"]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[1].brand).toBe("Bizco");
  });
});

// ─── matchGuideName ───────────────────────────────────────────────────────────

describe("matchGuideName", () => {
  it("returns null for an empty guide name", () => {
    expect(matchGuideName("", ["Acme", "Bizco"])).toBeNull();
  });

  it("returns null when known list is empty", () => {
    expect(matchGuideName("Acme", [])).toBeNull();
  });

  it("matches case-insensitively when exact", () => {
    expect(matchGuideName("acme", ["Acme", "Bizco"])).toBe("Acme");
    expect(matchGuideName("ACME", ["Acme", "Bizco"])).toBe("Acme");
  });

  it("matches via loose key (ignores punctuation/case differences)", () => {
    // looseNameKey strips punctuation; "Joe's" and "Joes" share the same key
    expect(matchGuideName("Joes Pizza", ["Joe's Pizza", "Other"])).toBe("Joe's Pizza");
  });

  it("returns null when multiple known names share the same loose key (ambiguous)", () => {
    // Two entries with the same loose key (punctuation stripped) but neither is
    // an exact case-insensitive match for the query → ambiguous → null.
    // "Acme Corp." and "Acme Corp!" both normalise to loose key "acme corp".
    const result = matchGuideName("Acme Corp", ["Acme Corp.", "Acme Corp!"]);
    expect(result).toBeNull();
  });

  it("returns null when no confident match exists (no exact, no unique loose key, no near-dup)", () => {
    const result = matchGuideName("Completely Different", ["Acme Pizza", "Bizco Foods"]);
    expect(result).toBeNull();
  });
});

// ─── buildSauceCandidates ─────────────────────────────────────────────────────

describe("buildSauceCandidates", () => {
  const brands = ["Acme", "Bizco"];
  const sauceRecipes = ["House Red", "Marinara", "BBQ Sauce"];

  it("matches brand and recipe name when both are found", () => {
    const rows = parseSauceGuide("Acme uses House Red on all varieties at 3.5oz");
    const candidates = buildSauceCandidates(rows, brands, sauceRecipes);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      guideBrandName: "Acme",
      brand: "Acme",
      guideName: "House Red",
      matchedRecipeName: "House Red",
      flavors: null,
      ozPerPizza: 3.5,
    });
  });

  it("sets brand to null when brand is not in known list", () => {
    const rows = parseSauceGuide("UnknownBrand uses Marinara on all varieties at 3oz");
    const candidates = buildSauceCandidates(rows, brands, sauceRecipes);
    expect(candidates[0].brand).toBeNull();
    expect(candidates[0].guideBrandName).toBe("UnknownBrand");
  });

  it("sets matchedRecipeName to null when recipe is not in known list", () => {
    const rows = parseSauceGuide("Acme uses Mystery Sauce on all varieties at 3oz");
    const candidates = buildSauceCandidates(rows, brands, sauceRecipes);
    expect(candidates[0].brand).toBe("Acme");
    expect(candidates[0].matchedRecipeName).toBeNull();
    expect(candidates[0].guideName).toBe("Mystery Sauce");
  });

  it("assigns stable, unique ids", () => {
    const rows = parseSauceGuide([
      "Acme uses House Red on all varieties at 3.5oz",
      "Bizco uses Marinara on Classic at 4oz",
    ].join("\n"));
    const candidates = buildSauceCandidates(rows, brands, sauceRecipes);
    expect(candidates[0].id).toBe("sauce-0");
    expect(candidates[1].id).toBe("sauce-1");
  });

  it("propagates flavors correctly", () => {
    const rows = parseSauceGuide("Acme uses House Red on Classic, Deluxe at 4oz");
    const candidates = buildSauceCandidates(rows, brands, sauceRecipes);
    expect(candidates[0].flavors).toEqual(["Classic", "Deluxe"]);
  });

  it("handles 'their recipe' expansion: guideName = brand name, matched against pool", () => {
    const rows = parseSauceGuide("Acme uses their recipe on all varieties at 3oz");
    // recipeName was expanded to "Acme" by parseSauceGuide; "Acme" is not in
    // the sauce recipe pool so matchedRecipeName is null, but guideName is "Acme".
    const candidates = buildSauceCandidates(rows, brands, sauceRecipes);
    expect(candidates[0].guideName).toBe("Acme");
    // "Acme" is not a sauce recipe, so no match
    expect(candidates[0].matchedRecipeName).toBeNull();
  });

  it("handles multi-oz continuations by producing one candidate per sub-row", () => {
    const rows = parseSauceGuide(
      "Acme uses House Red on Classic at 4oz and on Deluxe at 3.5oz",
    );
    const candidates = buildSauceCandidates(rows, brands, sauceRecipes);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].ozPerPizza).toBe(4);
    expect(candidates[1].ozPerPizza).toBe(3.5);
  });

  it("returns empty array when rows is empty", () => {
    expect(buildSauceCandidates([], brands, sauceRecipes)).toEqual([]);
  });
});

// ─── buildDoughCandidates ─────────────────────────────────────────────────────

describe("buildDoughCandidates", () => {
  const brands = ["Acme", "Bizco"];
  const doughRecipes = ["CRB Thin", "CRB Thick", "Alt Dough"];

  it("matches brand and dough recipe when both are found", () => {
    const rows = parseDoughGuide([grid(["Acme (all) = CRB Thin"])]);
    const candidates = buildDoughCandidates(rows, brands, doughRecipes);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      guideBrandName: "Acme",
      brand: "Acme",
      guideName: "CRB Thin",
      matchedDoughRecipeName: "CRB Thin",
      flavors: null,
    });
  });

  it("sets brand to null when brand is not in known list", () => {
    const rows = parseDoughGuide([grid(["NewBrand (all) = CRB Thin"])]);
    const candidates = buildDoughCandidates(rows, brands, doughRecipes);
    expect(candidates[0].brand).toBeNull();
    expect(candidates[0].guideBrandName).toBe("NewBrand");
  });

  it("sets matchedDoughRecipeName to null when recipe is not in known list", () => {
    const rows = parseDoughGuide([grid(["Acme (all) = Unknown Dough"])]);
    const candidates = buildDoughCandidates(rows, brands, doughRecipes);
    expect(candidates[0].brand).toBe("Acme");
    expect(candidates[0].matchedDoughRecipeName).toBeNull();
    expect(candidates[0].guideName).toBe("Unknown Dough");
  });

  it("assigns stable, unique ids", () => {
    const rows = parseDoughGuide([
      grid(["Acme (all) = CRB Thin", "Bizco (Classic) = Alt Dough"]),
    ]);
    const candidates = buildDoughCandidates(rows, brands, doughRecipes);
    expect(candidates[0].id).toBe("dough-0");
    expect(candidates[1].id).toBe("dough-1");
  });

  it("propagates flavors correctly", () => {
    const rows = parseDoughGuide([grid(["Acme (Classic, Deluxe) = CRB Thick"])]);
    const candidates = buildDoughCandidates(rows, brands, doughRecipes);
    expect(candidates[0].flavors).toEqual(["Classic", "Deluxe"]);
  });

  it("preserves size qualifier in guideBrandName", () => {
    const rows = parseDoughGuide([grid([`Acme 7" (all) = CRB Thin`])]);
    const candidates = buildDoughCandidates(rows, brands, doughRecipes);
    expect(candidates[0].guideBrandName).toBe(`Acme 7"`);
    // "Acme 7"" is not exactly "Acme" so brand matching may or may not match;
    // what matters is the raw guideBrandName is preserved correctly.
    expect(candidates[0].guideBrandName).toContain("Acme");
  });

  it("returns empty array when rows is empty", () => {
    expect(buildDoughCandidates([], brands, doughRecipes)).toEqual([]);
  });
});
