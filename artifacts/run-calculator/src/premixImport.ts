// Excel premix-sheet importer — web orchestration glue.
//
// Pipeline: read the .xlsx into a SheetGrid[] → DETERMINISTICALLY parse each
// product tab/block into a ParsedPremix (name, per-pizza + per-batch quantities,
// batchSize from the block "Total", "pull N days early" note) → ground each
// block's brand/flavor/ingredients against the app's known lists + learned
// aliases → for blocks whose product name did NOT resolve, ask the read-only AI
// matcher to disambiguate the product (names only — never quantities) → convert
// to the Mix model with a deterministic id → summarize new-vs-update → on
// confirm, upsert into the existing mixes by id and write through the
// manager-gated saveMixes path, persisting any newly learned aliases.
//
// All pure logic lives in @workspace/premix-import; the only writes are through
// the existing /api/mixes path. This module just sequences them. Mirrors the
// mobile glue in artifacts/run-calculator-mobile/context/premixImport.ts
// (replit.md parity).

import {
  parsePremixWorkbook,
  groundPremix,
  premixMatchName,
  collectPremixAliases,
  applyPremixMatches,
  premixToMix,
  premixId,
  summarizePremixImport,
  buildPremixCandidates,
  suggestPremixRedirects,
  mergePremixIntoMixes,
  collectPremixFreezerPulls,
  collectPremixPrepItems,
  isPrepOnlyPremix,
  type ParsedPremix,
  type GroundedPremix,
  type PremixKnown,
  type PremixImportSummary,
  type PremixCandidate,
  type PremixFreezerPull,
  type PremixPrepItem,
  type SpecImportAlias,
} from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import { buildFreezerPullUpserts } from "@workspace/freezer-pull";
import { gridSanityIssue } from "@workspace/spec-import";
import { fetchFreezerPullItems, saveFreezerPullItems } from "./freezerPull";
import { loadSpecImportKnown } from "./storage";
import { readWorkbookGrids } from "./specImport";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";
import { fetchMixes, saveMixes } from "./mixes";
import { requestMatchPremix } from "./premixMatch";
import { saveAiCorrections } from "./aiCorrections";
import { savePremixSheet, buildPremixSheetLabel, deriveSourceKey } from "./savedPremixSheets";

export type PremixImportPrepared = {
  /** Ready-to-apply mixes (grounded, AI-matched, deterministic ids). */
  mixes: Mix[];
  /** Per-mix review list (each parsed mix + new/update status) for confirmation. */
  candidates: PremixCandidate[];
  summary: PremixImportSummary;
  /** New label→canonical mappings learned this import (persisted on confirm). */
  newAliases: SpecImportAlias[];
  /** Known brands the manager can re-match a candidate to in the review dialog. */
  brands: string[];
  /** Known flavors per brand, for the re-match flavor picker. */
  flavorsByBrand: Record<string, string[]>;
  /** Ids of mixes already saved, so a re-match can recompute new-vs-update. */
  existingIds: string[];
  /**
   * The CURRENT saved mixes (identity fields + components), so the review dialog
   * can offer a per-mix "Use existing mix instead" redirect picker AND show what
   * components would be removed when an existing mix is updated by the import.
   */
  existingMixes: { id: string; name: string; brand: string; flavor: string; components: { ingredient: string; perPizza: number; perBatchLbs?: number }[] }[];
  /**
   * Learned-alias redirect suggestions the review pre-applies: candidate mix id
   * (the dialog's stable key) → existing mix id the manager linked that sheet
   * name to in a past import.
   */
  redirectSuggestions: Record<string, string>;
  /**
   * Freezer-pull settings suggested by the sheets' "Pull N days early" notes,
   * keyed by the ORIGINAL parsed mix id (the review dialog's stable key), so
   * they follow the manager's include/exclude picks and are applied on confirm.
   */
  freezerPulls: Record<string, PremixFreezerPull[]>;
  /**
   * Per-batch-only "prep for the run" rows split OUT of the mixes (e.g. fresh
   * spinach) — shown read-only in the review so the split is visible. These are
   * NOT added as mix ingredients; ones with a pull note still flow to freezer
   * pulls via `freezerPulls`.
   */
  prepItems: PremixPrepItem[];
  /**
   * Existing mixes whose brand appears in the imported set but whose id is NOT
   * in the import — they were likely removed from the workbook. Shown in the
   * review dialog so the manager can choose to remove them. An absent mix whose
   * brand does NOT appear in the import at all is not listed (we can't infer
   * the file's scope for that brand).
   */
  absentMixes: { id: string; name: string; brand: string; flavor: string }[];
  /** Uploaded filename(s) for this import — used for per-file snapshot retention. */
  sourceNames?: string[];
  note?: string;
};

