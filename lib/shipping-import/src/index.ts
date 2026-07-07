// Shipping & Palletizing Guide importer — pure logic (no DOM, no storage,
// no fetch). The guide is a single-sheet workbook: a header row
// (PIZZA / BOX / DIMENSIONS / CIRCLE / PIZZAS/CS / CASES / GRIPSHEEETS /
// PALLET TYPE / STACKING / FILM / PALLET HEIGHT) followed by one row per
// brand (blank spacer rows between).
//
// Scope: only the packaging fields the app ALREADY has are imported —
// shipper, circles, skid stacking, grip sheets, pizzas per case, cases per
// skid. Everything else in the guide (dimensions, pallet type, film, pallet
// height) is intentionally ignored. Every mapping is deterministic; a value
// that can't be mapped confidently is OMITTED from the patch so the brand's
// current setting is kept (never guessed).

import type { SheetGrid } from "@workspace/spec-import";
import { buildNearDupNameMatcher, looseNameKey } from "@workspace/name-match";

/** One parsed guide row (raw cell text, trimmed). */
export type ShippingGuideRow = {
  /** The guide's PIZZA column — the customer/brand label. */
  name: string;
  box: string;
  circle: string;
  pizzasPerCase: string;
  casesPerSkid: string;
  gripSheets: string;
  stacking: string;
};

/**
 * The packaging fields a guide row fills. Only present when the guide value
 * mapped confidently — absent keys mean "keep the brand's current setting".
 */
export type ShippingPatch = {
  shipper?: string;
  circles?: string;
  skidStacking?: string;
  gripSheets?: string;
  pizzasPerCase?: number;
  casesPerSkid?: number;
};

/** A guide row ready for review: parsed values + the brand it matched (if any). */
export type ShippingCandidate = {
  /** Stable review key (row order in the guide). */
  id: string;
  /** The guide's own label for the row. */
  guideName: string;
  /** Matched known brand, or null when the manager must pick one. */
  brand: string | null;
  patch: ShippingPatch;
  /**
   * Guide columns that were present but did NOT map to an app value (shown in
   * review as "kept as-is"), e.g. gripsheets "X" (style unknown) or
   * "4 - 3PACK" pizzas/case.
   */
  unmapped: string[];
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const lc = (s: string) => s.toLowerCase();

/** Normalize a header cell for matching: uppercase letters only. */
const headerKey = (s: string) => norm(s).toUpperCase().replace(/[^A-Z]/g, "");

/**
 * Locate the guide's header row and map the columns we care about.
 * Tolerates the sheet's own typo ("GRIPSHEEETS") and minor punctuation
 * differences by matching on letter prefixes.
 */
function findColumns(rows: string[][]): { headerIdx: number; cols: Record<keyof Omit<ShippingGuideRow, "name">, number> & { name: number } } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    const keys = row.map((c) => headerKey(c));
    const nameIdx = keys.findIndex((k) => k === "PIZZA" || k === "PRODUCT" || k === "BRAND");
    const boxIdx = keys.findIndex((k) => k === "BOX" || k === "SHIPPER");
    if (nameIdx < 0 || boxIdx < 0) continue;
    const find = (pred: (k: string) => boolean) => keys.findIndex(pred);
    return {
      headerIdx: i,
      cols: {
        name: nameIdx,
        box: boxIdx,
        circle: find((k) => k.startsWith("CIRCLE")),
        pizzasPerCase: find((k) => k.startsWith("PIZZAS")),
        casesPerSkid: find((k) => k === "CASES" || k.startsWith("CASESP")),
        gripSheets: find((k) => k.startsWith("GRIPSHE")),
        stacking: find((k) => k.startsWith("STACK")),
      },
    };
  }
  return null;
}

/**
 * Parse the Shipping & Palletizing Guide workbook into raw rows. Scans every
 * sheet and takes the first one with a recognizable header. Returns [] when
 * nothing looks like the guide.
 */
export function parseShippingGuide(grids: ReadonlyArray<SheetGrid>): ShippingGuideRow[] {
  for (const grid of grids) {
    const found = findColumns(grid.rows);
    if (!found) continue;
    const { headerIdx, cols } = found;
    const out: ShippingGuideRow[] = [];
    for (let r = headerIdx + 1; r < grid.rows.length; r++) {
      const row = grid.rows[r] ?? [];
      const cell = (idx: number) => (idx >= 0 ? norm(row[idx]) : "");
      const name = cell(cols.name);
      if (!name) continue; // spacer row
      out.push({
        name,
        box: cell(cols.box),
        circle: cell(cols.circle),
        pizzasPerCase: cell(cols.pizzasPerCase),
        casesPerSkid: cell(cols.casesPerSkid),
        gripSheets: cell(cols.gripSheets),
        stacking: cell(cols.stacking),
      });
    }
    if (out.length > 0) return out;
  }
  return [];
}

const isNA = (s: string) => {
  const t = lc(s).trim();
  if (!t) return true;
  const letters = t.replace(/[^a-z]/g, "");
  return letters === "na" || letters === "none";
};

