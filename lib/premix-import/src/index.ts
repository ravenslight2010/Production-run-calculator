// @workspace/premix-import — pure, platform-agnostic logic for the in-app
// "premix sheet" Excel importer in the Mixes section.
//
// A premix workbook has one tab per product (some tabs hold TWO mix blocks laid
// out side by side). Each block describes a pre-blended mix: a name, a
// per-pizza component table, a batch total, and sometimes a "Pull N days early"
// note. This package turns a parsed workbook (SheetGrid[]) into candidate Mix
// definitions for the existing @workspace/mixes model.
//
// IMPORTANT split of responsibilities (replit.md: AI is advisory only):
//   * QUANTITIES are parsed DETERMINISTICALLY here (per-pizza amounts, batch
//     size, days-early). The AI never touches a number.
//   * PRODUCT NAMES (brand+flavor) are grounded against the app's known lists +
//     learned aliases here first; only the leftover ambiguous names are sent to
//     the server's AI matcher, whose output is canonicalized/sanitized back to
//     the known lists before being applied.
//
// This package holds NO platform IO (no xlsx read, no storage, no fetch). Web
// and mobile glue read the workbook into a SheetGrid[], call these helpers, then
// (for unresolved products) the AI match endpoint, and finally write through the
// existing manager-gated saveMixes path. Keeping the logic here keeps both apps
// thin and identical (replit.md parity).

import {
  canonicalize,
  collectSpecAliases,
  sanitizeSpecAliases,
  pickAlias,
  type CanonicalResult,
  type SheetGrid,
  type SpecImportAlias,
  type SpecMixDraft,
} from "@workspace/spec-import";
import {
  isCelluloseIngredient,
  normalizeMix,
  type Mix,
  type MixComponent,
} from "@workspace/mixes";

export type { SheetGrid, SpecImportAlias };

// ── Parsed shapes ────────────────────────────────────────────────────────────

export type ParsedPremixComponent = {
  /** Ingredient name (first line of the cell, trimmed). */
  ingredient: string;
  /** Per-pizza amount (lbs). 0 when the sheet leaves the "Per Pizza" cell blank
   *  (a flat per-batch addition — the Mix model only carries per-pizza). */
  perPizza: number;
  /** Per-batch amount (lbs) straight from the sheet; kept for reference/debug. */
  perBatch: number;
};

export type ParsedPremix = {
  /** Mix name as printed above the block. */
  name: string;
  /** Resolved brand (empty until grounded / AI-matched). */
  brand: string;
  /** Resolved flavor (empty until grounded / AI-matched). */
  flavor: string;
  /** Pounds of finished mix per batch (the block's "Total" Per Batch value). */
  batchSize: number;
  /** "Pull N days early" lead time parsed from a note; 0 when absent. */
  daysEarly: number;
  /** Cleaned note line (e.g. "Pull 3 Days Early"), when present. */
  notes?: string;
  /**
   * The specific ingredient(s) the "Pull N days early" note points at — either
   * the note shares the ingredient's own cell, or it sits as a header directly
   * above the block and flags the first ingredient row. Empty when the note is
   * absent or targets no ingredient (e.g. "PULL OLD MIX 2 DAYS PRIOR").
   */
  pullIngredients: string[];
  /**
   * Lead time for `pullIngredients` when it differs from the mix's own
   * `daysEarly` — set when a sheet-level pull ANNOTATION table (a standalone
   * note + ingredient mini-table beside the mix) was folded into this block.
   * Absent → the pull uses `daysEarly`.
   */
  pullDaysEarly?: number;
  components: ParsedPremixComponent[];
  /** Source worksheet tab (for display / de-dup hints). */
  sheetName: string;
};

// ── Cell helpers ─────────────────────────────────────────────────────────────

function cell(rows: string[][], r: number, c: number): string {
  const row = rows[r];
  if (!row) return "";
  const v = row[c];
  return v == null ? "" : String(v).trim();
}

/** First line of a (possibly multi-line) cell, trimmed. */
function firstLine(s: string): string {
  return s.split(/\r?\n/)[0]!.trim();
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse a numeric cell; returns null when not a finite number. */
function parseNum(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const PER_PIZZA_RE = /per\s*t?\s*pizza/i; // tolerates the "Pert Pizza" typo
const TOTAL_RE = /^total$/;

// Footer / summary labels that are NOT components. Matched on the normalized
// ingredient-column text (prefix match). Tolerates the sheet's typos
// ("TOTAL AMOUTN", "#OF MIXES", etc.).
const STOP_LABEL_RE =
  /^(max batches|total cases|cases needed|total amount|total amoutn|amount needed|amount of mix|total needed|amount already|amount being|amount drained|pull for mix|#\s*of mixes|per batch|per\s*t?\s*pizza|pounds|lbs)\b/;

// "Pull 3 Days Early" / "PULL OLD MIX 2 DAYS PRIOR" → captures the day count.
const DAYS_EARLY_RE = /pull\s+(?:old\s+mix\s+)?(\d+)\s+days?\s+(?:early|prior|ahead|before)/i;

// Third header column of a pull ANNOTATION mini-table ("Per Pizza | Per
// Skid/Batch | Total Needed") — real mix blocks never carry this header.
const TOTAL_NEEDED_RE = /^total\s*needed/i;

// ── Workbook parsing (deterministic) ─────────────────────────────────────────

type Anchor = { row: number; perPizzaCol: number };

function findAnchors(rows: string[][]): Anchor[] {
  const out: Anchor[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (PER_PIZZA_RE.test(cell(rows, r, c))) {
        out.push({ row: r, perPizzaCol: c });
      }
    }
  }
  return out;
}

/**
 * Pick the mix name out of a cell, skipping decorative "***Pull N Days***" note
 * lines that sometimes share the name cell. Returns "" when the cell holds only
 * a note / asterisks.
 */
function pickNameFromCell(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    if (DAYS_EARLY_RE.test(line)) continue;
    const stripped = line.replace(/\*+/g, "").trim();
    if (stripped) return stripped;
  }
  return "";
}

/**
 * Scan up to 4 rows above the header for the block's name (ingredient column).
 * Skips footer/summary labels ("AMOUNT BEING MIXED", "Amount already made",
 * ...) — a block anchored below another block's footer must not steal a
 * summary label as its name.
 */
function findBlockName(rows: string[][], headerRow: number, ingredientCol: number): string {
  for (let r = headerRow - 1; r >= 0 && r >= headerRow - 4; r--) {
    const v = pickNameFromCell(cell(rows, r, ingredientCol));
    if (v && !STOP_LABEL_RE.test(norm(v))) return v;
  }
  return "";
}

function findDaysEarly(
  rows: string[][],
  startCol: number,
  endCol: number,
): { daysEarly: number; notes?: string; noteRow: number | null } {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const lastCol = Math.min(endCol, row.length);
    for (let c = startCol; c < lastCol; c++) {
      const raw = cell(rows, r, c);
      if (!raw) continue;
      const m = raw.match(DAYS_EARLY_RE);
      if (m) {
        const days = Number(m[1]);
        // Keep the specific line that mentions the pull note, stripped of the
        // sheet's decorative asterisks.
        const line =
          raw
            .split(/\r?\n/)
            .find((l) => DAYS_EARLY_RE.test(l)) ?? raw;
        const notes = line.replace(/\*+/g, "").trim();
        return {
          daysEarly: Number.isFinite(days) ? days : 0,
          notes: notes || undefined,
          noteRow: r,
        };
      }
    }
  }
  return { daysEarly: 0, noteRow: null };
}

