// Excel spec-sheet importer — web orchestration glue.
//
// Pipeline: read the .xlsx into a SheetGrid[] → flatten to compact prompt text →
// call the read-only AI parse endpoint → canonicalize the returned names against
// the app's known lists (learned aliases first, then exact, then confident
// fuzzy) → summarize new-vs-updated → on confirm, write profiles + recipe
// presets (overwrite existing, add new) and persist any newly learned aliases.
//
// All pure logic lives in @workspace/spec-import; storage writes live in
// storage.ts. This module only sequences them. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/specImport.ts (replit.md parity).

import * as XLSX from "xlsx";
import {
  applyNameMatches,
  canonicalize,
  collectMatchCandidates,
  collectSpecAliases,
  crossFillSpecImport,
  gridsToPromptText,
  mergeParsedSpecImports,
  partitionTombstonedParse,
  recipeTargets,
  splitGridsForPrompt,
  summarizeSpecImport,
  type CanonicalResult,
  type ExtraNameMatches,
  type NameMatch,
  type ParsedRecipeTarget,
  type ParsedSpecImport,
  type ScopedNameMatch,
  type SheetGrid,
  type SpecAliasKind,
  type SpecImportAlias,
  type SpecImportSkipped,
  type SpecImportSummary,
  type SpecMatchKnown,
} from "@workspace/spec-import";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  type Discrepancy,
} from "@workspace/spec-reconcile";
import {
  loadSpecImportKnown,
  profileExistsForImport,
  recipeExistsForImport,
  importProfileIsTombstoned,
  recipeNameIsTombstoned,
  applySpecImport,
} from "./storage";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";
import {
  saveSpecSheet,
  buildSpecSheetLabel,
  deriveSourceKey,
  loadCurrentReconcileRecipes,
} from "./savedSpecSheets";
import { requestParseSpecSheet } from "./parseSpecSheet";
import { requestMatchImport } from "./matchImport";
import { saveAiCorrections } from "./aiCorrections";
import type { ReviewVerdict } from "@workspace/ai-review";

export type SpecFlaggedItem = { label: string; review: ReviewVerdict };

export type SpecImportPrepared = {
  /** Canonicalized, ready-to-apply parse result. */
  parsed: ParsedSpecImport;
  summary: SpecImportSummary;
  /** New label→canonical mappings learned this import (persisted on confirm). */
  newAliases: SpecImportAlias[];
  /** Reviewer-AI flags on parsed profiles/recipes (warn/reject only; advisory). */
  flagged: SpecFlaggedItem[];
  /**
   * Deterministic diff of the incoming spec recipes against the CURRENT recipe
   * library — i.e. exactly what applying this import would change. Advisory; no
   * AI involved.
   */
  discrepancies: Discrepancy[];
  /**
   * Profiles/recipes this import would have re-created but the user previously
   * merged or deleted away. Excluded from `parsed` (so the merge sticks), but
   * surfaced in the review so the user can knowingly re-include one if they meant
   * to bring it back.
   */
  skipped: SpecImportSkipped;
  /** Known brands + flavors-by-brand for the review's product-match pickers. */
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  /** Uploaded filename(s) for this import — used for per-file snapshot retention. */
  sourceNames?: string[];
  note?: string;
};

// Map a learned spec-import alias kind to a shared-corrections domain.
function aliasKindToDomain(kind: SpecAliasKind): string {
  if (kind === "brand") return "brand";
  if (kind === "flavor") return "flavor";
  if (kind === "appType" || kind === "pepType") return "item";
  // dough/sauce/cheese ingredient kinds
  return "ingredient";
}

/** Read an .xlsx File/Blob into flat sheet grids (string cells). */
export async function readWorkbookGrids(data: ArrayBuffer): Promise<SheetGrid[]> {
  const wb = XLSX.read(data, { type: "array" });
  const grids: SheetGrid[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    grids.push({
      name,
      rows: rows.map(r => (Array.isArray(r) ? r.map(c => (c == null ? "" : String(c))) : [])),
    });
  }
  return grids;
}

