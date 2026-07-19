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
import { brandPrefixedName, buildNearDupNameMatcher } from "@workspace/name-match";

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

/** An existing pool recipe a workbook blend loosely matched (by a different name). */
export interface CheeseLinkTarget {
  id: string;
  name: string;
}

export interface CheeseImportCandidate {
  recipe: CheeseRecipe;
  status: "new" | "update";
  /**
   * Set when this workbook blend does NOT share an id with any saved recipe but
   * loosely matches an existing pool recipe of the same brand under a DIFFERENT
   * name (e.g. workbook "Whole Mozz Cheese Mix" vs saved "Whole Mozzarella
   * Cheese Mix"). The review dialog offers to link (relink id+name onto the
   * existing recipe so it updates in place) or keep it as a new recipe. Absent
   * when the blend is a clean exact-id update or a genuinely new recipe.
   */
  linkTo?: CheeseLinkTarget;
  /**
   * True when `linkTo` came from a LEARNED alias (the manager redirected or
   * merged this exact blend name before) rather than a heuristic name match.
   * The review dialog uses this to recognize the merge-re-import case — the
   * alias target's own sheet block is also present as an exact update — and
   * default the merged-away row to unchecked with a plain-language hint.
   */
  linkedByAlias?: boolean;
  /**
   * Set when this blend is a SUB-MIX: its (brand-stripped) name matches an
   * ingredient row inside another blend on the same customer tab (e.g. "Aldo's
   * Parmesan / Oregano Mix" is a block AND appears as the "Parm / Oregano Mix"
   * component inside "Aldo's Standard Cheese Mix"). It is a real recipe the
   * factory makes, but it is NOT a pizza-facing blend an applicator picks — it's
   * a component of the parent named here. Surfaced/labeled in review so it isn't
   * mistaken for a top-level blend. Absent for ordinary pizza-facing blends.
   */
  subMixOf?: string;
}

// ---------------------------------------------------------------------------
// Link-to-existing detection
// ---------------------------------------------------------------------------
//
// The cheese workbook keys each blend by a brand+name slug, so a blend written
// in shorthand ("Whole Mozz Cheese Mix") forks a DUPLICATE of the canonical
// recipe a spec-sheet import already established ("Whole Mozzarella Cheese Mix")
// instead of updating it — leaving the run applicator's pick-only cheese card
// pointing at a name that isn't the one the profile references. This pass snaps
// an imported blend onto an existing pool recipe of the SAME brand when their
// loose keys match, so the import updates the recipe the user already has.

/**
 * Generic "default version" filler words that carry no distinguishing meaning in
 * a blend name, so a name that includes or omits them still refers to the SAME
 * blend ("Aldo's Cheese Mix" == "Aldo's Standard Cheese Mix"). Deliberately tiny
 * and curated — a MEANINGFUL qualifier ("Whole Milk", "5 Cheese", "Spicy") is
 * never listed, so two genuinely different blends stay apart. Mirrors the spec
 * importer's SPEC_IMPORT_FILLER_TOKENS intent for cheese blend names.
 */
const CHEESE_LINK_FILLER_TOKENS = new Set(["standard", "regular", "pizza"]);

/**
 * Loose match key for snapping an imported blend onto an existing pool recipe:
 * the abbreviation-expanded matchKey (so "Whole Mozz" == "Whole Mozzarella")
 * with generic filler tokens dropped (so "Aldo's Cheese Mix" == "Aldo's Standard
 * Cheese Mix"). Deliberately conservative — no edit-distance fuzz — so genuinely
 * different blends never collide.
 */
export function cheeseLinkKey(name: string): string {
  const tokens = matchKey(name).split(" ").filter(Boolean);
  const kept = tokens.filter((t) => !CHEESE_LINK_FILLER_TOKENS.has(t));
  return (kept.length ? kept : tokens).join(" ");
}

/** Brand-scoped loose-key for the link map. */
function cheeseLinkMapKey(brand: string, name: string): string {
  return `${nameKey(brand)}\u0000${cheeseLinkKey(name)}`;
}

/**
 * Build a brand-scoped loose-key → existing recipe map, with an AMBIGUITY GUARD:
 * if two genuinely DIFFERENT saved recipes of the same brand collapse to the same
 * loose key, that key is dropped so an import is never silently relabeled to an
 * arbitrary one of them. Duplicate ids / same-name entries are not a conflict.
 */