type ParsedBlock = {
  premix: ParsedPremix;
  /**
   * True when this block is a pull ANNOTATION mini-table, not a real mix: the
   * standalone "Pull N Days Early" note sits where the name would be, the
   * header carries a "Total Needed" column (real mix blocks never do), and no
   * real name was found. These get folded into the sheet's real mix block.
   */
  isPullAnnotation: boolean;
  ingredientCol: number;
  anchorRow: number;
};

function parseBlock(
  grid: SheetGrid,
  anchor: Anchor,
  blockEndCol: number,
): ParsedBlock | null {
  const rows = grid.rows;
  const perPizzaCol = anchor.perPizzaCol;
  const perBatchCol = perPizzaCol + 1;
  const ingredientCol = perPizzaCol - 1;
  if (ingredientCol < 0) return null;

  const name = findBlockName(rows, anchor.row, ingredientCol);

  const components: ParsedPremixComponent[] = [];
  // Ingredients whose OWN cell carries the "Pull N days early" note (the note
  // shares the cell, e.g. "***Pull 3 Days Early***\nScrambled Egg").
  const notedIngredients: string[] = [];
  let firstComponentIngredient = "";
  let batchSize = 0;
  for (let r = anchor.row + 1; r < rows.length; r++) {
    const label = cell(rows, r, ingredientCol);
    const n = norm(label);
    if (TOTAL_RE.test(n)) {
      // The block's Total row carries the per-batch pounds and ends the table.
      batchSize = parseNum(cell(rows, r, perBatchCol)) ?? 0;
      break;
    }
    if (!label) continue; // blank spacer row
    if (STOP_LABEL_RE.test(n)) break; // ran into the footer without a Total
    const perPizza = parseNum(cell(rows, r, perPizzaCol));
    const perBatch = parseNum(cell(rows, r, perBatchCol));
    if (perPizza == null && perBatch == null) continue; // not a quantity row
    // Skip decorative pull-note lines when picking the ingredient name — some
    // sheets write the note INTO the ingredient's cell above the name.
    const ingredient = pickNameFromCell(label) || firstLine(label);
    components.push({
      ingredient,
      perPizza: perPizza ?? 0,
      perBatch: perBatch ?? 0,
    });
    if (!firstComponentIngredient) firstComponentIngredient = ingredient;
    if (DAYS_EARLY_RE.test(label)) notedIngredients.push(ingredient);
  }

  if (!name && components.length === 0) return null;

  const { daysEarly, notes, noteRow } = findDaysEarly(rows, ingredientCol, blockEndCol);

  // Which ingredient does the pull note point at?
  // 1) An ingredient whose own cell carries the note wins.
  // 2) A standalone note sitting just above the block's header (the sheets put
  //    it 1 row above "Per Pizza") flags the block's FIRST ingredient row.
  // 3) Otherwise (note far away, e.g. a bottom "PULL OLD MIX" line, or no note
  //    at all) no specific ingredient is flagged — daysEarly stays mix-level.
  let pullIngredients = notedIngredients;
  if (
    pullIngredients.length === 0 &&
    daysEarly > 0 &&
    noteRow != null &&
    noteRow <= anchor.row &&
    noteRow >= anchor.row - 4 &&
    firstComponentIngredient
  ) {
    pullIngredients = [firstComponentIngredient];
  }
  // De-dup case-insensitively (a block may repeat the noted ingredient).
  const seenPull = new Set<string>();
  pullIngredients = pullIngredients.filter((ing) => {
    const key = ing.toLowerCase();
    if (seenPull.has(key)) return false;
    seenPull.add(key);
    return true;
  });

  const isPullAnnotation =
    !name &&
    daysEarly > 0 &&
    noteRow != null &&
    noteRow <= anchor.row &&
    noteRow >= anchor.row - 4 &&
    TOTAL_NEEDED_RE.test(cell(rows, anchor.row, perPizzaCol + 2).trim());

  return {
    premix: {
      name,
      brand: "",
      flavor: "",
      batchSize,
      daysEarly,
      notes,
      pullIngredients,
      components,
      sheetName: grid.name,
    },
    isPullAnnotation,
    ingredientCol,
    anchorRow: anchor.row,
  };
}

