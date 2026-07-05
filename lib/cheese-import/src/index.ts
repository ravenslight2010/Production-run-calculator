// "Cheese Mix Recipe Specs" workbook importer (pure, deterministic).
//
// The workbook this parses is "tabbed by customer": one sheet per customer, and
// each sheet contains:
//   • a title row (e.g. "Aldo's Cheese") + a revision date
//   • a "Cheese Shredder Setting: #N" line (value inline or in the next cell)
//   • per-flavor assignment lines ("Pepperoni: Whole Mozz Cheese Mix",
//     "All Varieties: Aldo's Standard Cheese Mix", …) mapping a product flavor
//     to the cheese-mix it uses
//   • one or more named recipe blocks, laid out in one OR two side-by-side
//     columns. A block is a header row (the mix name), a "LBS" marker row (which
//     can be one to a few rows below the header when a sub-label like
//     "For 1st Cheese Applicator" sits in between), a list of
//     "<ingredient>  <lbs>" rows, a "Total" row, and a trailing
//     "Cellulose / Percent" summary.
//
// Cheese recipes are batch-ratio (pounds per batch), so components carry `lbs`
// (matching the existing per-run appNCheeseRecipe rows), NOT the Mix model's
// per-pizza figure. This is DETERMINISTIC (no AI) — the layout is regular enough
// to parse directly, mirroring the premix importer's deterministic approach.
//
// Output is normalized CheeseRecipe[] (from @workspace/cheese-recipes) with
// stable ids so re-importing the same workbook updates in place. Web/mobile glue
// reads the workbook into grids, calls parseCheeseWorkbook, shows a review, and
// commits through the manager-gated /api/cheese-recipes path. Pure so both apps
// agree; mirrors the premix-import lib layout.

import {
  normalizeCheeseRecipe,
  mergeCheeseRecipes,
  type CheeseRecipe,
  type CheeseComponent,
} from "@workspace/cheese-recipes";

/** A worksheet flattened to string cells (matches readWorkbookGrids output). */
export interface CheeseSheetGrid {
  name: string;
  rows: string[][];
}

export interface CheeseAssignment {
  flavor: string;
  mixName: string;
}

export interface ParsedCheeseSheet {
  /** Customer this tab belongs to (the sheet name). */
  brand: string;
  shredderSetting: string;
  assignments: CheeseAssignment[];
  recipes: CheeseRecipe[];
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function cell(rows: string[][], r: number, c: number): string {
  const row = rows[r];
  if (!Array.isArray(row)) return "";
  const v = row[c];
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function parseNum(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Name-column words that never denote an ingredient or a recipe header.
const KEYWORDS = new Set(["lbs", "total", "percent"]);

function isKeyword(s: string): boolean {
  return KEYWORDS.has(s.toLowerCase());
}

/**
 * Header-column strings that are structural noise rather than recipe names:
 * revision stamps ("3/4/2025 Rev. 20", "02/06/26 Revision 11"), the "Cellulose"
 * summary label, and example-calculation lines ("8.19 total mix in pounds *0.8 =
 * 6.6 pounds total parmesan"). These can sit in the name column right above a
 * real recipe block, so without this guard the block's LBS marker (within the
 * next few rows) latches onto the noise line and the ingredients get attached to
 * a garbage "recipe" name instead of the real one.
 */
function isNonRecipeName(s: string): boolean {
  const t = collapseWs(s).toLowerCase();
  if (!t) return true;
  if (t === "cellulose") return true;
  if (/\brev(\.|ision)?\s*\d/.test(t)) return true; // "rev. 20", "revision 11"
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return true; // dates like 3/4/2025
  if (/[=*]/.test(t)) return true; // calculation / example text
  return false;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function nameKey(s: string): string {
  return collapseWs(s).toLowerCase();
}

// Common cheese-sheet abbreviations, so assignment lines ("Whole Mozz Cheese
// Mix") match their recipe block titles ("Whole Mozzarella Cheese Mix").
const ABBREV: Record<string, string> = {
  mozz: "mozzarella",
  moz: "mozzarella",
  parm: "parmesan",
  prov: "provolone",
  chx: "chicken",
  chix: "chicken",
  "&": "and",
  "w/": "with",
};

/** Match key that expands abbreviations so assignments line up with recipes. */
function matchKey(s: string): string {
  return collapseWs(s)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9&/]/g, ""))
    .map((t) => ABBREV[t] ?? t)
    .filter(Boolean)
    .join(" ");
}

/** Slugified, stable id so re-imports update the same recipe in place. */
export function cheeseImportId(brand: string, name: string): string {
  const slug = (s: string) =>
    collapseWs(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const b = slug(brand);
  const n = slug(name);
  return b ? `cheese:${b}:${n}` : `cheese:${n}`;
}

// ---------------------------------------------------------------------------
// Per-sheet parsing
// ---------------------------------------------------------------------------

/** Pull the shredder setting from a "Cheese Shredder Setting: …" line. */
function findShredderSetting(rows: string[][]): string {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = cell(rows, r, c);
      if (v.toLowerCase().includes("shredder setting")) {
        const after = v.split(":").slice(1).join(":").trim();
        if (after) return after;
        // Value lives in the next non-empty cell on the row.
        for (let k = c + 1; k < row.length; k++) {
          const nv = cell(rows, r, k);
          if (nv) return nv;
        }
        return "";
      }
    }
  }
  return "";
}

