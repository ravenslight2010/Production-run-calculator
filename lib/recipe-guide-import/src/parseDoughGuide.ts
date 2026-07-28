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
      // Split on " = " (with spaces) at first occurrence
      const eqIdx = cell.indexOf(" = ");
      if (eqIdx < 0) continue;

      const leftPart = cell.slice(0, eqIdx).trim();
      const recipeName = cell.slice(eqIdx + 3).trim();
      if (!recipeName) continue;

      // Extract brand and flavor list: "Brand (f1, f2)" or "Brand 7" (all)"
      const parenMatch = leftPart.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (!parenMatch) continue;

      const brandRaw = parenMatch[1].trim();
      const flavorPart = norm(parenMatch[2]);

      const flavors = /^all$/i.test(flavorPart)
        ? null
        : flavorPart
            .split(/[,&]/)
            .map((f) => norm(f))
            .filter(Boolean);

      if (brandRaw) {
        rows.push({ brand: brandRaw, doughRecipeName: recipeName, flavors, sourceLine: cell });
      }
    }
  }

  return rows;
}
