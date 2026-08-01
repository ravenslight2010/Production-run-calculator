// Pizza-to-Dough Recipe Guide parser — pure logic, no DOM/storage/fetch.
//
// Parses the single-sheet workbook whose rows follow the pattern:
//   "Brand (flavor1, flavor2) = Dough Recipe Name"
//   "Brand (all) = Dough Recipe Name"
//   "Brand 7" (all) = CRB Recipe"   ← size qualifier in brand label
//
// Only the first column of each row is used; the rest are ignored.
// The title row ("Pizza to Dough List") and blank rows are skipped.

import type { SheetGrid } from "@workspace/spec-import";

export type DoughGuideRow = {
  /**
   * Brand name as extracted from the guide (may include a size qualifier
   * like '7"'). Needs matching to app brands via near-dup matcher.
   */
  brand: string;
  /** Dough recipe name as written in the guide. */
  doughRecipeName: string;
  /**
   * Specific flavors this row applies to, or null when the guide says "(all)".
   */
  flavors: string[] | null;
  /** Raw source text, for display in the review dialog. */
  sourceLine: string;
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Given a string that ends with ")", find the outermost matching "(" by
 * walking backwards, and return { brand, inner } where brand is the text
 * before the opening "(" (trimmed) and inner is the text between the outer
 * parens.  Returns null if no balanced outer parens are found.
 *
 * Handles nested parens, e.g.:
 *   "Acme (Classic (Thin, Crispy))"  →  brand="Acme", inner="Classic (Thin, Crispy)"
 */
function extractOuterParens(
  s: string,
): { brand: string; inner: string } | null {
  if (!s.endsWith(")")) return null;
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ")") depth++;
    else if (s[i] === "(") {
      depth--;
      if (depth === 0) {
        const brand = s.slice(0, i).trim();
        const inner = s.slice(i + 1, s.length - 1);
        return { brand, inner };
      }
    }
  }
  return null;
}

/**
 * Split a comma-separated flavor list at depth-0 commas only.
 * Commas that appear inside balanced parentheses are NOT treated as
 * separators, so "Classic (Thin, Crispy)" stays as one token.
 */
function splitOnTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/**
 * Parse the Pizza-to-Dough workbook into structured rows.
 * Accepts an array of SheetGrids; scans every sheet, picks rows that match
 * the "Brand (flavors) = Recipe" format.
 */
export function parseDoughGuide(grids: ReadonlyArray<SheetGrid>): DoughGuideRow[] {
  const rows: DoughGuideRow[] = [];

  for (const grid of grids) {
    for (const row of grid.rows) {
      const cell = norm(row[0] ?? "");
      if (!cell) continue;
      // Skip title / header rows
      if (/^pizza\s+(to\s+)?dough/i.test(cell)) continue;

      // Pattern: "Brand (flavor list) = Recipe Name"
      //
      // The file is inconsistent about whitespace around "=":
      //   "Aldo's (all) = Aldo's Recipe"   ← space on both sides  (most rows)
      //   "SMD (all)= CRB Recipe"          ← no space before =
      //
      // Strategy: require the left side to end with ")" then tolerate any
      // amount of whitespace around the "=".  This avoids splitting on "="
      // inside a recipe name like "Malted Barley Recipe (Thick)".
      const splitMatch = cell.match(/^(.+\))\s*=\s*(.+)$/);
      if (!splitMatch) continue;

      const leftPart = splitMatch[1].trim();
      const recipeName = splitMatch[2].trim();
      if (!recipeName) continue;

      // Extract brand and flavor list: "Brand (f1, f2)" or "Brand 7" (all)"
      //
      // The flavor list may contain nested parentheses, e.g.:
      //   "Acme (Classic (Thin, Crispy)) = Recipe"
      // The naive [^)]+ regex would stop at the first ')' and either
      // mismatch or drop the row entirely.  Instead, find the outermost
      // '(' by walking backwards from the end of leftPart (which ends with ')').
      const extracted = extractOuterParens(leftPart);
      if (!extracted) continue;

      const brandRaw = extracted.brand;
      const flavorPart = norm(extracted.inner);

      // Split on commas at depth 0 only — "&" in this file is part of flavor
      // names (e.g. "S&P", "Alfredo Chicken & Spinach"), never a list separator.
      // Commas inside nested parens (e.g. "Classic (Thin, Crispy)") must be
      // treated as part of the flavor name, not as list separators.
      const flavors = /^all$/i.test(flavorPart)
        ? null
        : splitOnTopLevelCommas(flavorPart)
            .map((f) => norm(f))
            .filter(Boolean);

      if (brandRaw) {
        rows.push({ brand: brandRaw, doughRecipeName: recipeName, flavors, sourceLine: cell });
      }
    }
  }

  return rows;
}