/**
 * Collect "<flavor>: <mix name>" assignment lines. Only rows ABOVE the first
 * recipe block are considered (assignments always precede the blocks), which
 * keeps ingredient/summary rows from being misread as assignments.
 */
function findAssignments(rows: string[][], firstBlockRow: number): CheeseAssignment[] {
  const out: CheeseAssignment[] = [];
  const limit = firstBlockRow >= 0 ? firstBlockRow : rows.length;
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = cell(rows, r, c);
      if (!v || !v.includes(":")) continue;
      const lower = v.toLowerCase();
      if (v.startsWith("**") || lower.includes("note")) continue;
      if (lower.includes("shredder setting")) continue;
      const idx = v.indexOf(":");
      const flavor = v.slice(0, idx).trim();
      const mixName = v.slice(idx + 1).trim();
      if (!flavor || !mixName) continue;
      // Guard against stray timestamps / non-assignment colons: the mix name
      // must contain letters.
      if (!/[a-z]/i.test(mixName)) continue;
      out.push({ flavor, mixName });
    }
  }
  return out;
}

/** Columns that hold "LBS" markers (the amount columns). */
function amountColumns(rows: string[][]): number[] {
  const cols = new Set<number>();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (cell(rows, r, c).toLowerCase() === "lbs" && c >= 1) cols.add(c);
    }
  }
  return [...cols].sort((a, b) => a - b);
}

interface RawBlock {
  name: string;
  components: CheeseComponent[];
  /** Cellulose percent from the trailing summary, verbatim, or "". */
  cellulosePercent: string;
  /** Row index (inclusive) where scanning may resume after this block. */
  endRow: number;
  firstRow: number;
}

/**
 * Scan a single (nameCol, amountCol) column pair for recipe blocks. Returns the
 * blocks found, in document order.
 */
function scanColumnBlocks(rows: string[][], nameCol: number): RawBlock[] {
  const amtCol = nameCol + 1;
  const blocks: RawBlock[] = [];
  let r = 0;
  while (r < rows.length) {
    const name = collapseWs(cell(rows, r, nameCol));
    // A header candidate: a non-empty, non-keyword name with no colon and not a
    // note/shredder line, that has a "LBS" marker within the next few rows.
    const lower = name.toLowerCase();
    const looksHeader =
      !!name &&
      !isKeyword(name) &&
      !isNonRecipeName(name) &&
      !name.includes(":") &&
      !name.startsWith("**") &&
      !lower.includes("note") &&
      !lower.includes("shredder");
    let lbsRow = -1;
    if (looksHeader) {
      for (let k = r + 1; k <= r + 3 && k < rows.length; k++) {
        if (cell(rows, k, amtCol).toLowerCase() === "lbs") {
          lbsRow = k;
          break;
        }
      }
    }
    if (lbsRow < 0) {
      r++;
      continue;
    }

    // Collect components after the LBS marker until Total / Percent / a blank
    // name / a new header.
    const components: CheeseComponent[] = [];
    let cellulosePercent = "";
    let k = lbsRow + 1;
    for (; k < rows.length; k++) {
      const kname = cell(rows, k, nameCol);
      const kamt = cell(rows, k, amtCol);
      const klower = kname.toLowerCase();
      if (klower === "total") {
        k++;
        break;
      }
      if (klower === "percent") break;
      if (!kname && !kamt) break;
      if (!kname) break; // start of the "", LBS summary row
      const num = parseNum(kamt);
      if (num == null) continue; // e.g. "For 1st Cheese Applicator" sub-label
      components.push({ ingredient: kname, lbs: Math.max(0, num) });
    }

    // Skip past the trailing "Cellulose / Percent" summary block so its rows are
    // never re-scanned as spurious headers, capturing the percent if present.
    while (k < rows.length) {
      const kname = cell(rows, k, nameCol);
      const kamt = cell(rows, k, amtCol);
      const klower = kname.toLowerCase();
      if (klower === "percent") {
        cellulosePercent = kamt;
        k++;
        continue;
      }
      if (klower === "cellulose" || kamt.toLowerCase() === "lbs" || (!kname && !kamt)) {
        k++;
        continue;
      }
      break;
    }

    if (components.length > 0) {
      blocks.push({ name, components, cellulosePercent, endRow: k, firstRow: r });
    }
    r = Math.max(k, r + 1);
  }
  return blocks;
}