export function buildCheeseLinkMap(
  existing: ReadonlyArray<CheeseRecipe>,
): Map<string, CheeseLinkTarget> {
  const byKey = new Map<string, CheeseLinkTarget>();
  const ambiguous = new Set<string>();
  for (const r of existing) {
    const lk = cheeseLinkKey(r.name);
    if (!lk) continue;
    const key = cheeseLinkMapKey(r.brand, r.name);
    const prior = byKey.get(key);
    if (prior === undefined) byKey.set(key, { id: r.id, name: r.name });
    else if (prior.id !== r.id && nameKey(prior.name) !== nameKey(r.name)) {
      ambiguous.add(key);
    }
  }
  for (const k of ambiguous) byKey.delete(k);
  return byKey;
}

/**
 * Find the existing pool recipe a workbook blend should link to, or undefined.
 * Returns nothing when the blend already shares an id with a saved recipe (a
 * clean exact-id update) or when no unambiguous loose match exists. Matching is
 * same-brand FIRST, then UNBRANDED pool rows (shared master data a branded
 * import may legitimately reuse) — never another brand's row.
 */
export function findCheeseLink(
  recipe: CheeseRecipe,
  linkMap: ReadonlyMap<string, CheeseLinkTarget>,
  existingIds: ReadonlySet<string>,
): CheeseLinkTarget | undefined {
  if (existingIds.has(recipe.id)) return undefined;
  const target =
    linkMap.get(cheeseLinkMapKey(recipe.brand, recipe.name)) ??
    (nameKey(recipe.brand) ? linkMap.get(cheeseLinkMapKey("", recipe.name)) : undefined);
  if (target && target.id !== recipe.id) return target;
  return undefined;
}

/**
 * Near-duplicate fallback for the link pass: when the exact loose-key map finds
 * nothing, try the shared layered near-dup matcher (word order / one extra
 * non-digit word / single typo — each with ambiguity + digit guards) over the
 * SAME brand's saved recipe names, using the abbreviation-expanded cheese link
 * key. This catches workbook label drift ("Pepperoni Craft Blend" vs "Craft
 * Pepperoni Blend", "Peperoni" vs "Pepperoni") that used to fork a parallel
 * recipe. Still only a PROPOSED link — the manager reviews and can keep the
 * blend as a new recipe, and withCheeseLinks' one-to-one guard still applies.
 */
function buildCheeseNearDupResolver(
  existing: ReadonlyArray<CheeseRecipe>,
): (recipe: CheeseRecipe, existingIds: ReadonlySet<string>) => CheeseLinkTarget | undefined {
  const byBrand = new Map<
    string,
    {
      matcher: (name: string) => string | null;
      names: string[];
      targets: Map<string, CheeseLinkTarget>;
    }
  >();
  for (const r of existing) {
    const bk = nameKey(r.brand);
    let entry = byBrand.get(bk);
    if (!entry) {
      entry = { matcher: () => null, names: [], targets: new Map() };
      byBrand.set(bk, entry);
    }
    entry.names.push(r.name);
    const nk = nameKey(r.name);
    if (!entry.targets.has(nk)) entry.targets.set(nk, { id: r.id, name: r.name });
  }
  for (const entry of byBrand.values()) {
    entry.matcher = buildNearDupNameMatcher(entry.names, {
      // Extra-word layer is safe HERE (and only here) because a cheese link is
      // a reviewable proposal the manager can decline, never a silent rename.
      keyOf: cheeseLinkKey,
      allowExtraToken: true,
    });
  }
  const resolveIn = (
    entry: { matcher: (name: string) => string | null; targets: Map<string, CheeseLinkTarget> } | undefined,
    recipe: CheeseRecipe,
  ): CheeseLinkTarget | undefined => {
    if (!entry) return undefined;
    const matched = entry.matcher(recipe.name);
    if (!matched) return undefined;
    const target = entry.targets.get(nameKey(matched));
    if (!target || target.id === recipe.id) return undefined;
    return target;
  };
  return (recipe, existingIds) => {
    if (existingIds.has(recipe.id)) return undefined;
    // Same-brand first, then UNBRANDED shared rows (never another brand's).
    const bk = nameKey(recipe.brand);
    return (
      resolveIn(byBrand.get(bk), recipe) ??
      (bk ? resolveIn(byBrand.get(""), recipe) : undefined)
    );
  };
}