/**
 * Parse a premix workbook into candidate mixes. Handles tabs that hold multiple
 * mix blocks laid out horizontally (each anchored by its own "Per Pizza"
 * header). Fully deterministic — no AI, no quantity guessing. Blocks with no
 * name and no components are skipped.
 */
export function parsePremixWorkbook(grids: ReadonlyArray<SheetGrid>): ParsedPremix[] {
  const out: ParsedPremix[] = [];
  for (const grid of grids) {
    const anchors = findAnchors(grid.rows);
    const blocks: ParsedBlock[] = [];
    for (const anchor of anchors) {
      // A block ends where the next block (a later "Per Pizza" header in the
      // SAME row) begins; otherwise it runs to the end of the row width.
      const sameRowLater = anchors
        .filter((a) => a.row === anchor.row && a.perPizzaCol > anchor.perPizzaCol)
        .map((a) => a.perPizzaCol - 1);
      const blockEndCol = sameRowLater.length ? Math.min(...sameRowLater) : Number.MAX_SAFE_INTEGER;
      const block = parseBlock(grid, anchor, blockEndCol);
      if (block) blocks.push(block);
    }

    // Fold pull ANNOTATION mini-tables into the sheet's real mix block (the
    // closest one by ingredient column) instead of emitting them as phantom
    // mixes. An annotation-only sheet (no real block) keeps the block as-is so
    // the pull suggestion still has a carrier in the review UI.
    const real = blocks.filter((b) => !b.isPullAnnotation);
    for (const b of real) out.push(b.premix);
    for (const b of blocks) {
      if (!b.isPullAnnotation) continue;
      let target: ParsedBlock | null = null;
      for (const r of real) {
        if (
          !target ||
          Math.abs(r.ingredientCol - b.ingredientCol) <
            Math.abs(target.ingredientCol - b.ingredientCol) ||
          (Math.abs(r.ingredientCol - b.ingredientCol) ===
            Math.abs(target.ingredientCol - b.ingredientCol) &&
            r.anchorRow < target.anchorRow)
        ) {
          target = r;
        }
      }
      if (!target) {
        out.push(b.premix);
        continue;
      }
      const pulls = b.premix.pullIngredients.length
        ? b.premix.pullIngredients
        : b.premix.components.map((c) => c.ingredient);
      const seen = new Set(target.premix.pullIngredients.map((i) => i.toLowerCase()));
      for (const ing of pulls) {
        const key = ing.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        target.premix.pullIngredients.push(ing);
      }
      if (b.premix.daysEarly > 0) target.premix.pullDaysEarly = b.premix.daysEarly;
      if (!target.premix.notes && b.premix.notes) target.premix.notes = b.premix.notes;
    }
  }
  return out;
}

// ── Name grounding (deterministic, alias → exact → fuzzy → new) ───────────────

export type PremixKnown = {
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  /** Combined ingredient pool (cheese + dough + sauce/frontline) for grounding. */
  ingredients: string[];
};

const MIX_SUFFIX_RE = /\b(veggie\s+mix|cheese\s+mix|sauce\s+mix|topping\s+mix|mix)\s*$/i;

/** Drop a trailing " (N)" tab-dedupe suffix our exporter adds to unique-ify duplicate product tabs. */
function stripSheetDedupeSuffix(s: string): string {
  // Require the literal exporter pattern (space + "(N)") so a manually-authored
  // name ending in "(2)" without a space isn't stripped.
  return (s ?? "").replace(/\s\(\d+\)\s*$/, "").trim();
}

/** Strip trailing "… Mix" wording so a flavor reads cleanly. */
function stripMixSuffix(s: string): string {
  return s.replace(MIX_SUFFIX_RE, "").trim();
}

/**
 * Normalize one word for brand-prefix comparison: lowercase, strip
 * punctuation/apostrophes, and reduce inch-size tokens (7in / 7" / 7'' / 7)
 * to their bare digits so `Basha 11'` matches brand `Basha 11in`.
 */
function normBrandToken(t: string): string {
  const bare = t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const m = /^(\d+)(?:in|inch|inches)?$/.exec(bare);
  return m ? m[1] : bare;
}

/**
 * True when two normalized tokens match: equal, or (for words of 4+ chars)
 * within one edit of each other — covers real-world tab typos like
 * "Morming" for "Morning". Short/numeric tokens must match exactly.
 */
function brandTokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Single-edit check (substitute, insert, or delete one char).
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1);
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.slice(i) === longer.slice(i + 1);
}

