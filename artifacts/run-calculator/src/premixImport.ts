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
  collectPremixAliases,
  applyPremixMatches,
  premixToMix,
  premixId,
  summarizePremixImport,
  mergePremixIntoMixes,
  type ParsedPremix,
  type GroundedPremix,
  type PremixKnown,
  type PremixImportSummary,
  type SpecImportAlias,
} from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import { loadSpecImportKnown } from "./storage";
import { readWorkbookGrids } from "./specImport";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";
import { fetchMixes, saveMixes } from "./mixes";
import { requestMatchPremix } from "./premixMatch";
import { saveAiCorrections } from "./aiCorrections";

export type PremixImportPrepared = {
  /** Ready-to-apply mixes (grounded, AI-matched, deterministic ids). */
  mixes: Mix[];
  summary: PremixImportSummary;
  /** New label→canonical mappings learned this import (persisted on confirm). */
  newAliases: SpecImportAlias[];
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
): Promise<PremixImportPrepared> {
  const { known, aliases, existing } = await loadPremixContext();

  const parsed: ParsedPremix[] = [];
  const errors: string[] = [];
  let done = 0;
  for (const buf of buffers) {
    try {
      const grids = await readWorkbookGrids(buf);
      const blocks = parsePremixWorkbook(grids);
      if (blocks.length === 0) {
        errors.push("A workbook had no recognizable premix blocks.");
      } else {
        parsed.push(...blocks);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Could not read a file.");
    } finally {
      done += 1;
      onProgress?.(done, buffers.length);
    }
  }

  if (parsed.length === 0) {
    throw new Error(errors[0] ?? "Nothing recognizable was found to import.");
  }

  // Deterministic grounding first (alias → exact → fuzzy → new).
  const grounded: GroundedPremix[] = parsed.map((p) => groundPremix(p, known, aliases));

  // Ask the AI matcher ONLY for blocks whose product didn't resolve. Names only;
  // quantities are already final. Best-effort — proceed without it on failure.
  const unresolvedNames = [
    ...new Set(grounded.filter((g) => !g.productResolved).map((g) => g.mix.name).filter(Boolean)),
  ];
  let groundedMixes: ParsedPremix[] = grounded.map((g) => g.mix);
  if (unresolvedNames.length > 0) {
    try {
      const res = await requestMatchPremix({
        unmatchedNames: unresolvedNames,
        brands: known.brands,
        brandFlavors: known.flavorsByBrand,
      });
      groundedMixes = applyPremixMatches(groundedMixes, res.matches);
    } catch {
      // AI unavailable / not a manager — keep deterministic grounding.
    }
  }

  // Convert to the Mix model; drop any block that can't form a valid mix.
  const seen = new Set<string>();
  const mixes: Mix[] = [];
  for (const pm of groundedMixes) {
    const mix = premixToMix(pm);
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
  const newAliases = collectPremixAliases(grounded);

  const noteParts: string[] = [];
  if (errors.length) {
    noteParts.push(
      `${errors.length} file${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "was" : "were"} skipped.`,
    );
  }
  const note = noteParts.length ? noteParts.join("\n") : undefined;

  return { mixes, summary, newAliases, ...(note ? { note } : {}) };
}

/** Apply a prepared premix import: upsert mixes by id, then persist new aliases. */
export async function commitPremixImport(prepared: PremixImportPrepared): Promise<void> {
  // Re-read current mixes right before writing so we merge onto the freshest
  // list (another manager may have edited mixes since prepare).
  const existing = await fetchMixes();
  const merged = mergePremixIntoMixes(existing, prepared.mixes);
  await saveMixes(merged);

  if (prepared.newAliases.length) {
    try {
      await saveSpecImportAliases(prepared.newAliases);
    } catch {
      // Best-effort: the import already applied; learning is a bonus.
    }
    // Mirror each learned brand/flavor mapping into the factory-wide corrections
    // pool so every other name-resolving AI helper honors it too.
    void saveAiCorrections(
      prepared.newAliases.map((a) => ({
        domain: a.kind === "brand" ? "brand" : "flavor",
        fromText: a.externalName,
        toText: a.canonicalName,
      })),
    );
  }
}

export { premixId };