function recipeKindToAliasKind(kind: "dough" | "sauce" | "cheese"): SpecAliasKind {
  if (kind === "dough") return "doughIngredient";
  if (kind === "sauce") return "sauceIngredient";
  return "cheeseIngredient";
}

function ingredientKnownForKind(
  kind: "dough" | "sauce" | "cheese",
  known: ReturnType<typeof loadSpecImportKnown>,
): string[] {
  if (kind === "cheese") return known.cheeseIngredients;
  if (kind === "dough") return known.doughIngredients;
  return known.sauceIngredients; // sauce recipes ground against the frontline/sauce ingredient pool
}

/**
 * Canonicalize every name in the AI result against the app's known lists +
 * learned aliases, returning a clean ParsedSpecImport plus the alias pairs worth
 * remembering. Pure given its inputs.
 */
function canonicalizeParsed(
  raw: ParsedSpecImport,
  known: ReturnType<typeof loadSpecImportKnown>,
  aliases: SpecImportAlias[],
): { parsed: ParsedSpecImport; resolved: { kind: SpecAliasKind; result: CanonicalResult; context?: string | null }[] } {
  const resolved: { kind: SpecAliasKind; result: CanonicalResult; context?: string | null }[] = [];
  const track = (kind: SpecAliasKind, result: CanonicalResult, context: string | null = null) => {
    resolved.push({ kind, result, context });
    return result.value;
  };

  const profiles = raw.profiles.map(p => {
    const brand = track("brand", canonicalize(p.brand, known.brands, aliases, "brand"));
    const knownFlavors = known.flavorsByBrand[brand] ?? [];
    const flavor = track("flavor", canonicalize(p.flavor, knownFlavors, aliases, "flavor", brand), brand);
    return {
      ...p,
      brand,
      flavor,
      applicators: p.applicators.map(a => ({
        ...a,
        type: track("appType", canonicalize(a.type, known.appTypes, aliases, "appType")),
      })),
      pepperonis: p.pepperonis.map(pp => ({
        ...pp,
        type: track("pepType", canonicalize(pp.type, known.pepTypes, aliases, "pepType")),
      })),
    };
  });

  const recipes = raw.recipes.map(r => {
    const aliasKind = recipeKindToAliasKind(r.kind);
    const ingKnown = ingredientKnownForKind(r.kind, known);
    const out = {
      ...r,
      rows: r.rows.map(row => ({
        ...row,
        ingredient: track(aliasKind, canonicalize(row.ingredient, ingKnown, aliases, aliasKind)),
      })),
    };
    if (r.brand) {
      out.brand = track("brand", canonicalize(r.brand, known.brands, aliases, "brand"));
      if (r.flavor) {
        const kf = known.flavorsByBrand[out.brand] ?? [];
        out.flavor = track("flavor", canonicalize(r.flavor, kf, aliases, "flavor", out.brand), out.brand);
      }
    }
    if (r.targets && r.targets.length) {
      out.targets = r.targets.map((t): ParsedRecipeTarget => {
        const brand = track("brand", canonicalize(t.brand, known.brands, aliases, "brand"));
        const kf = known.flavorsByBrand[brand] ?? [];
        const flavor = track("flavor", canonicalize(t.flavor, kf, aliases, "flavor", brand), brand);
        return { brand, flavor };
      });
    }
    return out;
  });

  return { parsed: { profiles, recipes, ...(raw.note ? { note: raw.note } : {}) }, resolved };
}

type ParseCore = {
  parsed: ParsedSpecImport;
  resolved: ReturnType<typeof canonicalizeParsed>["resolved"];
  flagged: SpecFlaggedItem[];
  /** Rows dropped because the workbook was too large to chunk fully. */
  droppedRows: number;
};

/**
 * Chunks whose prompt text is at least this many characters are expected to
 * yield SOMETHING; an empty parse for one is treated as a failed AI pass and
 * retried once. Tiny chunks (e.g. a stray header-only sheet) can legitimately
 * parse to nothing, so they are never retried. Mirrored in the mobile app.
 */
