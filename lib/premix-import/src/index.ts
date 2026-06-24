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
  type CanonicalResult,
  type SheetGrid,
  type SpecImportAlias,
} from "@workspace/spec-import";
import { normalizeMix, type Mix, type MixComponent } from "@workspace/mixes";

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

/** Scan up to 4 rows above the header for the block's name (ingredient column). */
function findBlockName(rows: string[][], headerRow: number, ingredientCol: number): string {
  for (let r = headerRow - 1; r >= 0 && r >= headerRow - 4; r--) {
    const v = pickNameFromCell(cell(rows, r, ingredientCol));
    if (v) return v;
  }
  return "";
}

function findDaysEarly(
  rows: string[][],
  startCol: number,
  endCol: number,
): { daysEarly: number; notes?: string } {
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
        return { daysEarly: Number.isFinite(days) ? days : 0, notes: notes || undefined };
      }
    }
  }
  return { daysEarly: 0 };
}

function parseBlock(
  grid: SheetGrid,
  anchor: Anchor,
  blockEndCol: number,
): ParsedPremix | null {
  const rows = grid.rows;
  const perPizzaCol = anchor.perPizzaCol;
  const perBatchCol = perPizzaCol + 1;
  const ingredientCol = perPizzaCol - 1;
  if (ingredientCol < 0) return null;

  const name = findBlockName(rows, anchor.row, ingredientCol);

  const components: ParsedPremixComponent[] = [];
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
    components.push({
      ingredient: firstLine(label),
      perPizza: perPizza ?? 0,
      perBatch: perBatch ?? 0,
    });
  }

  if (!name && components.length === 0) return null;

  const { daysEarly, notes } = findDaysEarly(rows, ingredientCol, blockEndCol);

  return {
    name,
    brand: "",
    flavor: "",
    batchSize,
    daysEarly,
    notes,
    components,
    sheetName: grid.name,
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
    for (const anchor of anchors) {
      // A block ends where the next block (a later "Per Pizza" header in the
      // SAME row) begins; otherwise it runs to the end of the row width.
      const sameRowLater = anchors
        .filter((a) => a.row === anchor.row && a.perPizzaCol > anchor.perPizzaCol)
        .map((a) => a.perPizzaCol - 1);
      const blockEndCol = sameRowLater.length ? Math.min(...sameRowLater) : Number.MAX_SAFE_INTEGER;
      const block = parseBlock(grid, anchor, blockEndCol);
      if (block) out.push(block);
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

/** Strip trailing "… Mix" wording so a flavor reads cleanly. */
function stripMixSuffix(s: string): string {
  return s.replace(MIX_SUFFIX_RE, "").trim();
}

/**
 * Best-effort deterministic split of a premix name into {brand, flavor} using
 * the known brand list: pick the LONGEST known brand that prefixes the name (or
 * the source tab name), and treat the remainder as the flavor. Returns empty
 * brand when nothing matches — those go to the AI matcher.
 */
export function splitPremixName(
  name: string,
  sheetName: string,
  brands: ReadonlyArray<string>,
): { brand: string; flavor: string } {
  const candidates = [name, sheetName].map((c) => c.trim()).filter(Boolean);
  const sorted = [...brands].sort((a, b) => b.length - a.length);
  for (const cand of candidates) {
    const lc = cand.toLowerCase();
    for (const brand of sorted) {
      const b = brand.trim().toLowerCase();
      if (!b) continue;
      if (lc === b || lc.startsWith(b + " ")) {
        const rest = stripMixSuffix(cand.slice(brand.length).replace(/^[\s,:-]+/, ""));
        return { brand, flavor: rest };
      }
    }
  }
  return { brand: "", flavor: stripMixSuffix(name) };
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
  const brandRes = canonicalize(guess.brand, known.brands, aliases, "brand");
  const brand = brandRes.value;
  const flavorRes = canonicalize(
    guess.flavor,
    known.flavorsByBrand[brand] ?? [],
    aliases,
    "flavor",
    brand || null,
  );
  const flavor = flavorRes.value;

  const components = parsed.components.map((c) => ({
    ...c,
    ingredient: canonicalize(c.ingredient, known.ingredients, aliases, "sauceIngredient").value,
  }));

  const productResolved =
    !!brand && !!flavor && brandRes.source !== "new" && flavorRes.source !== "new";

  return {
    mix: { ...parsed, brand, flavor, components },
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
    const flavor = flavorRaw
      ? canonicalize(flavorRaw, known.flavorsByBrand[brand] ?? [], aliases, "flavor", brand).value
      : "";
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
): ParsedPremix[] {
  const byName = new Map<string, PremixMatch>();
  for (const m of matches) byName.set(m.name.trim().toLowerCase(), m);
  return mixes.map((mix) => {
    const m = byName.get(mix.name.trim().toLowerCase());
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

/** Convert a parsed (and grounded/matched) premix into a normalized Mix. */
export function premixToMix(parsed: ParsedPremix): Mix | null {
  const components: MixComponent[] = parsed.components.map((c) => ({
    ingredient: c.ingredient,
    perPizza: c.perPizza,
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

/**
 * Upsert imported mixes into the existing list by id (imported wins). Returns a
 * new array; existing mixes not in the import are preserved. Pure.
 */
export function mergePremixIntoMixes(
  existing: ReadonlyArray<Mix>,
  imported: ReadonlyArray<Mix>,
): Mix[] {
  const byId = new Map<string, Mix>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of imported) byId.set(m.id, m);
  return [...byId.values()];
}
