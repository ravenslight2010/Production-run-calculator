// Excel spec/recipe/mix EXPORTER — web orchestration glue.
//
// Mirror image of specImport.ts / premixImport.ts: it reads the app's current
// spec profiles + recipe libraries (+ mixes) out of storage, hands them to the
// pure @workspace/spec-export builders (which lay them out so the SAME importers
// re-read them without data loss), writes .xlsx workbooks, and downloads them.
//
// Two files on purpose (the two importers have different formats): the
// spec/recipe workbook goes back through "Import Spec Sheet" (AI); the mixes
// workbook goes back through "Import Premix Sheet" (deterministic). All layout
// logic lives in the shared lib so mobile can mirror this glue later (parity is
// PAUSED per .local/parity-pause-log.md — web-first).

import * as XLSX from "xlsx";
import {
  buildSpecExportGrids,
  buildMixExportGrids,
  type SheetGrid,
  type SpecExportInput,
  type SpecExportSelection,
  type ExportProfile,
  type ExportRecipe,
} from "@workspace/spec-export";
import {
  loadBrandFlavors,
  loadProfile,
  loadDoughRecipePresets,
  loadFrontlineRecipePresets,
  loadCheeseRecipePresets,
} from "./storage";
import { fetchMixes } from "./mixes";
import type { FormValues, RecipeRow } from "./types";

/** Which kinds of data the user can pick to export. */
export type ExportSelection = SpecExportSelection & { mixes: boolean };

function rowsFrom(recipe: ReadonlyArray<{ ingredient: string; lbs: number }> | undefined): RecipeRow[] {
  return (recipe ?? [])
    .filter((r) => (r.ingredient ?? "").trim())
    .map((r) => ({ ingredient: r.ingredient, lbs: r.lbs }));
}

/**
 * Gather the current spec profiles + recipe libraries from storage into the
 * pure builder's input. Recipe rows come from the shared libraries; any recipe
 * referenced by a profile but missing from its library is added from the
 * profile's inline rows so nothing is dropped from the export.
 */
function gatherSpecInput(): SpecExportInput {
  const brandFlavors = loadBrandFlavors();
  const profiles: ExportProfile[] = [];

  for (const [brand, flavors] of Object.entries(brandFlavors)) {
    for (const flavor of flavors ?? []) {
      const v = loadProfile(brand, flavor);
      if (!v) continue;
      profiles.push({
        brand,
        flavor,
        dieType: v.dieType,
        sauceOzPerPizza: v.sauceOzPerPizza,
        applicators: [1, 2, 3, 4].map((s) => ({
          type: (v as Record<string, unknown>)[`app${s}Type`] as string,
          ozPerPizza: (v as Record<string, unknown>)[`app${s}OzPerPizza`] as number,
        })),
        pepperonis: [1, 2].map((s) => ({
          type: (v as Record<string, unknown>)[`pep${s}Type`] as string,
          sticks: (v as Record<string, unknown>)[`pep${s}Sticks`] as number,
          ozPerPizza: (v as Record<string, unknown>)[`pep${s}OzPerPizza`] as number,
        })),
        doughRecipeName: v.doughRecipeName,
        targetDoughballWeight: v.targetDoughballWeight,
        doughballsPerTray: v.doughballsPerTray,
        sauceRecipeName: v.frontlineRecipeName,
        cheeseRecipeNames: [
          v.app1CheeseRecipeName,
          v.app2CheeseRecipeName,
          v.app3CheeseRecipeName,
          v.app4CheeseRecipeName,
        ],
      });
    }
  }

  // Build recipe lists from the libraries, keyed case-insensitively so a
  // profile-inline recipe only fills a genuine gap (never shadows a library one).
  const doughMap = new Map<string, ExportRecipe>();
  for (const [name, preset] of Object.entries(loadDoughRecipePresets())) {
    doughMap.set(name.toLowerCase(), { name, rows: rowsFrom(preset?.rows) });
  }
  const sauceMap = new Map<string, ExportRecipe>();
  for (const [name, rows] of Object.entries(loadFrontlineRecipePresets())) {
    sauceMap.set(name.toLowerCase(), { name, rows: rowsFrom(rows) });
  }
  const cheeseMap = new Map<string, ExportRecipe>();
  for (const [name, rows] of Object.entries(loadCheeseRecipePresets())) {
    cheeseMap.set(name.toLowerCase(), { name, rows: rowsFrom(rows) });
  }

  const addInline = (map: Map<string, ExportRecipe>, name: string | undefined, rows: RecipeRow[]) => {
    const nm = (name ?? "").trim();
    if (!nm || rows.length === 0) return;
    // Fill from the profile's inline rows when the library has no entry for this
    // name OR has one with no usable rows (so an empty library entry never
    // shadows real ingredient data).
    const existing = map.get(nm.toLowerCase());
    if (!existing || existing.rows.length === 0) map.set(nm.toLowerCase(), { name: existing?.name ?? nm, rows });
  };
  for (const [brand, flavors] of Object.entries(brandFlavors)) {
    for (const flavor of flavors ?? []) {
      const v = loadProfile(brand, flavor);
      if (!v) continue;
      addInline(doughMap, v.doughRecipeName, rowsFrom(v.doughRecipe));
      addInline(sauceMap, v.frontlineRecipeName, rowsFrom(v.frontlineRecipe));
      addInline(cheeseMap, v.app1CheeseRecipeName, rowsFrom(v.app1CheeseRecipe));
      addInline(cheeseMap, v.app2CheeseRecipeName, rowsFrom(v.app2CheeseRecipe));
      addInline(cheeseMap, v.app3CheeseRecipeName, rowsFrom(v.app3CheeseRecipe));
      addInline(cheeseMap, v.app4CheeseRecipeName, rowsFrom(v.app4CheeseRecipe));
    }
  }

  return {
    profiles,
    doughRecipes: [...doughMap.values()],
    sauceRecipes: [...sauceMap.values()],
    cheeseRecipes: [...cheeseMap.values()],
  };
}