/** Build the premix grounding pool: known brands/flavors + a combined ingredient list. */
function toPremixKnown(known: ReturnType<typeof loadSpecImportKnown>): PremixKnown {
  const ingredients = [
    ...new Set([
      ...known.cheeseIngredients,
      ...known.doughIngredients,
      ...known.sauceIngredients,
    ]),
  ];
  return { brands: known.brands, flavorsByBrand: known.flavorsByBrand, ingredients };
}

/** Load the known lists + learned aliases + existing mixes shared by an import. */
async function loadPremixContext(): Promise<{
  known: PremixKnown;
  aliases: SpecImportAlias[];
  existing: Mix[];
}> {
  const known = toPremixKnown(loadSpecImportKnown());
  // Learned aliases are best-effort; proceed without them if the fetch fails.
  let aliases: SpecImportAlias[] = [];
  try {
    aliases = await fetchSpecImportAliases();
  } catch {
    aliases = [];
  }
  const existing = await fetchMixes();
  return { known, aliases, existing };
}

/** Hard cap on files per import so one batch can't fan out into a flood of AI calls. */
export const MAX_PREMIX_IMPORT_FILES = 10;

/**
 * Read one or more premix workbooks → deterministic parse → ground → AI-match
 * unresolved product names → convert to mixes → summarize. Throws on a hard
 * failure (e.g. every workbook unreadable/empty). Files that fail to read are
 * skipped and surfaced as a note; it only throws if NOTHING parsed.
 */
