// "Cheese Mix Recipe Specs" workbook importer — web orchestration glue.
//
// Pipeline: read the .xlsx into a SheetGrid[] → DETERMINISTICALLY parse each
// customer tab into cheese recipes (shredder setting, per-flavor assignment
// lines, per-batch component pounds) → summarize new-vs-update against the
// current server pool → on confirm, upsert the reviewed recipes by id through
// the manager-gated /api/cheese-recipes path.
//
// All pure logic lives in @workspace/cheese-import; the only writes are through
// the existing /api/cheese-recipes path. This is DETERMINISTIC — no AI, no
// learned aliases (the workbook layout is regular). Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/cheeseImport.ts (replit.md parity).

import {
  parseCheeseWorkbook,
  summarizeCheeseImport,
  buildCheeseImportCandidates,
  mergeCheeseRecipes,
  type CheeseImportSummary,
  type CheeseImportCandidate,
} from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { gridSanityIssue } from "@workspace/spec-import";
import { readWorkbookGrids } from "./specImport";
import { fetchCheeseRecipes, saveCheeseRecipes } from "./cheeseRecipes";

export type CheeseImportPrepared = {
  /** Ready-to-apply cheese recipes (deterministic ids). */
  recipes: CheeseRecipe[];
  /** Per-recipe review list (each parsed recipe + new/update status). */
  candidates: CheeseImportCandidate[];
  summary: CheeseImportSummary;
  /** Ids of recipes already saved, so the dialog can show new-vs-update. */
  existingIds: string[];
  /** Uploaded filename(s) for this import. */
  sourceNames?: string[];
  note?: string;
};

/** Hard cap on files per import so one batch can't fan out into a flood. */
export const MAX_CHEESE_IMPORT_FILES = 10;

/**
 * Read one or more "Cheese Mix Recipe Specs" workbooks → deterministic parse →
 * summarize. Throws on a hard failure (e.g. every workbook unreadable/empty).
 * Files that fail to read are skipped and surfaced as a note; it only throws if
 * NOTHING parsed.
 */
export async function prepareCheeseImport(
  buffers: ArrayBuffer[],
  onProgress?: (done: number, total: number) => void,
  names?: string[],
): Promise<CheeseImportPrepared> {
  const existing = await fetchCheeseRecipes();

  const byId = new Map<string, CheeseRecipe>();
  const errors: string[] = [];
  const failedNames: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const label = names?.[i]?.trim() || `File ${i + 1}`;
    try {
      const grids = await readWorkbookGrids(buffers[i]);
      // Cheap junk-file guard (a renamed PDF/image "reads" as one junk sheet).
      const sanity = gridSanityIssue(grids);
      if (sanity) throw new Error(sanity);
      const { recipes } = parseCheeseWorkbook(grids);
      if (recipes.length === 0) {
        failedNames.push(label);
        errors.push(`${label}: no recognizable cheese recipes.`);
      } else {
        // De-dup across files by deterministic id (last-seen wins).
        for (const r of recipes) byId.set(r.id, r);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not be read";
      failedNames.push(label);
      errors.push(`${label}: ${msg}`);
    } finally {
      onProgress?.(i + 1, buffers.length);
    }
  }

  if (byId.size === 0) {
    throw new Error(
      errors.length ? errors.join("\n") : "Nothing recognizable was found to import.",
    );
  }

  const recipes = [...byId.values()];
  const existingIds = new Set(existing.map((r) => r.id));
  const summary = summarizeCheeseImport(recipes, (id) => existingIds.has(id));
  const candidates = buildCheeseImportCandidates(recipes, (id) => existingIds.has(id));

  const noteParts: string[] = [];
  if (errors.length) {
    const list = failedNames.length ? `: ${failedNames.join(", ")}` : "";
    noteParts.push(
      `${errors.length} file${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "was" : "were"} skipped${list}.`,
    );
  }
  const note = noteParts.length ? noteParts.join("\n") : undefined;

  return {
    recipes,
    candidates,
    summary,
    existingIds: [...existingIds],
    ...(note ? { note } : {}),
  };
}

export type CheeseCommitResult = {
  /** How many recipes were saved. */
  count: number;
};

/**
 * Apply a prepared cheese import: upsert the manager-approved recipes by id
 * through the existing /api/cheese-recipes path. `recipesToApply` is the
 * reviewed selection from the dialog. Re-reads current recipes right before
 * writing so we merge onto the freshest list.
 */
export async function commitCheeseImport(
  _prepared: CheeseImportPrepared,
  recipesToApply: ReadonlyArray<CheeseRecipe>,
): Promise<CheeseCommitResult> {
  if (recipesToApply.length === 0) return { count: 0 };
  const existing = await fetchCheeseRecipes();
  const merged = mergeCheeseRecipes(existing, recipesToApply);
  await saveCheeseRecipes(merged);
  return { count: recipesToApply.length };
}
