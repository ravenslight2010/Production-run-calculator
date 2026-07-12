// "Cheese Mix Recipe Specs" workbook importer — web orchestration glue.
//
// Pipeline: read the .xlsx into a SheetGrid[] → DETERMINISTICALLY parse each
// customer tab into cheese recipes (shredder setting, per-flavor assignment
// lines, per-batch component pounds) → summarize new-vs-update against the
// current server pool → on confirm, upsert the reviewed recipes by id through
// the manager-gated /api/cheese-recipes path.
//
// All pure logic lives in @workspace/cheese-import; the only writes are through
// the existing /api/cheese-recipes path. Parsing is DETERMINISTIC (no AI); the
// only added smarts is a conservative "link to existing" pass that snaps a blend
// written in shorthand onto the canonical recipe a spec-sheet import already
// created (same brand, different name), which the manager accepts/rejects per
// recipe in the review dialog. Web-only (mobile parity paused per replit.md).

import {
  parseCheeseWorkbook,
  summarizeCheeseImport,
  buildCheeseImportCandidates,
  buildCheeseAliasLinkMap,
  withCheeseLinks,
  withCheeseSubMixes,
  detectCheeseSubMixes,
  collectCheesePrepItems,
  mergeCheeseRecipes,
  type CheeseImportSummary,
  type CheeseImportCandidate,
  type CheeseLinkTarget,
  type CheesePrepItem,
  type ParsedCheeseSheet,
} from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { gridSanityIssue, type SpecImportAlias } from "@workspace/spec-import";
import { readWorkbookGrids } from "./specImport";
import { fetchCheeseRecipes, saveCheeseRecipes } from "./cheeseRecipes";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";

export type CheeseImportPrepared = {
  /** Ready-to-apply cheese recipes (deterministic ids). */
  recipes: CheeseRecipe[];
  /** Per-recipe review list (each parsed recipe + new/update status). */
  candidates: CheeseImportCandidate[];
  summary: CheeseImportSummary;
  /** Ids of recipes already saved, so the dialog can show new-vs-update. */
  existingIds: string[];
  /**
   * Fresh / perishable prep items found inside blends (e.g. "Fresh Spinach").
   * Surfaced read-only in review so a manager can pull them early; the imported
   * cheese recipes are unchanged.
   */
  prepItems: CheesePrepItem[];
  /**
   * The CURRENT saved cheese pool (id + display name + brand), so the review
   * dialog can offer a per-recipe "Use existing recipe instead" redirect picker.
   */
  existingPool: (CheeseLinkTarget & { brand: string })[];
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
  // Learned blend-name aliases (best-effort): a "use existing recipe" pick the
  // manager made in a past review is remembered as an "appType" alias, so a
  // re-import of the same sheet pre-suggests the same link automatically.
  let aliases: SpecImportAlias[] = [];
  try {
    aliases = await fetchSpecImportAliases();
  } catch {
    aliases = [];
  }

  const byId = new Map<string, CheeseRecipe>();
  const sheets: ParsedCheeseSheet[] = [];
  const errors: string[] = [];
  const failedNames: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const label = names?.[i]?.trim() || `File ${i + 1}`;
    try {
      const grids = await readWorkbookGrids(buffers[i]);
      // Cheap junk-file guard (a renamed PDF/image "reads" as one junk sheet).
      const sanity = gridSanityIssue(grids);
      if (sanity) throw new Error(sanity);
      const { recipes, sheets: parsedSheets } = parseCheeseWorkbook(grids);
      if (recipes.length === 0) {
        failedNames.push(label);
        errors.push(`${label}: no recognizable cheese recipes.`);
      } else {
        // De-dup across files by deterministic id (last-seen wins).
        for (const r of recipes) byId.set(r.id, r);
        // Keep the per-tab parse so sub-mix / prep detection stays tab-scoped.
        sheets.push(...parsedSheets);
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
  // Attach "link to existing" suggestions so a blend written in shorthand snaps
  // onto the canonical recipe a spec-sheet import already created (same brand,
  // different name), instead of forking a duplicate. The dialog lets the manager
  // accept or reject each proposed link.
  // Flag sub-mixes (a blend that is itself an ingredient inside another blend on
  // the same tab) so review labels them instead of treating them as pizza-facing
  // blends, and collect fresh/perishable prep items to surface read-only.
  const candidates = withCheeseSubMixes(
    withCheeseLinks(
      buildCheeseImportCandidates(recipes, (id) => existingIds.has(id)),
      existing,
      buildCheeseAliasLinkMap(aliases),
    ),
    detectCheeseSubMixes(sheets),
  );
  const prepItems = collectCheesePrepItems(sheets);

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
    prepItems,
    existingPool: existing
      .map((r) => ({ id: r.id, name: r.name, brand: r.brand }))
      .sort((a, b) => a.name.localeCompare(b.name)),
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
  newAliases: ReadonlyArray<SpecImportAlias> = [],
): Promise<CheeseCommitResult> {
  if (recipesToApply.length === 0) return { count: 0 };
  const existing = await fetchCheeseRecipes();
  const merged = mergeCheeseRecipes(existing, recipesToApply);
  await saveCheeseRecipes(merged);
  // Remember the review's manual "use existing recipe" picks as blend-name
  // aliases so the next import of the same sheet pre-suggests the same links.
  // Best-effort: the recipes already saved; learning is a bonus.
  if (newAliases.length) {
    try {
      await saveSpecImportAliases([...newAliases]);
    } catch {
      // ignore — learning is non-critical
    }
  }
  return { count: recipesToApply.length };
}