const RETRY_MIN_CHUNK_CHARS = 200;

/**
 * True when an AI parse pass came back unusable: nothing extracted, or the
 * server attached a failure note (it returns empty + note when the model's
 * response was cut off / malformed).
 */
function isFailedParsePass(ai: {
  profiles: unknown[];
  recipes: unknown[];
  note?: string;
}): boolean {
  return (ai.profiles.length === 0 && ai.recipes.length === 0) || Boolean(ai.note);
}

/**
 * Read one workbook → AI parse → canonicalize, returning the canonicalized
 * parse, the resolved alias pairs, and the reviewer-AI flags for that single
 * file. A workbook too large for one prompt is split into chunks and parsed in
 * several calls (full ingestion instead of silent truncation); the per-chunk
 * raw parses are merged before canonicalizing. Throws on a hard failure (empty
 * workbook, AI unavailable/forbidden). Shared by the single- and multi-file
 * prepare paths so they stay identical.
 */
async function parseWorkbookCore(
  grids: SheetGrid[],
  known: ReturnType<typeof loadSpecImportKnown>,
  aliases: SpecImportAlias[],
): Promise<ParseCore> {
  const { chunks, droppedRows } = splitGridsForPrompt(grids);
  if (!chunks.length) {
    throw new Error("That workbook looks empty — nothing to import.");
  }

  const knownInput = {
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    appTypes: known.appTypes,
    pepTypes: known.pepTypes,
    cheeseIngredients: known.cheeseIngredients,
    doughIngredients: known.doughIngredients,
    sauceIngredients: known.sauceIngredients,
    dieTypes: known.dieTypes,
  };

  const rawList: ParsedSpecImport[] = [];
  const flagged: SpecFlaggedItem[] = [];
  for (const chunk of chunks) {
    const workbookText = gridsToPromptText(chunk);
    if (!workbookText.trim()) continue;
    let ai = await requestParseSpecSheet({ workbookText, known: knownInput, aliases });
    // One automatic retry for a failed pass on a non-trivial chunk: the model
    // occasionally returns an empty/cut-off response for a single chunk, and
    // without a retry the user's only recourse is re-running (and re-billing)
    // the WHOLE import. A single retry per chunk stays well under the server's
    // 10/min parse rate limit. Fail-safe: if the retry itself throws, keep the
    // first (noted) result instead of failing the whole import.
    if (isFailedParsePass(ai) && workbookText.length >= RETRY_MIN_CHUNK_CHARS) {
      try {
        const retry = await requestParseSpecSheet({ workbookText, known: knownInput, aliases });
        if (!isFailedParsePass(retry)) ai = retry;
      } catch {
        // Keep the original result (empty + note) — the note still surfaces.
      }
    }
    rawList.push({
      profiles: ai.profiles,
      recipes: ai.recipes,
      ...(ai.note ? { note: ai.note } : {}),
    });
    // Reviewer-AI flags ride on the raw AI profiles/recipes (warn/reject only).
    for (const p of ai.profiles) {
      if (p.review && p.review.status !== "ok") {
        flagged.push({ label: `${p.brand} / ${p.flavor}`.trim(), review: p.review });
      }
    }
    for (const r of ai.recipes) {
      if (r.review && r.review.status !== "ok") {
        const tgts = recipeTargets(r);
        const ctx = tgts.length
          ? ` — ${tgts[0].brand}/${tgts[0].flavor}${tgts.length > 1 ? ` +${tgts.length - 1} more` : ""}`
          : "";
        flagged.push({ label: `${r.kind} recipe${ctx}`, review: r.review });
      }
    }
  }

  if (!rawList.length) {
    throw new Error("That workbook looks empty — nothing to import.");
  }

  const rawMerged = rawList.length === 1 ? rawList[0] : mergeParsedSpecImports(rawList);
  const { parsed, resolved } = canonicalizeParsed(rawMerged, known, aliases);

  return { parsed, resolved, flagged, droppedRows };
}