/** Tokenize a string, keeping each token's end offset in the original. */
function brandTokens(s: string): { norm: string; end: number }[] {
  const out: { norm: string; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const norm = normBrandToken(m[0]);
    if (norm) out.push({ norm, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Best-effort deterministic split of a premix name into {brand, flavor} using
 * the known brand list: pick the LONGEST known brand whose words prefix the
 * name (or the source tab name), and treat the remainder as the flavor.
 * Comparison is word-by-word on normalized tokens (case/punctuation/apostrophe
 * insensitive, inch-marks unified) so real-world tab spellings like
 * "Lucias Craft …" still match the saved brand "Lucia's Craft". Returns empty
 * brand when nothing matches — those go to the AI matcher.
 */
export function splitPremixName(
  name: string,
  sheetName: string,
  brands: ReadonlyArray<string>,
): { brand: string; flavor: string } {
  // Prefer the sheet TAB name: real workbooks name each tab after the product
  // (brand + flavor) while the block name inside is often a shared base-mix
  // label (e.g. "White Fajita Veggie Mix") that would mis-attribute the mix.
  // Strip a trailing " (N)" tab-dedupe suffix off the TAB name only — our own
  // exporter appends it to make duplicate product tabs unique, and if it leaks
  // into the flavor guess (e.g. "Deluxe (2)") the product fails to ground.
  const candidates = [stripSheetDedupeSuffix(sheetName), name]
    .map((c) => c.trim())
    .filter(Boolean);
  const sorted = brands
    .map((brand) => ({ brand, toks: brandTokens(brand).map((t) => t.norm) }))
    .filter((b) => b.toks.length > 0)
    .sort((a, b) => b.toks.length - a.toks.length || b.brand.length - a.brand.length);
  for (const cand of candidates) {
    const candToks = brandTokens(cand);
    for (const { brand, toks } of sorted) {
      if (toks.length > candToks.length) continue;
      let ok = true;
      for (let i = 0; i < toks.length; i++) {
        if (!brandTokenMatches(candToks[i].norm, toks[i])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const cut = candToks[toks.length - 1].end;
      const rest = stripMixSuffix(cand.slice(cut).replace(/^[\s,:-]+/, ""));
      return { brand, flavor: rest };
    }
  }
  return { brand: "", flavor: stripMixSuffix(name) };
}

/**
 * Fallback flavor match: pick the UNIQUE known flavor whose words contain the
 * guessed flavor's words as an in-order subsequence (word-by-word, same
 * normalization/typo tolerance as brand matching). Covers short tab labels
 * like "Red Hot" → "RED HOT CHICKEN" or "Club" → "CHICKEN BACON CLUB".
 * Returns "" when zero or multiple known flavors qualify (ambiguity goes to
 * the AI matcher / manual re-match instead of a guess).
 */
export function matchFlavorBySubsequence(
  guess: string,
  knownFlavors: ReadonlyArray<string>,
): string {
  const guessToks = brandTokens(guess).map((t) => t.norm);
  if (guessToks.length === 0) return "";
  const hits: string[] = [];
  for (const flavor of knownFlavors) {
    const toks = brandTokens(flavor).map((t) => t.norm);
    let gi = 0;
    for (let i = 0; i < toks.length && gi < guessToks.length; i++) {
      if (brandTokenMatches(guessToks[gi], toks[i])) gi++;
    }
    if (gi === guessToks.length) hits.push(flavor);
  }
  return hits.length === 1 ? hits[0] : "";
}

export type GroundedPremix = {
  mix: ParsedPremix;
  /** True when both brand and flavor resolved to a real (non-"new") name. */
  productResolved: boolean;
  /** Resolved name results worth remembering as aliases. */
  resolved: { kind: "brand" | "flavor"; result: CanonicalResult; context?: string | null }[];
};

/**
 * Ground a parsed mix's brand, flavor, and component ingredient names against
 * the app's known lists + learned aliases (alias → exact → fuzzy → new). Pure.
 */
export function groundPremix(
  parsed: ParsedPremix,
  known: PremixKnown,
  aliases: ReadonlyArray<SpecImportAlias>,
): GroundedPremix {
  const guess = splitPremixName(parsed.name, parsed.sheetName, known.brands);
  let brandRes = canonicalize(guess.brand, known.brands, aliases, "brand");
  let brand = brandRes.value;
  let brandFlavors = known.flavorsByBrand[brand] ?? [];
  let flavorRes = canonicalize(guess.flavor, brandFlavors, aliases, "flavor", brand || null);
  if (flavorRes.source === "new" && guess.flavor) {
    const sub = matchFlavorBySubsequence(guess.flavor, brandFlavors);
    if (sub) flavorRes = { value: sub, source: "fuzzy", externalName: guess.flavor };
  }

  // Tab-name brand fallback: when the mix name (and the tab prefix match) didn't
  // resolve a known brand — e.g. because the tab still carries an OLD customer
  // name that lives only in the learned alias map, not in the current known-brands
  // list — try canonicalising the raw tab name directly through aliases. This
  // covers the renamed-customer case that splitPremixName misses (it checks the
  // known-brands list directly, not aliases). Also fires when the tab name IS
  // exactly the brand but no mix inside has the brand as a name prefix.
  if (!brand) {
    const tabRaw = stripSheetDedupeSuffix(parsed.sheetName ?? "").trim();
    if (tabRaw) {
      const tabBrandRes = canonicalize(tabRaw, known.brands, aliases, "brand");
      if (tabBrandRes.value && tabBrandRes.source !== "new") {
        brandRes = tabBrandRes;
        brand = tabBrandRes.value;
        brandFlavors = known.flavorsByBrand[brand] ?? [];
        // Re-derive flavor from the mix name alone (no tab contribution) —
        // e.g. tab = "Lucia's", mix = "Herb Mix" → flavor guess = "Herb".
        const nameOnlyGuess = splitPremixName(parsed.name, "", known.brands);
        flavorRes = canonicalize(nameOnlyGuess.flavor, brandFlavors, aliases, "flavor", brand);
        if (flavorRes.source === "new" && nameOnlyGuess.flavor) {
          const sub = matchFlavorBySubsequence(nameOnlyGuess.flavor, brandFlavors);
          if (sub) flavorRes = { value: sub, source: "fuzzy", externalName: nameOnlyGuess.flavor };
        }
      }
    }
  }

  const flavor = flavorRes.value;

  const components = parsed.components.map((c) => ({
    ...c,
    ingredient: canonicalize(c.ingredient, known.ingredients, aliases, "sauceIngredient").value,
  }));

  // Canonicalize the pull-note ingredient(s) the same way, so a freezer-pull
  // setting created from the note matches the app's real ingredient name.
  const pullIngredients = parsed.pullIngredients.map(
    (ing) => canonicalize(ing, known.ingredients, aliases, "sauceIngredient").value,
  );

  const productResolved =
    !!brand && !!flavor && brandRes.source !== "new" && flavorRes.source !== "new";

  return {
    mix: { ...parsed, brand, flavor, components, pullIngredients },
    productResolved,
    resolved: [
      { kind: "brand", result: brandRes },
      { kind: "flavor", result: flavorRes, context: brand || null },
    ],
  };
}

/** Collect brand/flavor alias pairs worth persisting from grounded results. */
export function collectPremixAliases(grounded: ReadonlyArray<GroundedPremix>): SpecImportAlias[] {
  return collectSpecAliases(grounded.flatMap((g) => g.resolved));
}

// ── AI match output: server/client sanitizer ─────────────────────────────────

export type PremixMatch = { name: string; brand: string; flavor: string };

/**
 * The name string sent to (and matched back from) the AI product matcher for
 * an unresolved mix. Prefer the sheet TAB name — real workbooks name tabs
 * after the product, while the block label inside can be a copy-paste from a
 * different product's template (which would mislead the AI the same way it
 * misleads the deterministic split). Fall back to the block name when the tab
 * looks generic (fewer than two words, e.g. "Sheet1").
 */
export function premixMatchName(mix: Pick<ParsedPremix, "name" | "sheetName">): string {
  const tab = (mix.sheetName ?? "").trim();
  if (tab && brandTokens(tab).length >= 2) return tab;
  return mix.name.trim();
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Canonicalize + bound the AI matcher's output back to the known lists. The
 * model only disambiguates names, so a match is kept ONLY when its brand maps to
 * a real known brand; the flavor is canonicalized within that brand (a brand-new
 * flavor under a known brand is allowed through as-is). Hallucinated brands are
 * dropped. Never throws.
 */
export function sanitizePremixMatches(
  raw: unknown,
  known: PremixKnown,
  aliases: ReadonlyArray<SpecImportAlias> = [],
): PremixMatch[] {
  const root = (raw ?? {}) as { matches?: unknown };
  const list = Array.isArray(root.matches) ? root.matches : [];
  const out: PremixMatch[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = asString(rec.name);
    const brandRaw = asString(rec.brand);
    const flavorRaw = asString(rec.flavor);
    if (!name || !brandRaw) continue;
    const brandRes = canonicalize(brandRaw, known.brands, aliases, "brand");
    if (brandRes.source === "new") continue; // hallucinated brand → drop
    const brand = brandRes.value;
    let flavor = "";
    if (flavorRaw) {
      const brandFlavors = known.flavorsByBrand[brand] ?? [];
      const flavorRes = canonicalize(flavorRaw, brandFlavors, aliases, "flavor", brand);
      flavor =
        flavorRes.source === "new"
          ? matchFlavorBySubsequence(flavorRaw, brandFlavors) || flavorRes.value
          : flavorRes.value;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, brand, flavor });
  }
  return out;
}

/** Apply AI matches onto parsed mixes by name (case-insensitive). Pure. */
export function applyPremixMatches(
  mixes: ReadonlyArray<ParsedPremix>,
  matches: ReadonlyArray<PremixMatch>,
  onlyNames?: ReadonlyArray<string>,
): ParsedPremix[] {
  const byName = new Map<string, PremixMatch>();
  for (const m of matches) byName.set(m.name.trim().toLowerCase(), m);
  // When the caller says which names it sent to the matcher, only touch those
  // mixes — tab-keyed matches must not overwrite a sibling block on the same
  // tab that already resolved deterministically.
  const allow = onlyNames ? new Set(onlyNames.map((n) => n.trim().toLowerCase())) : null;
  return mixes.map((mix) => {
    const keys = [premixMatchName(mix).toLowerCase(), mix.name.trim().toLowerCase()];
    if (allow && !keys.some((k) => allow.has(k))) return mix;
    const m = byName.get(keys[0]) ?? byName.get(keys[1]);
    if (!m) return mix;
    return { ...mix, brand: m.brand, flavor: m.flavor };
  });
}

// ── Conversion to the Mix model ──────────────────────────────────────────────

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic, stable id for an imported mix so re-importing the same sheet
 * UPDATES the mix instead of creating a duplicate (the server upserts by id).
 */
export function premixId(parsed: Pick<ParsedPremix, "brand" | "flavor" | "name">): string {
  return `premix-${slug(parsed.brand)}-${slug(parsed.flavor)}-${slug(parsed.name)}`;
}

/**
 * Convert a parsed (and grounded/matched) premix into a normalized Mix.
 *
 * `perPizzaOnly` (opt-in) drops the per-batch-only rows — the sheet's flat
 * "prep for the run" additions (e.g. fresh spinach) that carry a Per Batch
 * amount but no Per Pizza amount. Per the operator's model those rows are NOT
 * per-pizza mix ingredients; they belong to prep / pull-early, so keeping them
 * as phantom 0-oz components just clutters the mix and does nothing in make-day
 * math. Default (false) preserves the legacy behavior (all rows kept) so the
 * paused mobile glue and existing callers are unaffected.
 */
export function premixToMix(
  parsed: ParsedPremix,
  opts: { perPizzaOnly?: boolean } = {},
): Mix | null {
  const source = opts.perPizzaOnly
    ? parsed.components.filter((c) => c.perPizza > 0)
    : parsed.components;
  const components: MixComponent[] = source.map((c) => ({
    ingredient: c.ingredient,
    perPizza: c.perPizza,
    // The premix sheet is the ONLY source for per-batch pounds — carry them
    // into the reference-only lbs/batch column (normalizeMix drops <= 0).
    ...(c.perBatch > 0 ? { perBatchLbs: c.perBatch } : {}),
  }));
  return normalizeMix({
    id: premixId(parsed),
    name: parsed.name,
    brand: parsed.brand,
    flavor: parsed.flavor,
    batchSize: parsed.batchSize,
    daysEarly: parsed.daysEarly,
    notes: parsed.notes ?? "",
    amountAlreadyMade: 0,
    components,
    enabled: true,
  });
}

/**
 * Convert a spec-import-detected mix draft into a normalized Mix. Uses the SAME
 * deterministic id as the premix importer (premixId) so a mix first seen in a
 * spec sheet and later re-imported from a premix sheet converge onto ONE row
 * instead of duplicating. Per-pizza oz amounts come from the spec sheet's
 * ingredient rows (the same `row.lbs` parser quirk the cheese collector uses).
 * Batch size is not expressed on a spec sheet and stays at 0 for the manager
 * to fill in the Mixes editor. Returns null for a blank name.
 */
export function specMixDraftToMix(draft: SpecMixDraft): Mix | null {
  const name = draft.name.trim();
  if (!name) return null;
  const components: MixComponent[] = draft.components
    .map(({ ingredient, perPizza }) => ({ ingredient: ingredient.trim(), perPizza }))
    .filter(({ ingredient }) => ingredient.length > 0);
  return normalizeMix({
    id: premixId({ brand: draft.brand, flavor: draft.flavor, name }),
    name,
    brand: draft.brand,
    flavor: draft.flavor,
    batchSize: 0,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components,
    enabled: true,
  });
}

// ── Prep / per-batch-only split ──────────────────────────────────────────────

/**
 * Ingredients that need run-day prep even when they ARE a real per-pizza mix
 * ingredient (e.g. "Pineapple - Drained" → drain the juices before use). The
 * sheet carries no structural marker for these — the only signal is the name —
 * so they're matched by name and surfaced as a reminder WITHOUT being removed
 * from the mix. Kept deliberately narrow to avoid false positives.
 */
export const PREMIX_PREP_RE = /\bpineapple\b|\bdrain(?:ed|ing)?\b/i;

/** A "prep for the run" row surfaced out of a mix. */
export type PremixPrepItem = {
  /** The block/product the prep row was listed under (for display context). */
  mixName: string;
  ingredient: string;
  /** Per-batch amount (lbs) straight from the sheet. */
  perBatch: number;
  /**
   * True when this row is ALSO a per-pizza mix ingredient — a prep reminder
   * (e.g. drain the juices) that STAYS in the mix, not a row split out of it.
   * Absent → a per-batch-only row that was left out of the mix.
   */
  alsoInMix?: boolean;
};

/**
 * True when a parsed block has NO per-pizza ingredient at all — every row is a
 * flat per-batch / prep addition. Such a block is prep, not a mix, so the web
 * importer skips it (its rows still surface via `collectPremixPrepItems`).
 */
export function isPrepOnlyPremix(parsed: ParsedPremix): boolean {
  return !parsed.components.some((c) => c.perPizza > 0);
}

/**
 * Collect the per-batch-only rows split out of the parsed blocks — the "prep for
 * the run" ingredients (e.g. fresh spinach) the operator does NOT want treated
 * as per-pizza mix ingredients. Surfaced read-only in the review dialog so the
 * split is visible and nothing silently vanishes from a mix. Pure.
 */
export function collectPremixPrepItems(
  parsed: ReadonlyArray<ParsedPremix>,
): PremixPrepItem[] {
  const out: PremixPrepItem[] = [];
  const seen = new Set<string>();
  for (const p of parsed) {
    const mixName = p.name.trim();
    for (const c of p.components) {
      const ingredient = c.ingredient.trim();
      if (!ingredient) continue;
      const perBatchOnly = !(c.perPizza > 0);
      // Two kinds of prep: (1) per-batch-only rows split OUT of the mix, and
      // (2) real per-pizza ingredients whose NAME says they need run-day prep
      // (e.g. "Pineapple - Drained") — those STAY in the mix but are surfaced
      // as a reminder too.
      const nameFlag = !perBatchOnly && PREMIX_PREP_RE.test(ingredient);
      if (!perBatchOnly && !nameFlag) continue;
      const key = `${mixName.toLowerCase()}::${ingredient.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        mixName,
        ingredient,
        perBatch: c.perBatch,
        ...(nameFlag ? { alsoInMix: true } : {}),
      });
    }
  }
  return out;
}

// ── Freezer-pull suggestions ─────────────────────────────────────────────────

/** One "set this freezer-pull setting" suggestion picked out of a pull note. */
export type PremixFreezerPull = { ingredient: string; daysEarly: number };

/**
 * Collect the freezer-pull settings suggested by the parsed pull notes, keyed
 * by the mix's deterministic id (the same id `premixToMix` gives it, so the
 * review UI can show/apply them per included mix). Only mixes with a positive
 * daysEarly AND a specific flagged ingredient produce suggestions; duplicate
 * blocks with the same id override earlier ones (mirrors the mix de-dup). Pure.
 */
export function collectPremixFreezerPulls(
  parsed: ReadonlyArray<ParsedPremix>,
): Record<string, PremixFreezerPull[]> {
  const out: Record<string, PremixFreezerPull[]> = {};
  for (const p of parsed) {
    const days = p.pullDaysEarly ?? p.daysEarly;
    if (days <= 0 || p.pullIngredients.length === 0) continue;
    const seen = new Set<string>();
    const pulls: PremixFreezerPull[] = [];
    for (const ing of p.pullIngredients) {
      const name = ing.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pulls.push({ ingredient: name, daysEarly: days });
    }
    if (pulls.length) out[premixId(p)] = pulls;
  }
  return out;
}

// ── Import summary + merge ───────────────────────────────────────────────────

export type PremixImportSummary = {
  total: number;
  created: number;
  updated: number;
};

/** One reviewable import candidate: the parsed mix + whether it's new or an update. */
export type PremixCandidate = {
  mix: Mix;
  status: "new" | "update";
};

/**
 * Pair each imported mix with its new-vs-update status so the UI can show a
 * per-mix review list (and let the manager include/exclude each one before
 * saving). `exists(id)` is supplied by the caller. Pure.
 */
export function buildPremixCandidates(
  mixes: ReadonlyArray<Mix>,
  exists: (id: string) => boolean,
): PremixCandidate[] {
  return mixes.map((mix) => ({ mix, status: exists(mix.id) ? "update" : "new" }));
}

/**
 * Re-point one reviewable candidate to a different brand/flavor — a manual
 * correction of the auto/AI match the manager makes in the review dialog. The
 * mix's deterministic id is rebuilt from the new product (so re-importing still
 * upserts correctly) and its new-vs-update status is recomputed against the
 * existing mixes. The mix name and parsed quantities are untouched. Pure.
 */
export function rematchPremixCandidate(
  candidate: PremixCandidate,
  brand: string,
  flavor: string,
  exists: (id: string) => boolean,
): PremixCandidate {
  const nextBrand = brand.trim();
  const nextFlavor = flavor.trim();
  const mix =
    normalizeMix({
      ...candidate.mix,
      brand: nextBrand,
      flavor: nextFlavor,
      id: premixId({ brand: nextBrand, flavor: nextFlavor, name: candidate.mix.name }),
    }) ??
    // normalizeMix only returns null for a mix with no usable name; a reviewed
    // candidate always has one, so fall back to the original mix defensively.
    candidate.mix;
  return { mix, status: exists(mix.id) ? "update" : "new" };
}

/** The identity of an EXISTING saved mix a reviewed candidate can redirect onto. */
export type MixRedirectTarget = {
  id: string;
  name: string;
  brand: string;
  flavor: string;
};

/**
 * Redirect one reviewable candidate onto an EXISTING saved mix — the manager's
 * explicit "this sheet block is really that mix" pick in the review dialog. The
 * candidate keeps its freshly parsed quantities (components, batch size,
 * days-early note) but takes over the existing mix's identity (id + name +
 * brand + flavor), so applying it UPDATES that mix in place instead of adding a
 * near-duplicate under the sheet's wording. Always an "update" by construction
 * (the target is a saved mix), but status is still recomputed via `exists` for
 * consistency with the other review transforms. Pure.
 */
export function redirectPremixCandidate(
  candidate: PremixCandidate,
  target: MixRedirectTarget,
  exists: (id: string) => boolean,
): PremixCandidate {
  const mix =
    normalizeMix({
      ...candidate.mix,
      id: target.id,
      name: target.name,
      brand: target.brand,
      flavor: target.flavor,
    }) ??
    // normalizeMix only returns null for a mix with no usable name; redirect
    // targets are saved mixes (always named), so fall back defensively.
    candidate.mix;
  return { mix, status: exists(mix.id) ? "update" : "new" };
}

/**
 * Work out which candidates a LEARNED alias redirects onto an existing mix —
 * the "remember my pick" half of the review dialog's "Use existing mix" select.
 * Returns candidate-mix-id → existing-mix-id for the review to pre-apply.
 *
 * Mix-name redirect picks are stored in the "appType" namespace (the shared
 * blend-name pool the spec importer's cheese/mix "Use existing recipe" picks
 * also write into), keyed by the sheet's mix name. BRAND-SCOPED aliases
 * (context = the candidate's brand) take precedence; the shared context-free
 * alias is only consulted when no brand-scoped one exists — so a redirect
 * confirmed for one customer's sheet never pre-selects on another brand's
 * import of the same generic mix name. A suggestion only fires when the
 * learned canonical name (ci) matches exactly ONE existing mix (or exactly one
 * of the candidate's own brand when several brands share the name); candidates
 * that are already clean exact-id updates are skipped, and a target claimed by
 * MORE THAN ONE suggestion is dropped entirely — two redirects onto the same
 * mix would collide in the last-write-wins merge and silently lose one block's
 * data. The target's OWN exact-id update does NOT veto a suggestion: after a
 * Manage Lists merge of two blocks from the same workbook, a re-import carries
 * both the survivor's block (exact update) and the merged-away block (alias →
 * survivor) — the review shows the link so the manager can uncheck either,
 * instead of silently resurrecting the merged-away mix as "new". Pure.
 */
export function suggestPremixRedirects(
  candidates: ReadonlyArray<PremixCandidate>,
  existing: ReadonlyArray<Mix>,
  aliases: ReadonlyArray<SpecImportAlias>,
): Record<string, string> {
  const appTypeAliases = sanitizeSpecAliases(aliases).filter((a) => a.kind === "appType");
  const contextFree = appTypeAliases.filter((a) => (a.context ?? null) === null);
  // NOTE: no early-out when there are no appType aliases — the brand-drift
  // fallback below must still run (it matches by name+brand, not by alias).

  // Existing mixes by lowercased name — ALL rows kept so a shared name can
  // still resolve when exactly one of them belongs to the candidate's brand.
  const byName = new Map<string, MixRedirectTarget[]>();
  for (const m of existing) {
    const key = m.name.trim().toLowerCase();
    if (!key) continue;
    let list = byName.get(key);
    if (!list) byName.set(key, (list = []));
    if (!list.some((t) => t.id === m.id)) {
      list.push({ id: m.id, name: m.name, brand: m.brand, flavor: m.flavor });
    }
  }
  const brandKey = (b: string | undefined) => (b ?? "").trim().toLowerCase();

  const existingIds = new Set(existing.map((m) => m.id));
  const proposed: { from: string; to: string }[] = [];
  for (const c of candidates) {
    if (existingIds.has(c.mix.id)) continue; // already a clean exact-id update
    const brand = (c.mix.brand ?? "").trim();
    // Brand-scoped alias first, shared context-free alias as fallback.
    const canon =
      (brand ? pickAlias(appTypeAliases, "appType", c.mix.name, brand) : null) ??
      pickAlias(contextFree, "appType", c.mix.name);
    let target: MixRedirectTarget | undefined;
    if (canon) {
      const matches = byName.get(canon.trim().toLowerCase()) ?? [];
      target = matches.length === 1 ? matches[0] : undefined;
      if (!target && matches.length > 1 && brand) {
        // Several brands share the canonical name: only the candidate's own
        // brand's mix is a safe target, and only when it is unique.
        const sameBrand = matches.filter((t) => brandKey(t.brand) === brandKey(brand));
        if (sameBrand.length === 1) target = sameBrand[0];
      }
    } else if (brand) {
      // Brand-drift fallback (no name alias): after a customer-group RENAME,
      // the pool row keeps its old-brand-derived id but carries the new brand,
      // while the re-imported candidate's brand is remapped by the learned
      // "brand" alias — so its recomputed id no longer matches. When exactly
      // ONE saved mix has the SAME name AND SAME brand (ci), redirect onto it
      // instead of adding a same-name duplicate inside the renamed group.
      // Conservative on purpose: exact name only, branded candidates only,
      // unique same-brand match only (flavor tie-break when several).
      const matches = (byName.get(c.mix.name.trim().toLowerCase()) ?? []).filter(
        (t) => brandKey(t.brand) === brandKey(brand),
      );
      if (matches.length === 1) target = matches[0];
      else if (matches.length > 1) {
        const flavorKey = (c.mix.flavor ?? "").trim().toLowerCase();
        const sameFlavor = matches.filter(
          (t) => (t.flavor ?? "").trim().toLowerCase() === flavorKey,
        );
        if (sameFlavor.length === 1) target = sameFlavor[0];
      }
    }
    if (!target || target.id === c.mix.id) continue;
    // Never redirect a branded candidate onto a DIFFERENT brand's mix.
    if (brand && brandKey(target.brand) && brandKey(target.brand) !== brandKey(brand)) continue;
    proposed.push({ from: c.mix.id, to: target.id });
  }

  // One-to-one guard: tally SUGGESTION claims on each target id and keep only
  // uniquely-claimed suggestions. The target's own exact-id update is NOT a
  // veto — a learned alias is an explicit past decision (merge or "use
  // existing" pick), and the review surfaces the link for the manager to
  // accept/clear; dropping it would resurrect the merged-away mix instead.
  const claims = new Map<string, number>();
  const bump = (id: string) => claims.set(id, (claims.get(id) ?? 0) + 1);
  for (const p of proposed) bump(p.to);

  const out: Record<string, string> = {};
  for (const p of proposed) {
    if ((claims.get(p.to) ?? 0) === 1) out[p.from] = p.to;
  }
  return out;
}

/**
 * Count how many imported mixes are new vs would overwrite an existing one.
 * `exists(id)` is supplied by the caller (reads platform storage). Pure.
 */
export function summarizePremixImport(
  mixes: ReadonlyArray<Mix>,
  exists: (id: string) => boolean,
): PremixImportSummary {
  let created = 0;
  let updated = 0;
  for (const m of mixes) {
    if (exists(m.id)) updated++;
    else created++;
  }
  return { total: mixes.length, created, updated };
}

// A "Pull N Days Early" note line (the only note the sheet format carries).
// Mirrors DAYS_EARLY_RE but matches anywhere so it can classify note lines.
const PULL_NOTE_LINE_RE = /pull\s+(?:old\s+mix\s+)?\d+\s+days?\s+(?:early|prior|ahead|before)/i;

/**
 * Merge notes for an id-matched update. The sheet format only ever carries the
 * "Pull N Days Early" line, so custom notes on the existing mix (e.g. "Mix
 * cold") must survive a re-import. Policy: keep the existing mix's non-pull
 * note lines, and take the pull-note line from the IMPORT (it reflects the
 * sheet's current daysEarly — including its absence when daysEarly is now 0).
 */
function mergeMixNotes(existingNotes: string | undefined, importedNotes: string | undefined): string {
  const customLines = (existingNotes ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !PULL_NOTE_LINE_RE.test(l));
  const importedLines = (importedNotes ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) => l && !customLines.some((c) => c.toLowerCase() === l.toLowerCase()),
    );
  return [...customLines, ...importedLines].join("\n");
}

/**
 * Upsert imported mixes into the existing list by id (imported wins on the
 * fields the sheet carries). The premix sheet format does NOT carry a mix's
 * on-hand amount (`amountAlreadyMade`), its `enabled` flag, or free-form custom
 * notes — so on an id-matched update those are kept from the existing mix
 * instead of being reset by the import (see mergeMixNotes for the note policy).
 * Cellulose is also retained when omitted because it is a manager-maintained
 * preservative addition rather than a reliably sheet-carried component.
 * Existing mixes not in the import are preserved. Pure.
 */
export function mergePremixIntoMixes(
  existing: ReadonlyArray<Mix>,
  imported: ReadonlyArray<Mix>,
): Mix[] {
  const byId = new Map<string, Mix>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of imported) {
    const prev = byId.get(m.id);
    if (!prev) {
      byId.set(m.id, m);
      continue;
    }
    const importedHasCellulose = m.components.some((c) =>
      isCelluloseIngredient(c.ingredient),
    );
    const merged: Mix = {
      ...m,
      components: [
        ...m.components,
        ...(importedHasCellulose
          ? []
          : prev.components.filter((c) => isCelluloseIngredient(c.ingredient))),
      ],
      amountAlreadyMade: prev.amountAlreadyMade,
      enabled: prev.enabled,
    };
    const notes = mergeMixNotes(prev.notes, m.notes);
    if (notes) merged.notes = notes;
    else delete merged.notes;
    byId.set(m.id, merged);
  }
  return [...byId.values()];
}
