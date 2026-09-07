// Excel spec/recipe/mix EXPORTER — web orchestration glue.
//
// Mirror image of specImport.ts / premixImport.ts: it reads the app's current
// spec profiles + recipe libraries (+ mixes) out of storage, hands them to the
// pure @workspace/spec-export builders (which lay them out so the SAME importers
// re-read them without data loss), writes .xlsx workbooks, and downloads them.
//
// Five files on purpose: Specs, Dough, Sauce, and Cheese go back through
// "Import Spec Sheet" (AI); Mixes goes back through "Import Premix Sheet"
// (deterministic). All layout logic lives in the shared lib so mobile can mirror
// this glue later (parity is PAUSED per .local/parity-pause-log.md — web-first).

import {
  buildCheeseExportGrids,
  buildDoughExportGrids,
  buildMixExportGrids,
  buildSauceExportGrids,
  buildSpecsExportGrids,
  type SheetGrid,
  type SpecExportInput,
  type ExportWorkbookKind,
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
import { downloadWorkbook } from "./specExportWorkbook";

/** Which kinds of data the user can pick to export. */
export type ExportSelection = Record<ExportWorkbookKind, boolean>;

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

export type ExportResult = {
  downloaded: Partial<Record<ExportWorkbookKind, number>>;
  failed: ExportWorkbookKind[];
};

/**
 * Export each selected category as its own dated workbook. One failed download
 * does not prevent the remaining selected workbooks from being attempted.
 */
export async function exportSpecRecipes(
  selection: ExportSelection,
  dateStr: string,
): Promise<ExportResult> {
  const downloaded: Partial<Record<ExportWorkbookKind, number>> = {};
  const failed: ExportWorkbookKind[] = [];
  const specInput =
    selection.specs || selection.dough || selection.sauce || selection.cheese
      ? gatherSpecInput()
      : null;
  const jobs: Array<{ kind: ExportWorkbookKind; filename: string; grids: () => Promise<SheetGrid[]> }> = [
    {
      kind: "specs",
      filename: `specs-${dateStr}.xlsx`,
      grids: async () => buildSpecsExportGrids(specInput!),
    },
    {
      kind: "dough",
      filename: `dough-recipes-${dateStr}.xlsx`,
      grids: async () => buildDoughExportGrids(specInput!),
    },
    {
      kind: "sauce",
      filename: `sauce-recipes-${dateStr}.xlsx`,
      grids: async () => buildSauceExportGrids(specInput!),
    },
    {
      kind: "cheese",
      filename: `cheese-recipes-${dateStr}.xlsx`,
      grids: async () => buildCheeseExportGrids(specInput!),
    },
    {
      kind: "mixes",
      filename: `mixes-${dateStr}.xlsx`,
      grids: async () => buildMixExportGrids(await fetchMixes()),
    },
  ];
  for (const job of jobs) {
    if (!selection[job.kind]) continue;
    try {
      const grids = await job.grids();
      if (!grids.length) continue;
      downloadWorkbook(grids, job.filename);
      downloaded[job.kind] = grids.length;
    } catch {
      failed.push(job.kind);
    }
  }
  return { downloaded, failed };
}