/**
 * Second linking pass over a canonicalized parse: ask the AI matcher to fold any
 * brand/flavor that canonicalized as "new" onto an existing saved one (so we
 * update instead of duplicating), then conservatively cross-fill blank
 * dieType/sauceOzPerPizza from agreeing same-brand siblings. Fail-safe: any AI
 * error leaves the parse exactly as canonicalized. Returns the linked parse plus
 * the brand/flavor aliases worth remembering.
 */
async function linkParsed(
  parsed: ParsedSpecImport,
  known: ReturnType<typeof loadSpecImportKnown>,
): Promise<{ parsed: ParsedSpecImport; matchAliases: SpecImportAlias[] }> {
  let working = parsed;
  const aliasByKey = new Map<string, SpecImportAlias>();
  const recordAliases = (aliases: SpecImportAlias[]) => {
    for (const a of aliases) aliasByKey.set(specMatchAliasKey(a), a);
  };

  const matchKnown: SpecMatchKnown = {
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    doughIngredients: known.doughIngredients,
    sauceIngredients: known.sauceIngredients,
    cheeseIngredients: known.cheeseIngredients,
    appTypes: known.appTypes,
    pepTypes: known.pepTypes,
  };
  // Known ingredients keyed by recipe kind for the match request's known pool.
  const knownIngredientsInput = {
    dough: known.doughIngredients,
    sauce: known.sauceIngredients,
    cheese: known.cheeseIngredients,
  };

  try {
    // Pass 1: brands + flavors-under-known-brands + ingredients/applicators/pepperonis.
    const c1 = collectMatchCandidates(working, matchKnown);
    const askedFlavorKeys = new Set(
      c1.flavors.map((f) => `${f.brand.trim().toLowerCase()}\u0000${f.flavor.trim().toLowerCase()}`),
    );
    if (
      c1.brands.length ||
      c1.flavors.length ||
      c1.ingredients.length ||
      c1.appTypes.length ||
      c1.pepTypes.length
    ) {
      const result = await requestMatchImport({
        brands: known.brands,
        brandFlavors: known.flavorsByBrand,
        unmatchedBrands: c1.brands,
        unmatchedFlavors: c1.flavors,
        knownIngredients: knownIngredientsInput,
        knownAppTypes: known.appTypes,
        knownPepTypes: known.pepTypes,
        unmatchedIngredients: c1.ingredients,
        unmatchedAppTypes: c1.appTypes,
        unmatchedPepTypes: c1.pepTypes,
      });
      const brandMatches: NameMatch[] = result.brandMatches.map((m) => ({
        candidate: m.candidate,
        match: m.match,
      }));
      const flavorMatches: ScopedNameMatch[] = result.flavorMatches.map((m) => ({
        brand: m.brand,
        candidate: m.candidate,
        match: m.match,
      }));
      const extra: ExtraNameMatches = {
        ingredientMatches: (result.ingredientMatches ?? []).map((m) => ({
          kind: m.kind,
          candidate: m.candidate,
          match: m.match,
        })),
        appTypeMatches: (result.appTypeMatches ?? []).map((m) => ({
          candidate: m.candidate,
          match: m.match,
        })),
        pepTypeMatches: (result.pepTypeMatches ?? []).map((m) => ({
          candidate: m.candidate,
          match: m.match,
        })),
      };
      const applied = applyNameMatches(working, brandMatches, flavorMatches, extra);
      working = applied.parsed;
      recordAliases(applied.aliases);

      // Pass 2: brand matches may have moved a flavor under a now-known brand.
      // Re-collect ONLY new flavor candidates (not asked in pass 1) and match them.
      const c2 = collectMatchCandidates(working, matchKnown);
      const newFlavors = c2.flavors.filter(
        (f) =>
          !askedFlavorKeys.has(
            `${f.brand.trim().toLowerCase()}\u0000${f.flavor.trim().toLowerCase()}`,
          ),
      );
      if (newFlavors.length) {
        const r2 = await requestMatchImport({
          brands: known.brands,
          brandFlavors: known.flavorsByBrand,
          unmatchedBrands: [],
          unmatchedFlavors: newFlavors,
        });
        const flavorMatches2: ScopedNameMatch[] = r2.flavorMatches.map((m) => ({
          brand: m.brand,
          candidate: m.candidate,
          match: m.match,
        }));
        if (flavorMatches2.length) {
          const applied2 = applyNameMatches(working, [], flavorMatches2);
          working = applied2.parsed;
          recordAliases(applied2.aliases);
        }
      }
    }
  } catch {
    // Fail-safe: keep the canonicalized parse exactly as-is.
  }

  working = crossFillSpecImport(working).parsed;
  return { parsed: working, matchAliases: [...aliasByKey.values()] };
}