/** BOX → the app's shipper options: costco / edwardos / 7in / 11in / 12in. */
export function mapShipper(box: string): string | undefined {
  const v = lc(box);
  if (!v.trim()) return undefined;
  if (v.includes("hsc")) return "costco";
  if (v.includes("edw")) return "edwardos";
  // Size match on the FIRST size-like number so `BC-7" shipper` and
  // `7" Microwave Shipper` land on 7in even though dimensions vary.
  const m = v.match(/\b(7|11|12)\s*(?:''|["”]|in\b|”)?/);
  if (m) {
    if (m[1] === "7") return "7in";
    if (m[1] === "11") return "11in";
    if (m[1] === "12") return "12in";
  }
  return undefined;
}

/** CIRCLE → the app's circles options: none / microwave / 7in / 11in / 12in. */
export function mapCircles(circle: string): string | undefined {
  const v = lc(circle);
  if (isNA(circle)) return "none";
  if (v.includes("suscept") || v.includes("microw")) return "microwave";
  const m = v.match(/\b(7|11|12)\b/);
  if (m) return `${m[1]}in`;
  return undefined;
}

/** STACKING → the app's skid-stacking options: lucia / hannaford / column. */
export function mapStacking(stacking: string): string | undefined {
  const v = lc(stacking);
  if (v.includes("lucia")) return "lucia";
  if (v.includes("hannaford")) return "hannaford";
  if (v.includes("column")) return "column";
  return undefined;
}

/**
 * GRIPSHEETS → the app's grip-sheet options. Only "N/A" maps (to "none");
 * an "X" means the brand USES gripsheets but the guide doesn't say which
 * layer style (every other layer vs 3rd and 5th), so we keep the current
 * setting rather than guess.
 */
export function mapGripSheets(grip: string): string | undefined {
  if (isNA(grip)) return "none";
  return undefined;
}

/** Strictly-numeric cell → positive number; anything else (e.g. "4 - 3PACK") skips. */
export function mapCount(raw: string): number | undefined {
  // Whole numbers only — a fractional pizzas-per-case or cases-per-skid is
  // never a real value here (e.g. "4 - 3PACK" multipacks are kept as-is).
  const v = raw.trim();
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** Map one guide row to a packaging patch + the list of columns kept as-is. */
export function shippingPatchFromRow(row: ShippingGuideRow): { patch: ShippingPatch; unmapped: string[] } {
  const patch: ShippingPatch = {};
  const unmapped: string[] = [];
  const take = <K extends keyof ShippingPatch>(
    key: K,
    raw: string,
    mapped: ShippingPatch[K] | undefined,
    label: string,
  ) => {
    if (mapped !== undefined) patch[key] = mapped;
    else if (raw.trim()) unmapped.push(`${label}: ${raw.trim()}`);
  };
  take("shipper", row.box, mapShipper(row.box), "Box");
  take("circles", row.circle, mapCircles(row.circle), "Circle");
  take("skidStacking", row.stacking, mapStacking(row.stacking), "Stacking");
  take("gripSheets", row.gripSheets, mapGripSheets(row.gripSheets), "Gripsheets");
  take("pizzasPerCase", row.pizzasPerCase, mapCount(row.pizzasPerCase), "Pizzas/case");
  take("casesPerSkid", row.casesPerSkid, mapCount(row.casesPerSkid), "Cases/skid");
  return { patch, unmapped };
}

/**
 * Match a guide row label against the app's known brands:
 * exact (ci) → loose key → near-duplicate (single edit / word variant).
 * Returns null when no confident match — the manager picks in the review.
 */
export function matchShippingBrand(guideName: string, brands: ReadonlyArray<string>): string | null {
  const want = lc(norm(guideName));
  if (!want) return null;
  for (const b of brands) if (lc(norm(b)) === want) return b;
  const wantKey = looseNameKey(guideName);
  if (wantKey) {
    const hits = brands.filter((b) => looseNameKey(b) === wantKey);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null; // ambiguous — let the manager pick
  }
  const matcher = buildNearDupNameMatcher(brands);
  return matcher(guideName);
}

/** Parse + map + match: the full prepared review list for the dialog. */
export function buildShippingCandidates(
  rows: ReadonlyArray<ShippingGuideRow>,
  brands: ReadonlyArray<string>,
): ShippingCandidate[] {
  return rows.map((row, i) => {
    const { patch, unmapped } = shippingPatchFromRow(row);
    return {
      id: `ship-${i}`,
      guideName: row.name,
      brand: matchShippingBrand(row.name, brands),
      patch,
      unmapped,
    };
  });
}

/** Human label for a patch value, for the review dialog's summary chips. */
export function describeShippingPatch(patch: ShippingPatch): string[] {
  const parts: string[] = [];
  if (patch.shipper !== undefined) parts.push(`Shipper: ${patch.shipper}`);
  if (patch.circles !== undefined) parts.push(`Circles: ${patch.circles}`);
  if (patch.skidStacking !== undefined) parts.push(`Stacking: ${patch.skidStacking}`);
  if (patch.gripSheets !== undefined) parts.push(`Grip sheets: ${patch.gripSheets}`);
  if (patch.pizzasPerCase !== undefined) parts.push(`Pizzas/case: ${patch.pizzasPerCase}`);
  if (patch.casesPerSkid !== undefined) parts.push(`Cases/skid: ${patch.casesPerSkid}`);
  return parts;
}
