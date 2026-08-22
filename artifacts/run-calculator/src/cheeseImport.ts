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
  cheeseImportId,
  summarizeCheeseImport,
  buildCheeseImportCandidates,
  buildCheeseAliasLinkMaps,
  withCheeseBrandPrefixes,
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
import {
  gridSanityIssue,
  pickAlias,
  sanitizeSpecAliases,
  type SpecImportAlias,
} from "@workspace/spec-import";
import { readWorkbookGrids } from "./specImport";
import { fetchCheeseRecipes, saveCheeseRecipes } from "./cheeseRecipes";
import { fetchMixes } from "./mixes";
import {
  deleteSpecImportAliases,
  fetchSpecImportAliases,
  saveSpecImportAliases,
} from "./specImportAliases";
import { saveAiCorrections } from "./aiCorrections";

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
  /**
   * Existing cheese recipes whose brand appears in the imported set but whose
   * id is NOT in the import — they were likely removed from the workbook. Shown
   * in the review dialog so the manager can choose to remove them. A recipe
   * whose brand does NOT appear in the import is not listed (we can't infer the
   * file's scope for that brand).
   */
  absentRecipes: (CheeseLinkTarget & { brand: string })[];
  /** Uploaded filename(s) for this import. */
  sourceNames?: string[];
  note?: string;
};

/** Hard cap on files per import so one batch can't fan out into a flood. */
export const MAX_CHEESE_IMPORT_FILES = 10;

/**
 * Resolve a parsed cheese recipe's brand through the learned brand aliases
 * (recorded on brand merges/renames), so re-importing a workbook whose tab
 * still carries the OLD customer name updates the renamed pool instead of
 * resurrecting the old brand. The recipe id is brand-derived, so it is
 * recomputed too — that is what makes the existing-id "update" match work.
 * Sheet-level brand text is deliberately NOT remapped by callers: sub-mix
 * detection strips the brand prefix as WRITTEN on the sheet.
 */
