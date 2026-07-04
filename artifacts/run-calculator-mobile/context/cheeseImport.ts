// "Cheese Mix Recipe Specs" workbook importer — mobile orchestration glue.
//
// Pipeline: read the .xlsx into grids (in the UI, via
// readWorkbookGridsFromArrayBuffer / readWorkbookGridsFromBase64) →
// DETERMINISTICALLY parse each customer tab into cheese recipes (shredder
// setting, per-flavor assignment lines, per-batch component pounds) → summarize
// new-vs-update against the current server pool → on confirm, upsert the
// reviewed recipes by id through the manager-gated /api/cheese-recipes path.
//
// All pure logic lives in @workspace/cheese-import; the only writes are through
// the existing /api/cheese-recipes path. This is DETERMINISTIC — no AI, no
// learned aliases (the workbook layout is regular). Mirrors the web glue in
// artifacts/run-calculator/src/cheeseImport.ts (replit.md parity). The platform
// difference is plumbing: web reads the workbook from an ArrayBuffer itself,
// mobile takes already-parsed grids (base64 native / ArrayBuffer web).

import {
  parseCheeseWorkbook,
  summarizeCheeseImport,
  buildCheeseImportCandidates,
  mergeCheeseRecipes,
  type CheeseSheetGrid,
  type CheeseImportSummary,
  type CheeseImportCandidate,
} from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { gridSanityIssue } from "@workspace/spec-import";
import { fetchCheeseRecipes, saveCheeseRecipes } from "./cheeseRecipes";

export type CheeseImportPrepared = {
  /** Ready-to-apply cheese recipes (deterministic ids). */
  recipes: CheeseRecipe[];
  /** Per-recipe review list (each parsed recipe + new/update status). */
  candidates: CheeseImportCandidate[];
  summary: CheeseImportSummary;
  /** Ids of recipes already saved, so the modal can show new-vs-update. */
  existingIds: string[];
  note?: string;
};

/** Hard cap on files per import so one batch can't fan out into a flood. */
export const MAX_CHEESE_IMPORT_FILES = 10;

/**
 * Read one or more "Cheese Mix Recipe Specs" workbooks (as already-parsed grids)
 * → deterministic parse → summarize. Throws on a hard failure (every workbook
 * unreadable/empty). Files that fail to read are skipped and surfaced as a note;
 * only throws if NOTHING parsed.
 */
export async function prepareCheeseImport(
  gridsList: CheeseSheetGrid[][],
  onProgress?: (done: number, total: number) => void,
  names?: string[],
): Promise<CheeseImportPrepared> {
  const existing = await fetchCheeseRecipes();

  const byId = new Map<string, CheeseRecipe>();
  const errors: string[] = [];
  const failedNames: string[] = [];
  let done = 0;
  for (let i = 0; i < gridsList.length; i++) {
    const grids = gridsList[i];
    // Name each file so a failure can say WHICH file was skipped (fall back to a
    // positional label when the caller didn't pass filenames). Mirrors web.
    const label = names?.[i]?.trim() || `File ${i + 1}`;
    try {
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
      done += 1;
      onProgress?.(done, gridsList.length);
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
 * reviewed selection from the modal. Re-reads current recipes right before
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