export async function preparePremixImport(
  buffers: ArrayBuffer[],
  onProgress?: (done: number, total: number) => void,
  names?: string[],
): Promise<PremixImportPrepared> {
  const { known, aliases, existing } = await loadPremixContext();

  const parsed: ParsedPremix[] = [];
  const errors: string[] = [];
  const failedNames: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    // Name each file so a failure can say WHICH file was skipped (fall back to a
    // positional label when the caller didn't pass filenames).
    const label = names?.[i]?.trim() || `File ${i + 1}`;
    try {
      const grids = await readWorkbookGrids(buffers[i]);
      // Cheap junk-file guard: the xlsx reader does NOT throw on garbage bytes
      // (a renamed PDF/image "reads" as one junk sheet), so reject empty or
      // binary-junk grids BEFORE the deterministic parse / AI matcher. In the
      // multi-file path this throw becomes the per-file "could not be read …
      // skipped" note. Shared with the spec importer (same wording/thresholds).
      const sanity = gridSanityIssue(grids);
      if (sanity) {
        throw new Error(sanity);
      }
      const blocks = parsePremixWorkbook(grids);
      if (blocks.length === 0) {
        failedNames.push(label);
        errors.push(`${label}: no recognizable premix blocks.`);
      } else {
        parsed.push(...blocks);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not be read";
      failedNames.push(label);
      errors.push(`${label}: ${msg}`);
    } finally {
      onProgress?.(i + 1, buffers.length);
    }
  }

  if (parsed.length === 0) {
    throw new Error(errors.length ? errors.join("\n") : "Nothing recognizable was found to import.");
  }

  // Deterministic grounding first (alias → exact → fuzzy → new).
  const grounded: GroundedPremix[] = parsed.map((p) => groundPremix(p, known, aliases));

  // Ask the AI matcher ONLY for blocks whose product didn't resolve. Names only;
  // quantities are already final. Best-effort — proceed without it on failure.
  const unresolvedNames = [
    ...new Set(
      grounded.filter((g) => !g.productResolved).map((g) => premixMatchName(g.mix)).filter(Boolean),
    ),
  ];
  let groundedMixes: ParsedPremix[] = grounded.map((g) => g.mix);
  if (unresolvedNames.length > 0) {
    try {
      const res = await requestMatchPremix({
        unmatchedNames: unresolvedNames,
        brands: known.brands,
        brandFlavors: known.flavorsByBrand,
      });
      const matched = applyPremixMatches(groundedMixes, res.matches, unresolvedNames);
      // Only accept AI matches for mixes that were actually unresolved — a
      // tab-keyed match must not overwrite a sibling block on the same tab
      // that already resolved deterministically.
      groundedMixes = groundedMixes.map((mix, i) =>
        grounded[i].productResolved ? mix : matched[i],
      );
    } catch {
      // AI unavailable / not a manager — keep deterministic grounding.
    }
  }

  // Convert to the Mix model; drop any block that can't form a valid mix.
  // Split the per-batch-only "prep for the run" rows OUT of each mix (operator's
  // model: those are prep / pull-early, not per-pizza ingredients), and skip a
  // block entirely when EVERY row is prep — it isn't a mix at all.
  const seen = new Set<string>();
  const mixes: Mix[] = [];
  for (const pm of groundedMixes) {
    if (isPrepOnlyPremix(pm)) continue;
    const mix = premixToMix(pm, { perPizzaOnly: true });
    if (!mix) continue;
    // De-dup within the import by deterministic id (re-importing the same block
    // across sheets/files collapses to one).
    if (seen.has(mix.id)) {
      const idx = mixes.findIndex((m) => m.id === mix.id);
      if (idx >= 0) mixes[idx] = mix;
      continue;
    }
    seen.add(mix.id);
    mixes.push(mix);
  }

  const existingIds = new Set(existing.map((m) => m.id));
  const summary = summarizePremixImport(mixes, (id) => existingIds.has(id));
  const candidates = buildPremixCandidates(mixes, (id) => existingIds.has(id));
  const newAliases = collectPremixAliases(grounded);

  // Existing mixes whose brand appears in the import but whose id is NOT in
  // the imported set — they were likely removed from the workbook.
  const importedBrands = new Set(mixes.map((m) => (m.brand ?? "").trim().toLowerCase()));
  const importedMixIds = new Set(mixes.map((m) => m.id));
  const absentMixes = existing
    .filter(
      (m) =>
        importedBrands.has((m.brand ?? "").trim().toLowerCase()) &&
        !importedMixIds.has(m.id),
    )
    .map((m) => ({ id: m.id, name: m.name, brand: m.brand, flavor: m.flavor }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Pick out the "Pull N days early" ingredient notes as freezer-pull settings
  // (keyed by the same deterministic ids the candidates carry at this point).
  const freezerPulls = collectPremixFreezerPulls(groundedMixes);
  // The per-batch-only rows split out of the mixes, for a read-only review note.
  const prepItems = collectPremixPrepItems(groundedMixes);

  const noteParts: string[] = [];
  if (errors.length) {
    const list = failedNames.length ? `: ${failedNames.join(", ")}` : "";
    noteParts.push(
      `${errors.length} file${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "was" : "were"} skipped${list}.`,
    );
  }
  const note = noteParts.length ? noteParts.join("\n") : undefined;

  // Learned "use existing mix" picks from past reviews: pre-apply the same
  // redirect so a re-import of the same sheet updates the chosen mix again.
  const redirectSuggestions = suggestPremixRedirects(candidates, existing, aliases);

  return {
    mixes,
    candidates,
    summary,
    newAliases,
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    existingIds: [...existingIds],
    existingMixes: existing
      .map((m) => ({ id: m.id, name: m.name, brand: m.brand, flavor: m.flavor, components: m.components ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    redirectSuggestions,
    freezerPulls,
    prepItems,
    absentMixes,
    ...(note ? { note } : {}),
  };
}

export type PremixCommitResult = {
  /** How many freezer-pull ingredient settings the import set/confirmed. */
  freezerPullCount: number;
  /** Non-fatal problem worth surfacing (the mixes themselves applied fine). */
  warning?: string;
};

/**
 * Apply a prepared premix import: upsert the manager-approved mixes by id,
 * optionally remove mixes the manager flagged as absent, set any freezer-pull
 * settings the sheets' pull notes suggested for the included mixes, then
 * persist new aliases. `mixesToApply` is the reviewed selection from the
 * dialog (already deselected/re-matched as the manager chose); `freezerPulls`
 * is the matching reviewed pull-note selection. `mixesToRemove` is the set of
 * mix ids the manager confirmed for removal from the absent-mixes list.
 */
export async function commitPremixImport(
  prepared: PremixImportPrepared,
  mixesToApply: ReadonlyArray<Mix>,
  freezerPulls: ReadonlyArray<PremixFreezerPull> = [],
  extraAliases: ReadonlyArray<SpecImportAlias> = [],
  mixesToRemove: ReadonlyArray<string> = [],
): Promise<PremixCommitResult> {
  // Nothing to apply at all — no mixes, no pull-note reminders, no removals.
  if (mixesToApply.length === 0 && freezerPulls.length === 0 && mixesToRemove.length === 0)
    return { freezerPullCount: 0 };

  // A premix sheet can be entirely prep/pull-early rows (no per-pizza mixes).
  // In that case there are no mixes to save, but its pull-note reminders below
  // must still persist — so only the mix write is gated on having mixes.
  if (mixesToApply.length > 0 || mixesToRemove.length > 0) {
    // Re-read current mixes right before writing so we merge onto the freshest
    // list (another manager may have edited mixes since prepare).
    const existing = await fetchMixes();
    const removeSet = new Set(mixesToRemove);
    const afterRemoval = mixesToRemove.length > 0
      ? existing.filter((m) => !removeSet.has(m.id))
      : existing;
    const merged = mixesToApply.length > 0
      ? mergePremixIntoMixes(afterRemoval, mixesToApply)
      : afterRemoval;
    await saveMixes(merged);

    // Snapshot the imported mixes server-side so the Mixes section can later
    // reconcile the current mixes against this premix sheet (new/drifted mixes).
    // Best-effort: the import already applied; the snapshot is a monitoring bonus.
    try {
      const names = prepared.sourceNames ?? [];
      await savePremixSheet(
        buildPremixSheetLabel(mixesToApply, names),
        [...mixesToApply],
        deriveSourceKey(names),
      );
    } catch {
      // ignore — monitoring snapshot is non-critical
    }
  }

  // Set the freezer-pull settings the pull notes suggested for the included
  // mixes: update an existing tagged ingredient's lead time, or tag it fresh.
  // Failure here is surfaced as a warning — the mixes themselves applied fine.
  let freezerPullCount = 0;
  let warning: string | undefined;
  if (freezerPulls.length > 0) {
    try {
      const existingItems = await fetchFreezerPullItems();
      const upserts = buildFreezerPullUpserts(existingItems, [...freezerPulls]);
      if (upserts.length > 0) await saveFreezerPullItems(upserts);
      freezerPullCount = new Set(
        freezerPulls.map((p) => p.ingredient.trim().toLowerCase()).filter(Boolean),
      ).size;
    } catch {
      warning =
        "The mixes were imported, but the freezer-pull reminders could not be saved. You can set them in the Freezer Pull settings.";
    }
  }

  // Persist learned name mappings: the grounding pass's brand/flavor aliases
  // plus any "use existing mix" picks the review dialog collected (blend-name
  // "appType" aliases). Best-effort: the import already applied.
  const aliasesToSave = [...prepared.newAliases, ...extraAliases];
  if (aliasesToSave.length) {
    try {
      await saveSpecImportAliases(aliasesToSave);
    } catch {
      // Best-effort: the import already applied; learning is a bonus.
    }
    // Mirror each learned BRAND/FLAVOR mapping into the factory-wide corrections
    // pool so every other name-resolving AI helper honors it too. Other kinds
    // (e.g. the "appType" blend-name picks) have no corrections domain — mixing
    // them in would mis-file a mix name as a flavor correction.
    const mirrorable = aliasesToSave.filter(
      (a) => a.kind === "brand" || a.kind === "flavor",
    );
    if (mirrorable.length) {
      void saveAiCorrections(
        mirrorable.map((a) => ({
          domain: a.kind === "brand" ? ("brand" as const) : ("flavor" as const),
          fromText: a.externalName,
          toText: a.canonicalName,
        })),
      );
    }
  }

  return { freezerPullCount, ...(warning ? { warning } : {}) };
}

export { premixId };
