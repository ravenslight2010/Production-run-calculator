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
import { DEFAULT_VALUES, type FormValues, type RecipeRow } from "./types";
import type { Mix } from "@workspace/mixes";
import {
  fetchBrandProfilesSnapshot,
  type ServerBrandProfileSnapshot,
} from "./profileServerSync";
import { fetchNamedRecipes } from "./namedRecipes";
import { fetchCheeseRecipes } from "./cheeseRecipes";
import { fetchMixes } from "./mixes";
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
function profileToExport(profile: ServerBrandProfileSnapshot): ExportProfile | null {
  const brand = profile.brand.trim();
  const flavor = profile.flavor.trim();
  if (!brand || !flavor) return null;
  const v = {
    ...DEFAULT_VALUES,
    ...profile.values,
    ...profile.crustValues,
  } as FormValues;
  return {
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
  };
}

function recipeRowsSignature(rows: ReadonlyArray<RecipeRow>): string {
  return JSON.stringify(
    rows.map((row) => [row.ingredient.trim().toLowerCase(), row.lbs]),
  );
}

function addInline(recipes: ExportRecipe[], name: string | undefined, rows: RecipeRow[]): void {
  const nm = (name ?? "").trim();
  if (!nm || rows.length === 0) return;
  const matching = recipes.filter((recipe) => recipe.name.trim().toLowerCase() === nm.toLowerCase());
  const populated = matching.filter((recipe) => recipe.rows.length > 0);
  const signature = recipeRowsSignature(rows);
  if (populated.some((recipe) => recipeRowsSignature(recipe.rows) === signature)) return;
  if (populated.length === 0 && matching.length > 0) {
    const index = recipes.indexOf(matching[0]!);
    recipes[index] = { name: matching[0]!.name, rows };
    return;
  }
  // A conflicting inline formula is not a tie-breaker. Retain it as a second
  // same-name recipe so the workbook exposes the conflict for review.
  recipes.push({ name: populated[0]?.name ?? nm, rows });
}

function addCheeseInlineUnlessMix(
  recipes: ExportRecipe[],
  appType: string | undefined,
  name: string | undefined,
  rows: RecipeRow[],
  mixOnlyNameKeys: ReadonlySet<string>,
): void {
  const nameKey = (name ?? "").trim().toLowerCase();
  if (
    appType?.trim().toLowerCase() === "mix" ||
    (nameKey && mixOnlyNameKeys.has(nameKey))
  ) return;
  addInline(recipes, name, rows);
}

async function gatherSpecInput(mixPoolPromise: Promise<Mix[]>): Promise<SpecExportInput> {
  const [serverProfiles, doughPool, saucePool, cheesePool, mixPool] = await Promise.all([
    fetchBrandProfilesSnapshot(),
    fetchNamedRecipes("dough", { cache: "no-store" }),
    fetchNamedRecipes("sauce", { cache: "no-store" }),
    fetchCheeseRecipes({ cache: "no-store" }),
    mixPoolPromise,
  ]);
  const profiles: ExportProfile[] = [];
  const doughRecipes: ExportRecipe[] = doughPool.map((recipe) => ({
    name: recipe.name,
    rows: rowsFrom(recipe.components),
  }));
  const sauceRecipes: ExportRecipe[] = saucePool.map((recipe) => ({
    name: recipe.name,
    rows: rowsFrom(recipe.components),
  }));
  const cheeseRecipes: ExportRecipe[] = cheesePool.map((recipe) => ({
    name: recipe.name,
    rows: rowsFrom(recipe.components),
  }));
  const cheeseNameKeys = new Set(
    cheesePool.map((recipe) => recipe.name.trim().toLowerCase()).filter(Boolean),
  );
  const mixOnlyNameKeys = new Set(
    mixPool
      .map((mix) => mix.name.trim())
      .filter((name) => name && !cheeseNameKeys.has(name.toLowerCase()))
      .map((name) => name.toLowerCase()),
  );

  // Profile-inline rows fill a genuinely missing or empty server library entry.
  // If they disagree with a populated entry, both versions remain visible.
  // Process each source row directly so same-key conflicts are not replaced by
  // whichever row happened to be returned first from the profile endpoint.
  const sortedServerProfiles = [...serverProfiles].sort((a, b) =>
    a.brand.trim().toLowerCase().localeCompare(b.brand.trim().toLowerCase())
    || a.flavor.trim().toLowerCase().localeCompare(b.flavor.trim().toLowerCase())
    || JSON.stringify(a.values).localeCompare(JSON.stringify(b.values)),
  );
  for (const serverProfile of sortedServerProfiles) {
    const profile = profileToExport(serverProfile);
    if (!profile) continue;
    profiles.push(profile);
    const v = {
      ...DEFAULT_VALUES,
      ...serverProfile.values,
      ...serverProfile.crustValues,
    } as FormValues;
    addInline(doughRecipes, v.doughRecipeName, rowsFrom(v.doughRecipe));
    addInline(sauceRecipes, v.frontlineRecipeName, rowsFrom(v.frontlineRecipe));
    // Mixes share the profile's applicator-recipe fields, but their canonical
    // rows come from the Mix library (and use a different unit basis). Do not
    // leak those inline values into the Cheese recipe workbook.
    addCheeseInlineUnlessMix(
      cheeseRecipes, v.app1Type, v.app1CheeseRecipeName, rowsFrom(v.app1CheeseRecipe), mixOnlyNameKeys,
    );
    addCheeseInlineUnlessMix(
      cheeseRecipes, v.app2Type, v.app2CheeseRecipeName, rowsFrom(v.app2CheeseRecipe), mixOnlyNameKeys,
    );
    addCheeseInlineUnlessMix(
      cheeseRecipes, v.app3Type, v.app3CheeseRecipeName, rowsFrom(v.app3CheeseRecipe), mixOnlyNameKeys,
    );
    addCheeseInlineUnlessMix(
      cheeseRecipes, v.app4Type, v.app4CheeseRecipeName, rowsFrom(v.app4CheeseRecipe), mixOnlyNameKeys,
    );
  }
  return {
    profiles,
    doughRecipes,
    sauceRecipes,
    cheeseRecipes,
    mixOnlyRecipeNames: [...mixOnlyNameKeys],
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
  const needsSpecInput = selection.specs || selection.dough || selection.sauce || selection.cheese;
  const mixPoolPromise =
    needsSpecInput || selection.mixes
      ? fetchMixes({ cache: "no-store" })
      : null;
  const specInputPromise =
    needsSpecInput
      ? gatherSpecInput(mixPoolPromise!)
      : null;
  const jobs: Array<{ kind: ExportWorkbookKind; filename: string; grids: () => Promise<SheetGrid[]> }> = [
    {
      kind: "specs",
      filename: `specs-${dateStr}.xlsx`,
      grids: async () => buildSpecsExportGrids(await specInputPromise!),
    },
    {
      kind: "dough",
      filename: `dough-recipes-${dateStr}.xlsx`,
      grids: async () => buildDoughExportGrids(await specInputPromise!),
    },
    {
      kind: "sauce",
      filename: `sauce-recipes-${dateStr}.xlsx`,
      grids: async () => buildSauceExportGrids(await specInputPromise!),
    },
    {
      kind: "cheese",
      filename: `cheese-recipes-${dateStr}.xlsx`,
      grids: async () => buildCheeseExportGrids(await specInputPromise!),
    },
    {
      kind: "mixes",
      filename: `mixes-${dateStr}.xlsx`,
      grids: async () => buildMixExportGrids(await mixPoolPromise!),
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