/** Stable dedupe key for a learned alias (kind + external name + optional context). */
function specMatchAliasKey(a: SpecImportAlias): string {
  return `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`;
}

/** Build the "what will change" diff of the incoming spec vs current recipes. */
export function buildDiscrepancies(parsed: ParsedSpecImport): Discrepancy[] {
  try {
    return reconcileSpecWithRecipes({
      specRecipes: toReconcileRecipes(parsed.recipes),
      currentRecipes: loadCurrentReconcileRecipes(),
    });
  } catch {
    return [];
  }
}

/** Append a "rows dropped" advisory to a parse note when a workbook was too big. */
function appendDroppedNote(note: string | undefined, droppedRows: number): string | undefined {
  if (droppedRows <= 0) return note;
  const msg = `Part of the workbook was too large to read fully — ${droppedRows} row${droppedRows === 1 ? "" : "s"} were skipped.`;
  return note ? `${note}\n${msg}` : msg;
}

/** Load the known lists + learned aliases shared by every file in an import. */
async function loadSpecImportContext(): Promise<{
  known: ReturnType<typeof loadSpecImportKnown>;
  aliases: SpecImportAlias[];
}> {
  const known = loadSpecImportKnown();
  // Learned aliases are best-effort; proceed without them if the fetch fails.
  let aliases: SpecImportAlias[] = [];
  try {
    aliases = await fetchSpecImportAliases();
  } catch {
    aliases = [];
  }
  return { known, aliases };
}

/**
 * Full read → AI → canonicalize → summarize step. Throws on a hard failure
 * (e.g. unreadable workbook, AI unavailable/forbidden) so the UI can show why.
 */
export async function prepareSpecImport(data: ArrayBuffer): Promise<SpecImportPrepared> {
  const { known, aliases } = await loadSpecImportContext();
  const grids = await readWorkbookGrids(data);
  const { parsed: rawParsed, resolved, flagged, droppedRows } = await parseWorkbookCore(
    grids,
    known,
    aliases,
  );

  // Fold "new" names onto existing saved ones (no dupes) + conservative cross-fill.
  const { parsed: linked, matchAliases } = await linkParsed(rawParsed, known);

  // Respect the user's prior merges/deletions: an import must not resurrect a
  // brand/flavor or recipe name they tombstoned. Skipped items are surfaced (not
  // silently dropped) so they can be knowingly re-included in review.
  const { kept: parsed, skipped } = partitionTombstonedParse(
    linked,
    importProfileIsTombstoned,
    recipeNameIsTombstoned,
  );

  const summary = summarizeSpecImport(parsed, profileExistsForImport, recipeExistsForImport);
  const newAliases = [...collectSpecAliases(resolved), ...matchAliases];
  const discrepancies = buildDiscrepancies(parsed);
  const note = appendDroppedNote(parsed.note, droppedRows);

  return {
    parsed,
    summary,
    newAliases,
    flagged,
    discrepancies,
    skipped,
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    ...(note ? { note } : {}),
  };
}

/** Hard cap on files per import so one batch can't fan out into a flood of AI calls. */
export const MAX_SPEC_IMPORT_FILES = 10;

/**
 * Multi-file variant: parse several workbooks in ONE import. Each file is its
 * own AI call (run sequentially to respect the endpoint's cost/rate guards),
 * then the per-file parses are merged into a single review (profiles deduped by
 * brand+flavor, recipes by kind+name, later files winning). Files that fail to
 * read are skipped and surfaced as a note; it only throws if EVERY file failed.
 */