/**
 * Resolve a reviewed candidate to the recipe to actually apply. When the manager
 * keeps a proposed link, the recipe's id + name are swapped onto the existing
 * pool recipe so mergeCheeseRecipes UPDATES it in place; otherwise the workbook's
 * own id + name are kept (a new recipe).
 */
export function resolveCheeseCandidate(
  candidate: CheeseImportCandidate,
  linkEnabled: boolean,
): CheeseRecipe {
  if (linkEnabled && candidate.linkTo) {
    return { ...candidate.recipe, id: candidate.linkTo.id, name: candidate.linkTo.name };
  }
  return candidate.recipe;
}

/**
 * A learned blend-name mapping relevant to the cheese "link to existing" pass —
 * the structural shape of a spec-import alias (kind "appType" is the shared
 * blend-name namespace the spec importer's review picks write into). Kept
 * structural so this package stays dependency-free of @workspace/spec-import.
 */
export type CheeseNameAlias = {
  kind: string;
  externalName: string;
  canonicalName: string;
  context?: string | null;
};

/**
 * Generic slot-card type names ("Mix"/"cheese") must never participate in a
 * blend-name alias link: an alias FROM one would redirect every plain slot to
 * a single blend, and an alias TO one links every blend onto a garbage pool
 * record. Mirrors spec-import's isGenericSlotTypeName (kept local so this
 * package stays dependency-free). Pure.
 */
function isGenericBlendName(name: string): boolean {
  const key = nameKey(name);
  return key === "mix" || key === "cheese" || key === "mix cheese" || key === "cheese mix";
}

/**
 * Build the alias link map `withCheeseLinks` consults: lowercased raw workbook
 * blend name → learned canonical name. Only context-free "appType" aliases (the
 * blend-name namespace shared with the spec importer's "Use existing recipe"
 * picks) participate; generic slot-type names are rejected on either side, and
 * conflicting aliases (same external name, different canonical names, ci) are
 * dropped entirely rather than guessing. Pure.
 */
export function buildCheeseAliasLinkMap(
  aliases: ReadonlyArray<CheeseNameAlias>,
): Map<string, string> {
  return buildAliasMapFrom(
    aliases.filter((a) => a.kind === "appType" && (a.context ?? null) === null),
  );
}

/** Shared alias-map builder (lowercased external → canonical, conflicts dropped). */
function buildAliasMapFrom(aliases: ReadonlyArray<CheeseNameAlias>): Map<string, string> {
  const map = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const a of aliases) {
    const ext = (a.externalName ?? "").trim().toLowerCase();
    const canon = (a.canonicalName ?? "").trim();
    if (!ext || !canon) continue;
    if (isGenericBlendName(ext) || isGenericBlendName(canon)) continue;
    const prior = map.get(ext);
    if (prior === undefined) map.set(ext, canon);
    else if (prior.toLowerCase() !== canon.toLowerCase()) conflicted.add(ext);
  }
  for (const k of conflicted) map.delete(k);
  return map;
}

/**
 * Brand-aware alias link maps: the shared context-free map plus per-brand maps
 * built from aliases whose `context` names a customer (the review dialogs write
 * a brand-scoped row alongside the shared one). A brand-scoped alias only ever
 * fires for that customer's imports, so a redirect learned while importing one
 * brand's sheet can never drag another brand's same-named blend onto it.
 */
