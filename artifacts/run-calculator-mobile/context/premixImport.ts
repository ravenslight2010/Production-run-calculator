// Excel premix-sheet importer — mobile orchestration glue.
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
// the existing /api/mixes path. This module just sequences them. Mirrors the web
// glue in artifacts/run-calculator/src/premixImport.ts (replit.md parity). The
// platform difference is plumbing: web reads localStorage directly, mobile takes
// a PremixImportStore built from the RunContext value (known lists), and reads
// the workbook from base64 (native) or an ArrayBuffer (web).

import {
  parsePremixWorkbook,
  groundPremix,
  collectPremixAliases,
  applyPremixMatches,
  premixToMix,
  premixId,
  summarizePremixImport,
  buildPremixCandidates,
  mergePremixIntoMixes,
  type ParsedPremix,
  type GroundedPremix,
  type PremixKnown,
  type PremixImportSummary,
  type PremixCandidate,
  type SheetGrid,
  type SpecImportAlias,
} from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";
import { fetchMixes, saveMixes } from "./mixes";
import { requestMatchPremix } from "./premixMatch";
import { saveAiCorrections } from "./aiCorrections";

/**
 * Everything this module needs from the RunContext, injected by the UI (mobile
 * has no module-level store). The web equivalent reads localStorage directly.
 */
export type PremixImportStore = {
  known: PremixKnown;
};

export type PremixImportPrepared = {
  /** Ready-to-apply mixes (grounded, AI-matched, deterministic ids). */
  mixes: Mix[];
  /** Per-mix review list (each parsed mix + new/update status) for confirmation. */
  candidates: PremixCandidate[];
  summary: PremixImportSummary;
  /** New label→canonical mappings learned this import (persisted on confirm). */
  newAliases: SpecImportAlias[];
  note?: string;
};

/** Hard cap on files per import so one batch can't fan out into a flood of AI calls. */
export const MAX_PREMIX_IMPORT_FILES = 10;

/** Learned aliases are best-effort; proceed without them if the fetch fails. */
async function loadPremixAliases(): Promise<SpecImportAlias[]> {
  try {
    return await fetchSpecImportAliases();
  } catch {
    return [];
  }
}

/**
 * Read one or more premix workbooks (as already-parsed grids) → deterministic
 * parse → ground → AI-match unresolved product names → convert to mixes →
 * summarize. Throws on a hard failure (every workbook unreadable/empty). Files
 * that fail to read are skipped and surfaced as a note; only throws if NOTHING
 * parsed.
 */
export async function preparePremixImport(
  gridsList: SheetGrid[][],
  store: PremixImportStore,
  onProgress?: (done: number, total: number) => void,
): Promise<PremixImportPrepared> {
  const { known } = store;
  const aliases = await loadPremixAliases();
  const existing = await fetchMixes();

  const parsed: ParsedPremix[] = [];
  const errors: string[] = [];
  let done = 0;
  for (const grids of gridsList) {
    try {
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
      onProgress?.(done, gridsList.length);
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

  // Convert to the Mix model; drop any block that can't form a valid mix, and
  // de-dup within the import by deterministic id (later wins).
  const seen = new Set<string>();
  const mixes: Mix[] = [];
  for (const pm of groundedMixes) {
    const mix = premixToMix(pm);
    if (!mix) continue;
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

  const noteParts: string[] = [];
  if (errors.length) {
    noteParts.push(
      `${errors.length} file${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "was" : "were"} skipped.`,
    );
  }
  const note = noteParts.length ? noteParts.join("\n") : undefined;

  return { mixes, candidates, summary, newAliases, ...(note ? { note } : {}) };
}

/**
 * Apply a prepared premix import: upsert mixes by id, then persist new aliases.
 * Only the mixes whose ids are in `selectedIds` are written; pass `undefined`
 * (or omit) to apply all parsed mixes.
 */
export async function commitPremixImport(
  prepared: PremixImportPrepared,
  selectedIds?: Iterable<string>,
): Promise<void> {
  const allow = selectedIds ? new Set(selectedIds) : null;
  const toApply = allow ? prepared.mixes.filter((m) => allow.has(m.id)) : prepared.mixes;
  if (toApply.length === 0) return;
  // Re-read current mixes right before writing so we merge onto the freshest
  // list (another manager may have edited mixes since prepare).
  const existing = await fetchMixes();
  const merged = mergePremixIntoMixes(existing, toApply);
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
