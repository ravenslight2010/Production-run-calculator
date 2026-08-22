// Recipe Guide importers — web orchestration glue.
//
// Sauce Guide pipeline:
//   Read .docx ArrayBuffer → unzip word/document.xml → extract <w:t> text →
//   parse sauce rows → match brands + recipe names → candidates for review.
//
// Dough Guide pipeline:
//   Read .xlsx ArrayBuffer → SheetGrid[] → parse dough rows →
//   match brands + recipe names → candidates for review.
//
// On confirm, apply patches to every matching brand+flavor profile in
// localStorage via applyPackagingPatchToProfile (same mechanism as shipping).

import {
  parseSauceGuide,
  parseDoughGuide,
  buildSauceCandidates,
  buildDoughCandidates,
  type SauceGuideCandidate,
  type DoughGuideCandidate,
} from "@workspace/recipe-guide-import";
import { gridSanityIssue } from "@workspace/spec-import";
import { applyPackagingPatchToProfile, loadBrandFlavors, loadSpecImportKnown } from "./storage";
import { readWorkbookGrids } from "./specImport";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SauceGuideImportPrepared = {
  candidates: SauceGuideCandidate[];
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  sauceRecipeNames: string[];
};

export type DoughGuideImportPrepared = {
  candidates: DoughGuideCandidate[];
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  doughRecipeNames: string[];
};

// ─── .docx text extraction (ZIP → word/document.xml → <w:t> nodes) ───────────

/**
 * Read the raw text from a .docx file buffer by:
 *  1. Parsing the ZIP central directory to locate word/document.xml
 *  2. Decompressing it with DecompressionStream('deflate-raw')
 *  3. Extracting all <w:t> text nodes, joined per paragraph
 *
 * Falls back gracefully if DecompressionStream is unavailable (older browsers).
 */
