// Shipping & Palletizing Guide importer — web orchestration glue.
//
// Pipeline: read the .xlsx into a SheetGrid[] → DETERMINISTICALLY parse the
// guide's single table (one row per brand) → map each row's values onto the
// packaging fields the app already has (shipper / circles / skid stacking /
// grip sheets / pizzas per case / cases per skid; anything unmappable is
// kept as-is, never guessed) → match each row's label to a known brand
// (exact → loose → near-dup; unmatched rows are picked manually in the
// review dialog) → on confirm, merge each row's patch into EVERY profile
// under the matched brand (brand-level "" + each flavor).
//
// All pure logic lives in @workspace/shipping-import. Web-only (parity paused).

import {
  parseShippingGuide,
  buildShippingCandidates,
  type ShippingCandidate,
  type ShippingPatch,
} from "@workspace/shipping-import";
import { gridSanityIssue } from "@workspace/spec-import";
import type { FormValues } from "./types";
import { applyPackagingPatchToProfile, loadBrandFlavors, loadSpecImportKnown } from "./storage";
import { readWorkbookGrids } from "./specImport";

export type ShippingImportPrepared = {
  candidates: ShippingCandidate[];
  /** Known brands for the review dialog's manual re-match picker. */
  brands: string[];
  /** Flavors under each brand for the dialog's per-row flavor targeting. */
  flavorsByBrand: Record<string, string[]>;
};

/**
 * Read the guide workbook → parse → map → match. Throws with a plain-language
 * message when the file is unreadable or doesn't look like the guide.
 */
export async function prepareShippingImport(buffer: ArrayBuffer): Promise<ShippingImportPrepared> {
  const grids = await readWorkbookGrids(buffer);
  const sanity = gridSanityIssue(grids);
  if (sanity) throw new Error(sanity);
  const rows = parseShippingGuide(grids);
  if (rows.length === 0) {
    throw new Error(
      "This workbook doesn't look like the Shipping & Palletizing Guide — no PIZZA/BOX table was found.",
    );
  }
  const brands = loadSpecImportKnown().brands;
  return {
    candidates: buildShippingCandidates(rows, brands),
    brands,
    flavorsByBrand: loadBrandFlavors(),
  };
}

export type ShippingCommitResult = {
  /** Guide rows applied (rows the manager kept AND that had a brand). */
  rowsApplied: number;
  /** Total brand+flavor profiles the patches were merged into. */
  profilesUpdated: number;
};

/**
 * Apply the reviewed rows. Flavor targeting per row:
 * - `flavors` empty/absent → apply to the WHOLE brand (brand-level ""
 *   profile plus every flavor under it).
 * - `flavors` set → apply ONLY to those flavor profiles (the brand-level
 *   profile and other flavors are left untouched).
 * Purely local storage writes — the next sync push carries them factory-wide.
 */
export function commitShippingImport(
  rows: ReadonlyArray<{ brand: string; flavors?: readonly string[]; patch: ShippingPatch }>,
): ShippingCommitResult {
  const flavorsByBrand = loadBrandFlavors();
  let rowsApplied = 0;
  let profilesUpdated = 0;
  for (const row of rows) {
    const brand = row.brand.trim();
    if (!brand || Object.keys(row.patch).length === 0) continue;
    const picked = (row.flavors ?? []).map((f) => f.trim()).filter(Boolean);
    const targets = picked.length > 0 ? picked : ["", ...(flavorsByBrand[brand] ?? [])];
    for (const flavor of targets) {
      applyPackagingPatchToProfile(brand, flavor, row.patch as Partial<FormValues>);
      profilesUpdated++;
    }
    rowsApplied++;
  }
  return { rowsApplied, profilesUpdated };
}