/** Parse a single customer sheet into its shredder setting, assignments, recipes. */
export function parseCheeseSheet(grid: CheeseSheetGrid): ParsedCheeseSheet {
  const rows = grid.rows ?? [];
  const brand = collapseWs(grid.name ?? "");
  const shredderSetting = findShredderSetting(rows);

  // Find recipe blocks across every column pair.
  const amtCols = amountColumns(rows);
  const nameCols = [...new Set(amtCols.map((c) => c - 1))].sort((a, b) => a - b);
  const raw: RawBlock[] = [];
  for (const nameCol of nameCols) raw.push(...scanColumnBlocks(rows, nameCol));

  const firstBlockRow = raw.length
    ? Math.min(...raw.map((b) => b.firstRow))
    : -1;
  const assignments = findAssignments(rows, firstBlockRow);

  // Dedupe recipe blocks by name (case-insensitive), keeping the first seen.
  const seen = new Set<string>();
  const deduped: RawBlock[] = [];
  for (const b of raw) {
    const key = nameKey(b.name);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(b);
  }

  const recipes: CheeseRecipe[] = [];
  for (const b of deduped) {
    // Flavors assigned to this recipe = assignment lines whose mix name matches.
    const flavors = assignments
      .filter((a) => matchKey(a.mixName) === matchKey(b.name))
      .map((a) => a.flavor);
    const recipe = normalizeCheeseRecipe({
      id: cheeseImportId(brand, b.name),
      name: b.name,
      brand,
      flavors,
      shredderSetting,
      cellulose: b.cellulosePercent,
      notes: "",
      components: b.components,
      enabled: true,
    });
    if (recipe) recipes.push(recipe);
  }

  return { brand, shredderSetting, assignments, recipes };
}

/** Parse a whole workbook (many customer tabs) into a flat CheeseRecipe[]. */
export function parseCheeseWorkbook(grids: ReadonlyArray<CheeseSheetGrid>): {
  recipes: CheeseRecipe[];
  brands: string[];
  sheets: ParsedCheeseSheet[];
} {
  const sheets: ParsedCheeseSheet[] = [];
  const byId = new Map<string, CheeseRecipe>();
  const brands = new Set<string>();
  for (const grid of grids) {
    const sheet = parseCheeseSheet(grid);
    sheets.push(sheet);
    if (sheet.brand) brands.add(sheet.brand);
    for (const r of sheet.recipes) byId.set(r.id, r);
  }
  return {
    recipes: [...byId.values()],
    brands: [...brands],
    sheets,
  };
}

// ---------------------------------------------------------------------------
// Review helpers
// ---------------------------------------------------------------------------

export interface CheeseImportSummary {
  total: number;
  added: number;
  updated: number;
}

export interface CheeseImportCandidate {
  recipe: CheeseRecipe;
  status: "new" | "update";
}

export function summarizeCheeseImport(
  recipes: ReadonlyArray<CheeseRecipe>,
  existsById: (id: string) => boolean,
): CheeseImportSummary {
  let added = 0;
  let updated = 0;
  for (const r of recipes) {
    if (existsById(r.id)) updated++;
    else added++;
  }
  return { total: recipes.length, added, updated };
}

export function buildCheeseImportCandidates(
  recipes: ReadonlyArray<CheeseRecipe>,
  existsById: (id: string) => boolean,
): CheeseImportCandidate[] {
  return recipes.map((recipe) => ({
    recipe,
    status: existsById(recipe.id) ? "update" : "new",
  }));
}

export { mergeCheeseRecipes };