export interface CheeseAliasLinkMaps {
  global: ReadonlyMap<string, string>;
  /** Keyed by nameKey(brand/context). */
  byBrand: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export function buildCheeseAliasLinkMaps(
  aliases: ReadonlyArray<CheeseNameAlias>,
): CheeseAliasLinkMaps {
  const byBrandRows = new Map<string, CheeseNameAlias[]>();
  for (const a of aliases) {
    if (a.kind !== "appType") continue;
    const ctx = nameKey(a.context ?? "");
    if (!ctx) continue;
    let list = byBrandRows.get(ctx);
    if (!list) byBrandRows.set(ctx, (list = []));
    list.push(a);
  }
  const byBrand = new Map<string, ReadonlyMap<string, string>>();
  for (const [ctx, rows] of byBrandRows) byBrand.set(ctx, buildAliasMapFrom(rows));
  return { global: buildCheeseAliasLinkMap(aliases), byBrand };
}

/**
 * Resolve a candidate's learned-alias link: the manager previously redirected
 * this exact workbook blend name onto an existing pool recipe, so propose that
 * same link again (highest precedence — an explicit past decision beats the
 * loose-key and near-dup heuristics). The target is found by (ci) name in the
 * pool, preferring a same-brand recipe when several brands share the name;
 * a cross-brand ambiguity yields nothing rather than guessing.
 */
function findCheeseAliasLink(
  recipe: CheeseRecipe,
  aliasLinks: CheeseAliasLinkMaps,
  existing: ReadonlyArray<CheeseRecipe>,
  existingIds: ReadonlySet<string>,
): CheeseLinkTarget | undefined {
  if (existingIds.has(recipe.id)) return undefined;
  // A redirect the manager confirmed for THIS customer wins; the shared
  // context-free alias is only consulted when no brand-scoped one exists.
  const brandMap = aliasLinks.byBrand.get(nameKey(recipe.brand));
  const extKey = recipe.name.trim().toLowerCase();
  const canon = brandMap?.get(extKey) ?? aliasLinks.global.get(extKey);
  if (!canon) return undefined;
  const canonLower = canon.toLowerCase();
  const allMatches = existing.filter((r) => r.name.trim().toLowerCase() === canonLower);
  // HARD BRAND WALL: a branded candidate may resolve only to same-brand or
  // UNBRANDED shared rows — never another customer's recipe, even when that
  // other recipe is the sole name match (a context-free alias learned from one
  // customer must not redirect a different customer's blend).
  const brandKey = nameKey(recipe.brand);
  const matches = brandKey
    ? allMatches.filter((r) => {
        const bk = nameKey(r.brand);
        return bk === brandKey || !bk;
      })
    : allMatches;
  if (matches.length === 0) return undefined;
  let pick = matches[0];
  if (matches.length > 1) {
    // Same-brand first, then a single UNBRANDED shared row; a remaining
    // ambiguity yields nothing rather than guessing.
    const sameBrand = matches.filter((r) => nameKey(r.brand) === brandKey);
    if (sameBrand.length === 1) {
      pick = sameBrand[0];
    } else if (sameBrand.length === 0 && brandKey) {
      const unbranded = matches.filter((r) => !nameKey(r.brand));
      if (unbranded.length !== 1) return undefined;
      pick = unbranded[0];
    } else {
      return undefined;
    }
  }
  if (pick.id === recipe.id) return undefined;
  return { id: pick.id, name: pick.name };
}

/**
 * Attach link-to-existing suggestions to a candidate list built from the raw
 * new/update status. Pure; returns a new list, leaving clean exact-id updates and
 * genuinely new recipes untouched.
 *
 * Precedence per candidate: a LEARNED alias link (the manager redirected this
 * exact blend name before — see `buildCheeseAliasLinkMap`) → the loose-key map →
 * the near-dup matcher.
 *
 * ONE-TO-ONE GUARD: a proposed link is dropped when its target existing recipe
 * would be claimed by more than one candidate. Without this guard two accepted
 * links resolving to the same id would collide in mergeCheeseRecipes'
 * last-write-wins merge and silently drop one recipe's data. When in doubt the
 * blend stays a NEW recipe. Exception: a LEARNED-ALIAS link is NOT vetoed by
 * the target's OWN exact-id update — after a Manage Lists merge of two blends
 * from the same workbook, a re-import carries both the survivor's block (exact
 * update) and the merged-away block (alias → survivor); the review shows the
 * link so the manager can uncheck either, instead of silently resurrecting the
 * merged-away blend as "new". Heuristic (loose-key / near-dup) links keep the
 * strict guard — they are guesses, not past decisions.
 */
export function withCheeseLinks(
  candidates: ReadonlyArray<CheeseImportCandidate>,
  existing: ReadonlyArray<CheeseRecipe>,
  aliasLinks?: ReadonlyMap<string, string> | CheeseAliasLinkMaps,
): CheeseImportCandidate[] {
  // Back-compat: a bare context-free map is treated as { global } with no
  // brand-scoped rows.
  const aliasMaps: CheeseAliasLinkMaps | undefined =
    aliasLinks === undefined
      ? undefined
      : aliasLinks instanceof Map
        ? { global: aliasLinks, byBrand: new Map() }
        : (aliasLinks as CheeseAliasLinkMaps);
  const linkMap = buildCheeseLinkMap(existing);
  const existingIds = new Set(existing.map((r) => r.id));
  const nearDup = buildCheeseNearDupResolver(existing);
  const proposed = candidates.map((c): { link: CheeseLinkTarget; fromAlias: boolean } | undefined => {
    const aliasLink = aliasMaps
      ? findCheeseAliasLink(c.recipe, aliasMaps, existing, existingIds)
      : undefined;
    if (aliasLink) return { link: aliasLink, fromAlias: true };
    const heuristic =
      findCheeseLink(c.recipe, linkMap, existingIds) ?? nearDup(c.recipe, existingIds);
    return heuristic ? { link: heuristic, fromAlias: false } : undefined;
  });

  // Tally claims on each existing id, split by source: exact-id updates and
  // proposed links. Links to one target always conflict with EACH OTHER; an
  // exact-id update additionally vetoes heuristic links but not alias links
  // (an alias is an explicit past decision the review surfaces for approval).
  const exactClaims = new Map<string, number>();
  const linkClaims = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  candidates.forEach((c, i) => {
    if (existingIds.has(c.recipe.id)) bump(exactClaims, c.recipe.id);
    const p = proposed[i];
    if (p) bump(linkClaims, p.link.id);
  });

  return candidates.map((c, i) => {
    const p = proposed[i];
    if (!p) return c;
    if ((linkClaims.get(p.link.id) ?? 0) !== 1) return c;
    if (!p.fromAlias && (exactClaims.get(p.link.id) ?? 0) > 0) return c;
    return { ...c, linkTo: p.link, ...(p.fromAlias ? { linkedByAlias: true } : {}) };
  });
}

/**
 * Cross-brand collision auto-prefix: rename an imported blend to its
 * brand-prefixed name ("Lucia's Taco Mix") when its name (ci) collides with a
 * DIFFERENT brand's saved recipe or with a different brand's blend in the same
 * batch. Same-brand and unbranded collisions are untouched (those are handled
 * by the id/link passes), candidates with a proposed link keep the link
 * target's name anyway, and the workbook id is KEPT — cheeseImportId is already
 * brand-scoped, so a re-import updates the same row in place and this pass
 * re-applies the same prefixed name deterministically (brandPrefixedName is
 * idempotent). Apply AFTER withCheeseLinks. Pure.
 */
export function withCheeseBrandPrefixes(
  candidates: ReadonlyArray<CheeseImportCandidate>,
  existing: ReadonlyArray<CheeseRecipe>,
): CheeseImportCandidate[] {
  // name (ci) → set of brand keys holding it, from the pool (by id, so a
  // candidate updating its own row doesn't collide with itself) and the batch.
  const brandsByName = new Map<string, Map<string, Set<string>>>(); // nameKey → brandKey → ids/marks
  const note = (name: string, brand: string, id: string) => {
    const nk = nameKey(name);
    if (!nk) return;
    let brands = brandsByName.get(nk);
    if (!brands) brandsByName.set(nk, (brands = new Map()));
    const bk = nameKey(brand);
    let ids = brands.get(bk);
    if (!ids) brands.set(bk, (ids = new Set()));
    ids.add(id);
  };
  for (const r of existing) note(r.name, r.brand, r.id);
  for (const c of candidates) note(c.recipe.name, c.recipe.brand, c.recipe.id);
  return candidates.map((c) => {
    if (c.linkTo) return c; // link keeps the target's name
    const brand = c.recipe.brand.trim();
    if (!brand) return c;
    const nk = nameKey(c.recipe.name);
    const brands = brandsByName.get(nk);
    if (!brands) return c;
    const bk = nameKey(brand);
    const collides = [...brands.entries()].some(
      ([otherBrand, ids]) =>
        otherBrand !== "" &&
        otherBrand !== bk &&
        // ignore "collisions" that are only this candidate's own id
        (ids.size > 1 || !ids.has(c.recipe.id)),
    );
    if (!collides) return c;
    const prefixed = brandPrefixedName(brand, c.recipe.name.trim());
    if (nameKey(prefixed) === nk) return c; // already brand-prefixed
    return { ...c, recipe: { ...c.recipe, name: prefixed } };
  });
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

// ---------------------------------------------------------------------------
// Sub-mix + prep-item detection (workbook "depth")
// ---------------------------------------------------------------------------

/**
 * Strip a leading brand / customer prefix (possessive-aware) from a blend name
 * so a sub-mix block title ("Aldo's Parmesan / Oregano Mix") lines up with the
 * un-prefixed component reference inside its parent ("Parm / Oregano Mix").
 */
function stripBrandPrefix(name: string, brand: string): string {
  const b = collapseWs(brand).toLowerCase();
  if (!b) return collapseWs(name);
  const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return collapseWs(name).replace(new RegExp(`^${esc}(?:'s|s)?\\s+`, "i"), "");
}

/**
 * Normalized key for matching a sub-mix block name against a parent's component
 * row: abbreviation-expanded matchKey, brand prefix removed, punctuation-only
 * tokens dropped. "Aldo's Parmesan / Oregano Mix" and "Parm / Oregano Mix" both
 * collapse to "parmesan oregano mix".
 */
function subMixKey(name: string, brand: string): string {
  return matchKey(stripBrandPrefix(name, brand))
    .split(" ")
    .filter((t) => t && t !== "/" && t !== "&")
    .join(" ");
}

/**
 * Detect SUB-MIXES within each customer tab: a blend block whose name matches an
 * ingredient row inside ANOTHER block on the same tab. Returns a map of
 * recipe id → parent blend name. Detection is per-sheet (a sub-mix relationship
 * only holds within one customer tab) and deliberately exact-on-normalized-key
 * (no fuzz) so an ordinary raw-cheese component like "Whole Mozzarella" never
 * gets mistaken for the standalone "Whole Mozzarella Cheese Mix" block.
 */
export function detectCheeseSubMixes(
  sheets: ReadonlyArray<ParsedCheeseSheet>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const sheet of sheets) {
    // Map every component reference on this tab → the blend that contains it.
    const componentParent = new Map<string, string>();
    for (const parent of sheet.recipes) {
      for (const c of parent.components) {
        const ck = subMixKey(c.ingredient, sheet.brand);
        if (ck) componentParent.set(ck, parent.name);
      }
    }
    for (const r of sheet.recipes) {
      const parent = componentParent.get(subMixKey(r.name, sheet.brand));
      if (parent && nameKey(parent) !== nameKey(r.name)) {
        result.set(r.id, parent);
      }
    }
  }
  return result;
}

/** A fresh / perishable prep ingredient found inside a cheese blend. */
export interface CheesePrepItem {
  /** The blend this prep ingredient appears in. */
  blend: string;
  /** The prep ingredient name, verbatim from the sheet. */
  ingredient: string;
  /** Pounds per batch, as parsed. */
  lbs: number;
}

/**
 * Component names that denote a fresh / perishable PREP ingredient (not a shelf-
 * stable cheese) — these need to be pulled/prepped ahead, parallel to the premix
 * importer's prep split. Deliberately conservative; extend as real sheets show
 * more. Matched as whole words, case-insensitive.
 */
const CHEESE_PREP_RE = /\b(fresh|spinach|mushroom)\b/i;

/**
 * Collect fresh / perishable PREP items that appear as ingredient rows inside
 * cheese blends (e.g. Corner Booth's "Fresh Spinach"). Surfaced read-only in
 * review so a manager can tag them for early pull; the cheese recipes themselves
 * are unchanged. Deduped by blend + ingredient across the whole workbook.
 */
export function collectCheesePrepItems(
  sheets: ReadonlyArray<ParsedCheeseSheet>,
): CheesePrepItem[] {
  const out: CheesePrepItem[] = [];
  const seen = new Set<string>();
  for (const sheet of sheets) {
    for (const r of sheet.recipes) {
      for (const c of r.components) {
        if (!CHEESE_PREP_RE.test(c.ingredient)) continue;
        const key = `${nameKey(r.name)}\u0000${nameKey(c.ingredient)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ blend: r.name, ingredient: c.ingredient, lbs: c.lbs });
      }
    }
  }
  return out;
}

/**
 * Attach `subMixOf` to candidates from a recipe-id → parent-name map (from
 * {@link detectCheeseSubMixes}). Pure; returns a new list, leaving non-sub-mix
 * candidates untouched.
 */
export function withCheeseSubMixes(
  candidates: ReadonlyArray<CheeseImportCandidate>,
  subMixOfById: ReadonlyMap<string, string>,
): CheeseImportCandidate[] {
  return candidates.map((c) => {
    const parent = subMixOfById.get(c.recipe.id);
    return parent ? { ...c, subMixOf: parent } : c;
  });
}

export { mergeCheeseRecipes };