async function readDocxText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // ── Find End of Central Directory record (signature 0x06054b50, little-endian) ──
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Not a valid ZIP/docx file.");

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);

  // ── Scan Central Directory for word/document.xml ──
  let cdPos = cdOffset;
  while (cdPos < cdOffset + cdSize && cdPos + 46 <= bytes.length) {
    if (view.getUint32(cdPos, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(cdPos + 10, true);
    const compressedSize = view.getUint32(cdPos + 20, true);
    const fileNameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localHeaderOffset = view.getUint32(cdPos + 42, true);

    const fileName = new TextDecoder().decode(bytes.slice(cdPos + 46, cdPos + 46 + fileNameLen));

    if (fileName === "word/document.xml") {
      // Local file header: skip to data
      const lhFileNameLen = view.getUint16(localHeaderOffset + 26, true);
      const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataOffset = localHeaderOffset + 30 + lhFileNameLen + lhExtraLen;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

      let xml: string;
      if (compressionMethod === 0) {
        xml = new TextDecoder().decode(compressed);
      } else if (compressionMethod === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        writer.write(compressed);
        writer.close();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        xml = new TextDecoder().decode(out);
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }

      return extractDocxXmlText(xml);
    }

    cdPos += 46 + fileNameLen + extraLen + commentLen;
  }

  throw new Error("word/document.xml not found — is this a valid .docx file?");
}

/** Extract plain text from docx XML by collecting <w:t> runs per paragraph. */
function extractDocxXmlText(xml: string): string {
  const lines: string[] = [];
  // Split on paragraph starts (<w:p> or <w:p ...>)
  const paragraphs = xml.split(/<w:p[\s>]/);
  for (const para of paragraphs.slice(1)) {
    const texts = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) =>
      decodeXmlEntities(m[1]),
    );
    const line = texts.join("").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

// ─── Prepare ─────────────────────────────────────────────────────────────────

/**
 * Read a sauce guide .docx buffer → parse → match brands and recipe names.
 * Throws with a plain-language message when the file is unreadable or empty.
 *
 * @param extraSauceNames  Additional sauce recipe names from the server pool
 *   (named-recipes "sauce" kind).  Merged in so server-only recipes appear in
 *   the reassign dropdown even when they haven't been pushed to localStorage.
 */
export async function prepareSauceGuideImport(
  buffer: ArrayBuffer,
  extraSauceNames: string[] = [],
): Promise<SauceGuideImportPrepared> {
  const text = await readDocxText(buffer);
  const rows = parseSauceGuide(text);
  if (rows.length === 0) {
    throw new Error(
      "No sauce guide entries were found. " +
      "Make sure this is Joe's Sauce Guide document (.docx).",
    );
  }
  const known = loadSpecImportKnown();
  const flavorsByBrand = loadBrandFlavors();

  // All sauce recipe names the factory uses: ready-made names (BBQ Sauce,
  // Marinara, etc.) PLUS mixed/custom presets that have ingredient rows PLUS
  // any server-pool names passed in by the caller.
  const sauceRecipeNames = [
    ...new Set([
      ...(known.sauceNames ?? []),
      ...(known.sauceRecipes ?? []),
      ...extraSauceNames,
    ]),
  ].sort((a, b) => a.localeCompare(b));

  return {
    candidates: buildSauceCandidates(rows, known.brands, sauceRecipeNames),
    brands: known.brands,
    flavorsByBrand,
    sauceRecipeNames,
  };
}

/**
 * Read a pizza-to-dough recipe guide .xlsx buffer → parse → match.
 * Throws when the file is unreadable or not the dough guide.
 *
 * @param extraDoughNames  Additional dough recipe names from the server pool
 *   (named-recipes "dough" kind).  Merged in so server-only recipes appear in
 *   the reassign dropdown even when they haven't been pushed to localStorage.
 */
export async function prepareDoughGuideImport(
  buffer: ArrayBuffer,
  extraDoughNames: string[] = [],
): Promise<DoughGuideImportPrepared> {
  const grids = await readWorkbookGrids(buffer);
  const sanity = gridSanityIssue(grids);
  if (sanity) throw new Error(sanity);
  const rows = parseDoughGuide(grids);
  if (rows.length === 0) {
    throw new Error(
      "No dough recipe entries were found. " +
      "Make sure this is the Pizza to Dough Recipes workbook (.xlsx).",
    );
  }
  const known = loadSpecImportKnown();
  const flavorsByBrand = loadBrandFlavors();
  // All dough recipe names: name list (all registered names) PLUS presets with
  // ingredient rows PLUS any server-pool names passed in by the caller.
  const doughRecipeNames = [
    ...new Set([
      ...(known.doughNames ?? []),
      ...(known.doughRecipes ?? []),
      ...extraDoughNames,
    ]),
  ].sort((a, b) => a.localeCompare(b));

  return {
    candidates: buildDoughCandidates(rows, known.brands, doughRecipeNames),
    brands: known.brands,
    flavorsByBrand,
    doughRecipeNames,
  };
}

// ─── Commit ──────────────────────────────────────────────────────────────────

export type RecipeGuideCommitResult = {
  rowsApplied: number;
  profilesUpdated: number;
  /** Number of rows skipped because both brand and recipe were unmatched. */
  rowsSkippedBothUnmatched: number;
};

export class RecipeGuideImportConfirmationRequiredError extends Error {
  constructor() {
    super("Review confirmation is required before applying guide changes.");
    this.name = "RecipeGuideImportConfirmationRequiredError";
  }
}

export type SauceGuideCommitRow = {
  brand: string;
  flavors?: readonly string[];
  recipeName: string;
  ozPerPizza: number;
  /**
   * True when the original candidate had no confident brand match.
   * When this AND wasNullRecipe are both true the row is refused — the manager
   * must resolve at least one side before the row can be applied.
   */
  wasNullBrand: boolean;
  /**
   * True when the original candidate had no confident recipe-name match.
   * When this AND wasNullBrand are both true the row is refused.
   */
  wasNullRecipe: boolean;
};

export type DoughGuideCommitRow = {
  brand: string;
  flavors?: readonly string[];
  doughRecipeName: string;
  /**
   * True when the original candidate had no confident brand match.
   * When this AND wasNullRecipe are both true the row is refused.
   */
  wasNullBrand: boolean;
  /**
   * True when the original candidate had no confident dough-recipe match.
   * When this AND wasNullBrand are both true the row is refused.
   */
  wasNullRecipe: boolean;
};

/**
 * Apply reviewed sauce guide rows — writes `frontlineRecipeName` +
 * `sauceOzPerPizza` to every matched brand+flavor profile.
 *
 * Rows where **both** `wasNullBrand` and `wasNullRecipe` are true are skipped:
 * they have no confident match on either side and writing them would silently
 * overwrite every brand profile with a wrong recipe.
 */
export function commitSauceGuideImport(
  rows: ReadonlyArray<SauceGuideCommitRow>,
  acknowledged = true,
): RecipeGuideCommitResult {
  if (!acknowledged) throw new RecipeGuideImportConfirmationRequiredError();
  const flavorsByBrand = loadBrandFlavors();
  let rowsApplied = 0;
  let profilesUpdated = 0;
  let rowsSkippedBothUnmatched = 0;
  for (const row of rows) {
    const brand = row.brand.trim();
    if (!brand || !row.recipeName.trim() || !(row.ozPerPizza > 0)) continue;
    // Refuse rows with no confident match on either brand or recipe.
    if (row.wasNullBrand && row.wasNullRecipe) {
      rowsSkippedBothUnmatched++;
      continue;
    }
    const picked = (row.flavors ?? []).map((f) => f.trim()).filter(Boolean);
    const targets = picked.length > 0 ? picked : ["", ...(flavorsByBrand[brand] ?? [])];
    for (const flavor of targets) {
      applyPackagingPatchToProfile(brand, flavor, {
        frontlineRecipeName: row.recipeName.trim(),
        sauceOzPerPizza: row.ozPerPizza,
      } as Parameters<typeof applyPackagingPatchToProfile>[2]);
      profilesUpdated++;
    }
    rowsApplied++;
  }
  return { rowsApplied, profilesUpdated, rowsSkippedBothUnmatched };
}

/**
 * Apply reviewed dough guide rows — writes `doughRecipeName` to every
 * matched brand+flavor profile.
 *
 * Rows where **both** `wasNullBrand` and `wasNullRecipe` are true are skipped.
 */
export function commitDoughGuideImport(
  rows: ReadonlyArray<DoughGuideCommitRow>,
  acknowledged = true,
): RecipeGuideCommitResult {
  if (!acknowledged) throw new RecipeGuideImportConfirmationRequiredError();
  const flavorsByBrand = loadBrandFlavors();
  let rowsApplied = 0;
  let profilesUpdated = 0;
  let rowsSkippedBothUnmatched = 0;
  for (const row of rows) {
    const brand = row.brand.trim();
    if (!brand || !row.doughRecipeName.trim()) continue;
    // Refuse rows with no confident match on either brand or recipe.
    if (row.wasNullBrand && row.wasNullRecipe) {
      rowsSkippedBothUnmatched++;
      continue;
    }
    const picked = (row.flavors ?? []).map((f) => f.trim()).filter(Boolean);
    const targets = picked.length > 0 ? picked : ["", ...(flavorsByBrand[brand] ?? [])];
    for (const flavor of targets) {
      applyPackagingPatchToProfile(brand, flavor, {
        doughRecipeName: row.doughRecipeName.trim(),
      } as Parameters<typeof applyPackagingPatchToProfile>[2]);
      profilesUpdated++;
    }
    rowsApplied++;
  }
  return { rowsApplied, profilesUpdated, rowsSkippedBothUnmatched };
}