export function remapCheeseRecipeBrands(
  recipes: ReadonlyArray<CheeseRecipe>,
  aliases: ReadonlyArray<SpecImportAlias>,
): CheeseRecipe[] {
  const usable = sanitizeSpecAliases(aliases);
  return recipes.map((r) => {
    const canon = pickAlias(usable, "brand", r.brand);
    if (!canon || canon === r.brand) return r;
    return { ...r, brand: canon, id: cheeseImportId(canon, r.name) };
  });
}

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
      const parsedWb = parseCheeseWorkbook(grids);
      // Snap merged/renamed-away customer names to their canonical brand BEFORE
      // dedupe/existing-id matching, so a re-import of an old workbook updates
      // the renamed pool instead of resurrecting the old brand. Sheet recipes
      // are remapped too (sub-mix detection keys on recipe id), but the sheet's
      // own brand text stays as written for brand-prefix stripping.
      const recipes = remapCheeseRecipeBrands(parsedWb.recipes, aliases);
      const parsedSheets = parsedWb.sheets.map((s) => ({
        ...s,
        recipes: remapCheeseRecipeBrands(s.recipes, aliases),
      }));
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

  // Existing cheese recipes whose brand appears in the imported set but whose
  // id is NOT in the import — likely removed from the workbook.
  const importedBrands = new Set(recipes.map((r) => (r.brand ?? "").trim().toLowerCase()));
  const importedRecipeIds = new Set(recipes.map((r) => r.id));
  const absentRecipes = existing
    .filter(
      (r) =>
        importedBrands.has((r.brand ?? "").trim().toLowerCase()) &&
        !importedRecipeIds.has(r.id),
    )
    .map((r) => ({ id: r.id, name: r.name, brand: r.brand }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Attach "link to existing" suggestions so a blend written in shorthand snaps
  // onto the canonical recipe a spec-sheet import already created (same brand,
  // different name), instead of forking a duplicate. The dialog lets the manager
  // accept or reject each proposed link.
  // Flag sub-mixes (a blend that is itself an ingredient inside another blend on
  // the same tab) so review labels them instead of treating them as pizza-facing
  // blends, and collect fresh/perishable prep items to surface read-only.
  // After links attach, auto-prefix any still-unlinked blend whose name
  // collides with a DIFFERENT customer's recipe ("Lucia's Taco Mix") so two
  // brands' same-named blends never overwrite each other.
  const candidates = withCheeseSubMixes(
    withCheeseBrandPrefixes(
      withCheeseLinks(
        buildCheeseImportCandidates(recipes, (id) => existingIds.has(id)),
        existing,
        buildCheeseAliasLinkMaps(aliases),
      ),
      existing,
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
    absentRecipes,
    ...(note ? { note } : {}),
  };
}

export type CheeseCommitResult = {
  /** How many recipes were saved. */
  count: number;
  /** The full saved pool returned by the server after the commit. */
  saved: CheeseRecipe[];
};

/**
 * Apply a prepared cheese import: upsert the manager-approved recipes by id
 * through the existing /api/cheese-recipes path. `recipesToApply` is the
 * reviewed selection from the dialog. `recipesToRemove` is the set of recipe
 * ids the manager confirmed for removal from the absent-recipes list.
 * Re-reads current recipes right before writing so we merge onto the freshest list.
 */
export async function commitCheeseImport(
  _prepared: CheeseImportPrepared,
  recipesToApply: ReadonlyArray<CheeseRecipe>,
  newAliases: ReadonlyArray<SpecImportAlias> = [],
  recipesToRemove: ReadonlyArray<string> = [],
): Promise<CheeseCommitResult> {
  // Commit is a second trust boundary: never write a name-only/empty recipe
  // that could replace a populated server recipe during a re-import.
  const recipesWithComponents = recipesToApply.filter(
    (recipe) => (recipe.components?.length ?? 0) > 0,
  );
  if (recipesToApply.length === 0 && recipesToRemove.length === 0) return { count: 0, saved: [] };
  const existing = await fetchCheeseRecipes();
  const removeSet = new Set(recipesToRemove);
  const afterRemoval = recipesToRemove.length > 0
    ? existing.filter((r) => !removeSet.has(r.id))
    : existing;
  const merged = recipesWithComponents.length > 0
    ? mergeCheeseRecipes(afterRemoval, recipesWithComponents)
    : afterRemoval;
  const saved = await saveCheeseRecipes(merged);
  // Remember the review's manual "use existing recipe" picks as blend-name
  // aliases so the next import of the same sheet pre-suggests the same links.
  // Best-effort: the recipes already saved; learning is a bonus.
  if (newAliases.length) {
    let priorAliases: SpecImportAlias[] = [];
    try {
      priorAliases = await fetchSpecImportAliases();
    } catch {
      // Unknown alias state is safe: save the new mapping, but do not delete.
    }
    const [mixes, cheese] = await Promise.all([
      fetchMixes().catch(() => null),
      // saveCheeseRecipes returns the current full pool, so liveness reflects
      // the committed state rather than the pre-commit snapshot.
      Promise.resolve(saved),
    ]);
    const liveNames =
      mixes === null
        ? null
        : new Set(
            [...mixes, ...cheese]
              .map((r) => r.name.trim().toLowerCase())
              .filter(Boolean),
          );
    const keyOf = (a: SpecImportAlias) =>
      `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`;
    const incomingByKey = new Map(newAliases.map((a) => [keyOf(a), a]));
    const corrections = priorAliases
      .map((old) => {
        const next = incomingByKey.get(keyOf(old));
        if (
          old.kind !== "appType" ||
          next?.kind !== "appType" ||
          old.canonicalName.trim().toLowerCase() === next.canonicalName.trim().toLowerCase()
        ) {
          return null;
        }
        return { old, next };
      })
      .filter((v): v is { old: SpecImportAlias; next: SpecImportAlias } => v !== null);
    const toDelete =
      liveNames === null
        ? []
        : corrections
            .filter(({ old }) => !liveNames.has(old.canonicalName.trim().toLowerCase()))
            .map(({ old }) => ({ ...old, context: old.context ?? null }));
    if (toDelete.length) {
      try {
        await deleteSpecImportAliases(toDelete, { exactContext: true });
      } catch {
        // Best-effort: the import already applied.
      }
    }
    const reverseAliases = corrections.map(({ old, next }) => ({
      kind: old.kind,
      externalName: old.canonicalName,
      canonicalName: next.canonicalName,
      context: old.context ?? null,
    }));
    const aliasesToSave = [...newAliases, ...reverseAliases];
    try {
      await saveSpecImportAliases(aliasesToSave);
    } catch {
      // ignore — learning is non-critical
    }
    const mirrorable = aliasesToSave.filter(
      (a) => a.kind === "brand" || a.kind === "flavor" || a.kind === "appType",
    );
    if (mirrorable.length) {
      void saveAiCorrections(
        mirrorable.map((a) => ({
          domain:
            a.kind === "brand"
              ? ("brand" as const)
              : a.kind === "flavor"
                ? ("flavor" as const)
                : ("item" as const),
          fromText: a.externalName,
          toText: a.canonicalName,
        })),
      );
    }
  }
  return { count: recipesWithComponents.length, saved };
}