export async function prepareSpecImportMulti(
  buffers: ArrayBuffer[],
  onProgress?: (done: number, total: number) => void,
  names?: string[],
): Promise<SpecImportPrepared> {
  const { known, aliases } = await loadSpecImportContext();

  const parsedList: ParsedSpecImport[] = [];
  const allResolved: ParseCore["resolved"] = [];
  const flagged: SpecFlaggedItem[] = [];
  const errors: string[] = [];
  const failedNames: string[] = [];
  let totalDropped = 0;

  for (let i = 0; i < buffers.length; i++) {
    // Name each file so a failure can say WHICH file was skipped (fall back to a
    // positional label when the caller didn't pass filenames).
    const label = names?.[i]?.trim() || `File ${i + 1}`;
    try {
      const grids = await readWorkbookGrids(buffers[i]);
      const core = await parseWorkbookCore(grids, known, aliases);
      parsedList.push(core.parsed);
      allResolved.push(...core.resolved);
      flagged.push(...core.flagged);
      totalDropped += core.droppedRows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not be read";
      failedNames.push(label);
      errors.push(`${label}: ${msg}`);
    } finally {
      onProgress?.(i + 1, buffers.length);
    }
  }

  if (parsedList.length === 0) {
    throw new Error(errors.length ? errors.join("\n") : "Nothing to import.");
  }

  const merged = mergeParsedSpecImports(parsedList);
  // Fold "new" names onto existing saved ones (no dupes) + conservative cross-fill.
  const { parsed: linked, matchAliases } = await linkParsed(merged, known);

  // Respect prior merges/deletions (see prepareSpecImport).
  const { kept: parsed, skipped } = partitionTombstonedParse(
    linked,
    importProfileIsTombstoned,
    recipeNameIsTombstoned,
  );

  const summary = summarizeSpecImport(parsed, profileExistsForImport, recipeExistsForImport);
  const newAliases = [...collectSpecAliases(allResolved), ...matchAliases];
  const discrepancies = buildDiscrepancies(parsed);

  const noteParts: string[] = [];
  if (parsed.note) noteParts.push(parsed.note);
  if (errors.length) {
    const list = failedNames.length ? `: ${failedNames.join(", ")}` : "";
    noteParts.push(
      `${errors.length} file${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "was" : "were"} skipped${list}.`,
    );
  }
  const note = appendDroppedNote(noteParts.length ? noteParts.join("\n") : undefined, totalDropped);

  return {
    parsed,
    summary,
    newAliases,
    flagged,
    discrepancies,
    skipped,
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    ...(note ? { note } : {}),
  };
}

/** Apply a prepared import: write profiles + recipes, then persist new aliases. */
export async function commitSpecImport(prepared: SpecImportPrepared): Promise<void> {
  applySpecImport(prepared.parsed);

  // Snapshot this import server-side (factory-wide; only the two most recent are
  // kept) so it can later be cross-referenced against the current recipe library
  // (see /ai/spec-reconcile). Best-effort: the import already applied locally, so
  // a failed snapshot must never surface as an import error.
  if ((prepared.parsed.recipes?.length ?? 0) > 0) {
    try {
      const names = prepared.sourceNames ?? [];
      await saveSpecSheet(
        buildSpecSheetLabel(prepared.parsed, names),
        prepared.parsed,
        deriveSourceKey(names),
      );
    } catch {
      // best-effort
    }
  }

  if (prepared.newAliases.length) {
    try {
      await saveSpecImportAliases(prepared.newAliases);
    } catch {
      // Best-effort: the import already applied; learning is a bonus.
    }
    // Mirror each learned name mapping into the factory-wide corrections pool
    // (additive — alongside the spec-import aliases above) so every other
    // name-resolving AI helper honors it too.
    void saveAiCorrections(
      prepared.newAliases.map((a) => ({
        domain: aliasKindToDomain(a.kind),
        fromText: a.externalName,
        toText: a.canonicalName,
      })),
    );
  }
}
