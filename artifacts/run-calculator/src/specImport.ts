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
  canonicalize,
  collectSpecAliases,
  gridsToPromptText,
  mergeParsedSpecImports,
  recipeTargets,
  summarizeSpecImport,
  type CanonicalResult,
  type ParsedRecipeTarget,
  type ParsedSpecImport,
  type SheetGrid,
  type SpecAliasKind,
  type SpecImportAlias,
  type SpecImportSummary,
} from "@workspace/spec-import";
import {
  loadSpecImportKnown,
  profileExistsForImport,
  recipeExistsForImport,
  applySpecImport,
} from "./storage";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";
import { saveSpecSheet, buildSpecSheetLabel } from "./savedSpecSheets";
import { requestParseSpecSheet } from "./parseSpecSheet";
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
};

/**
 * Read one workbook → AI parse → canonicalize, returning the canonicalized
 * parse, the resolved alias pairs, and the reviewer-AI flags for that single
 * file. Throws on a hard failure (empty workbook, AI unavailable/forbidden).
 * Shared by the single- and multi-file prepare paths so they stay identical.
 */
async function parseWorkbookCore(
  grids: SheetGrid[],
  known: ReturnType<typeof loadSpecImportKnown>,
  aliases: SpecImportAlias[],
): Promise<ParseCore> {
  const workbookText = gridsToPromptText(grids);
  if (!workbookText.trim()) {
    throw new Error("That workbook looks empty — nothing to import.");
  }

  const ai = await requestParseSpecSheet({
    workbookText,
    known: {
      brands: known.brands,
      flavorsByBrand: known.flavorsByBrand,
      appTypes: known.appTypes,
      pepTypes: known.pepTypes,
      cheeseIngredients: known.cheeseIngredients,
      doughIngredients: known.doughIngredients,
      sauceIngredients: known.sauceIngredients,
      dieTypes: known.dieTypes,
    },
    aliases,
  });

  const { parsed, resolved } = canonicalizeParsed(
    { profiles: ai.profiles, recipes: ai.recipes, ...(ai.note ? { note: ai.note } : {}) },
    known,
    aliases,
  );

  // Reviewer-AI flags ride on the raw AI profiles/recipes (warn/reject only).
  const flagged: SpecFlaggedItem[] = [];
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

  return { parsed, resolved, flagged };
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
  const { parsed, resolved, flagged } = await parseWorkbookCore(grids, known, aliases);

  const summary = summarizeSpecImport(parsed, profileExistsForImport, recipeExistsForImport);
  const newAliases = collectSpecAliases(resolved);

  return { parsed, summary, newAliases, flagged, ...(parsed.note ? { note: parsed.note } : {}) };
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
): Promise<SpecImportPrepared> {
  const { known, aliases } = await loadSpecImportContext();

  const parsedList: ParsedSpecImport[] = [];
  const allResolved: ParseCore["resolved"] = [];
  const flagged: SpecFlaggedItem[] = [];
  const errors: string[] = [];

  let done = 0;
  for (const buf of buffers) {
    try {
      const grids = await readWorkbookGrids(buf);
      const core = await parseWorkbookCore(grids, known, aliases);
      parsedList.push(core.parsed);
      allResolved.push(...core.resolved);
      flagged.push(...core.flagged);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Could not read a file.");
    } finally {
      done += 1;
      onProgress?.(done, buffers.length);
    }
  }

  if (parsedList.length === 0) {
    throw new Error(errors[0] ?? "Nothing to import.");
  }

  const merged = mergeParsedSpecImports(parsedList);
  const summary = summarizeSpecImport(merged, profileExistsForImport, recipeExistsForImport);
  const newAliases = collectSpecAliases(allResolved);

  const noteParts: string[] = [];
  if (merged.note) noteParts.push(merged.note);
  if (errors.length) {
    noteParts.push(
      `${errors.length} file${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "was" : "were"} skipped.`,
    );
  }
  const note = noteParts.length ? noteParts.join("\n") : undefined;

  return { parsed: merged, summary, newAliases, flagged, ...(note ? { note } : {}) };
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
      await saveSpecSheet(buildSpecSheetLabel(prepared.parsed), prepared.parsed);
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