/** Turn a SheetGrid[] into a workbook and trigger a download. */
function downloadWorkbook(grids: SheetGrid[], filename: string): void {
  const wb = XLSX.utils.book_new();
  for (const g of grids) {
    const ws = XLSX.utils.aoa_to_sheet(g.rows);
    // Apply bold styling to rows that the lib flagged (header row, recipe labels).
    if (g.boldRows && g.boldRows.length > 0) {
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      for (const rowIdx of g.boldRows) {
        if (rowIdx < 0 || rowIdx > range.e.r) continue;
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
          if (!ws[addr]) continue;
          ws[addr].s = { font: { bold: true } };
        }
      }
    }
    // Sheet names are already sanitised + de-duped by the lib.
    XLSX.utils.book_append_sheet(wb, ws, g.name);
  }
  XLSX.writeFile(wb, filename);
}

export type ExportResult = { specSheets: number; mixSheets: number };

/**
 * Export the selected spec/recipe/mix data as up to two .xlsx downloads (a
 * spec/recipe workbook and a mixes workbook). Returns how many sheets each held
 * so the caller can message an empty selection. Filenames are dated with the
 * caller-supplied string.
 */
export async function exportSpecRecipes(
  selection: ExportSelection,
  dateStr: string,
): Promise<ExportResult> {
  let specSheets = 0;
  let mixSheets = 0;

  if (selection.profiles || selection.dough || selection.sauce || selection.cheese) {
    const grids = buildSpecExportGrids(gatherSpecInput(), {
      profiles: selection.profiles,
      dough: selection.dough,
      sauce: selection.sauce,
      cheese: selection.cheese,
    });
    if (grids.length) {
      downloadWorkbook(grids, `spec-recipes-${dateStr}.xlsx`);
      specSheets = grids.length;
    }
  }

  if (selection.mixes) {
    const mixes = await fetchMixes();
    const grids = buildMixExportGrids(mixes);
    if (grids.length) {
      downloadWorkbook(grids, `mixes-${dateStr}.xlsx`);
      mixSheets = grids.length;
    }
  }

  return { specSheets, mixSheets };
}
