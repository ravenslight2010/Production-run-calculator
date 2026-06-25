// Excel spec-sheet importer — mobile orchestration glue.
//
// Pipeline: read the .xlsx into a SheetGrid[] → flatten to compact prompt text →
// call the read-only AI parse endpoint → canonicalize the returned names against
// the app's known lists (learned aliases first, then exact, then confident
// fuzzy) → summarize new-vs-updated → on confirm, write profiles + recipe
// presets (overwrite existing, add new) and persist any newly learned aliases.
//
// All pure logic lives in @workspace/spec-import; storage writes live in
// RunContext.applySpecImport. This module only sequences them. Mirrors the web
// glue in artifacts/run-calculator/src/specImport.ts (replit.md parity). The
// platform difference is plumbing: web reads localStorage directly, mobile takes
// a SpecImportStore built from the RunContext value (known lists + existence
// checks + the apply writer), and reads the workbook from base64 (native) or an
// ArrayBuffer (web) instead of a File/Blob.

import * as XLSX from "xlsx";
import {
  applyNameMatches,
  canonicalize,
  collectSpecAliases,
  crossFillSpecImport,
  gridsToPromptText,
  mergeParsedSpecImports,
  recipeTargets,
  splitGridsForPrompt,
  summarizeSpecImport,
  type CanonicalResult,
  type NameMatch,
  type ParsedRecipe,
  type ParsedRecipeTarget,
  type ParsedSpecImport,
  type ScopedNameMatch,
  type SheetGrid,
  type SpecAliasKind,
  type SpecImportAlias,
  type SpecImportSummary,
} from "@workspace/spec-import";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  type Discrepancy,
  type ReconcileRecipe,
} from "@workspace/spec-reconcile";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";
import { saveSpecSheet, buildSpecSheetLabel } from "./savedSpecSheets";
import {
  requestParseSpecSheet,
  type SpecSheetKnown,
} from "./parseSpecSheet";
import { requestMatchImport } from "./matchImport";
import { saveAiCorrections } from "./aiCorrections";
import type { ReviewVerdict } from "@workspace/ai-review";

export type SpecFlaggedItem = { label: string; review: ReviewVerdict };

// Map a learned spec-import alias kind to a shared-corrections domain.
function aliasKindToDomain(kind: SpecAliasKind): string {
  if (kind === "brand") return "brand";
  if (kind === "flavor") return "flavor";
  if (kind === "appType" || kind === "pepType") return "item";
  // dough/sauce/cheese ingredient kinds
  return "ingredient";
}

/**
 * Everything this module needs from the RunContext, injected by the UI (mobile
 * has no module-level store). The web equivalent imports these directly from
 * storage.ts.
 */
export type SpecImportStore = {
  known: Required<SpecSheetKnown>;
  /** Current recipe library snapshot, for the deterministic reconcile diff. */
  currentRecipes: ReconcileRecipe[];
  profileExists: (brand: string, flavor: string) => boolean;
  recipeExists: (kind: ParsedRecipe["kind"], name: string) => boolean;
  apply: (parsed: ParsedSpecImport) => void;
};

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
  note?: string;
};

function gridsFromWorkbook(wb: XLSX.WorkBook): SheetGrid[] {
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
      rows: rows.map((r) =>
        Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : [],
      ),
    });
  }
  return grids;
}

/** Read an .xlsx ArrayBuffer (web file pick) into flat sheet grids. */
export function readWorkbookGridsFromArrayBuffer(data: ArrayBuffer): SheetGrid[] {
  return gridsFromWorkbook(XLSX.read(data, { type: "array" }));
}

/** Read a base64-encoded .xlsx (native file pick) into flat sheet grids. */
export function readWorkbookGridsFromBase64(b64: string): SheetGrid[] {
  return gridsFromWorkbook(XLSX.read(b64, { type: "base64" }));
}

function recipeKindToAliasKind(kind: "dough" | "sauce" | "cheese"): SpecAliasKind {
  if (kind === "dough") return "doughIngredient";
  if (kind === "sauce") return "sauceIngredient";
  return "cheeseIngredient";
}

function ingredientKnownForKind(
  kind: "dough" | "sauce" | "cheese",
  known: Required<SpecSheetKnown>,
): string[] {
  if (kind === "cheese") return known.cheeseIngredients;
  if (kind === "dough") return known.doughIngredients;
  return known.sauceIngredients; // sauce recipes ground against the frontline/sauce ingredient pool
}

/**
 * Canonicalize every name in the AI result against the app's known lists +
 * learned aliases, returning a clean ParsedSpecImport plus the alias pairs worth
 * remembering. Pure given its inputs. Mirrors the web canonicalizeParsed.
 */
function canonicalizeParsed(
  raw: ParsedSpecImport,
  known: Required<SpecSheetKnown>,
  aliases: SpecImportAlias[],
): {
  parsed: ParsedSpecImport;
  resolved: { kind: SpecAliasKind; result: CanonicalResult; context?: string | null }[];
} {
  const resolved: {
    kind: SpecAliasKind;
    result: CanonicalResult;
    context?: string | null;
  }[] = [];
  const track = (
    kind: SpecAliasKind,
    result: CanonicalResult,
    context: string | null = null,
  ) => {
    resolved.push({ kind, result, context });
    return result.value;
  };

  const profiles = raw.profiles.map((p) => {
    const brand = track("brand", canonicalize(p.brand, known.brands, aliases, "brand"));
    const knownFlavors = known.flavorsByBrand[brand] ?? [];
    const flavor = track(
      "flavor",
      canonicalize(p.flavor, knownFlavors, aliases, "flavor", brand),
      brand,
    );
    return {
      ...p,
      brand,
      flavor,
      applicators: p.applicators.map((a) => ({
        ...a,
        type: track("appType", canonicalize(a.type, known.appTypes, aliases, "appType")),
      })),
      pepperonis: p.pepperonis.map((pp) => ({
        ...pp,
        type: track("pepType", canonicalize(pp.type, known.pepTypes, aliases, "pepType")),
      })),
    };
  });

  const recipes = raw.recipes.map((r) => {
    const aliasKind = recipeKindToAliasKind(r.kind);
    const ingKnown = ingredientKnownForKind(r.kind, known);
    const out = {
      ...r,
      rows: r.rows.map((row) => ({
        ...row,
        ingredient: track(aliasKind, canonicalize(row.ingredient, ingKnown, aliases, aliasKind)),
      })),
    };
    if (r.brand) {
      out.brand = track("brand", canonicalize(r.brand, known.brands, aliases, "brand"));
      if (r.flavor) {
        const kf = known.flavorsByBrand[out.brand] ?? [];
        out.flavor = track(
          "flavor",
          canonicalize(r.flavor, kf, aliases, "flavor", out.brand),
          out.brand,
        );
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

  return {
    parsed: { profiles, recipes, ...(raw.note ? { note: raw.note } : {}) },
    resolved,
  };
}

type ParseCore = {
  parsed: ParsedSpecImport;
  resolved: ReturnType<typeof canonicalizeParsed>["resolved"];
  flagged: SpecFlaggedItem[];
  /** Rows dropped because the workbook was too large to chunk fully. */
  droppedRows: number;
};

/**
 * Read one workbook's grids → AI parse → canonicalize, returning the
 * canonicalized parse, resolved alias pairs, and reviewer-AI flags for that
 * single file. A workbook too large for one prompt is split into chunks and
 * parsed in several calls (full ingestion instead of silent truncation); the
 * per-chunk raw parses are merged before canonicalizing. Throws on a hard
 * failure (empty workbook, AI unavailable). Shared by the single- and
 * multi-file prepare paths so they stay identical. Mirrors web parseWorkbookCore.
 */
async function parseGridsCore(
  grids: SheetGrid[],
  store: SpecImportStore,
  aliases: SpecImportAlias[],
): Promise<ParseCore> {
  const { chunks, droppedRows } = splitGridsForPrompt(grids);
  if (!chunks.length) {
    throw new Error("That workbook looks empty — nothing to import.");
  }

  const rawList: ParsedSpecImport[] = [];
  const flagged: SpecFlaggedItem[] = [];
  for (const chunk of chunks) {
    const workbookText = gridsToPromptText(chunk);
    if (!workbookText.trim()) continue;
    const ai = await requestParseSpecSheet({ workbookText, known: store.known, aliases });
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
  const { parsed, resolved } = canonicalizeParsed(rawMerged, store.known, aliases);

  return { parsed, resolved, flagged, droppedRows };
}

/**
 * Second linking pass over a canonicalized parse: ask the AI matcher to fold any
 * brand/flavor that canonicalized as "new" onto an existing saved one (so we
 * update instead of duplicating), then conservatively cross-fill blank
 * dieType/sauceOzPerPizza from agreeing same-brand siblings. Fail-safe: any AI
 * error leaves the parse exactly as canonicalized. Mirrors web linkParsed.
 */
async function linkParsed(
  parsed: ParsedSpecImport,
  store: SpecImportStore,
): Promise<{ parsed: ParsedSpecImport; matchAliases: SpecImportAlias[] }> {
  let working = parsed;
  let matchAliases: SpecImportAlias[] = [];

  try {
    const known = store.known;
    const knownBrandSet = new Set(known.brands.map((b) => b.trim().toLowerCase()));
    // Brand candidates that canonicalized as new (not an existing saved brand).
    const brandCandidates = new Map<string, string>();
    const noteBrand = (b?: string) => {
      const t = (b ?? "").trim();
      if (t && !knownBrandSet.has(t.toLowerCase())) brandCandidates.set(t.toLowerCase(), t);
    };
    // Flavor candidates under an EXISTING brand whose flavor is not yet saved.
    const flavorCandidates = new Map<string, { brand: string; flavor: string }>();
    const noteFlavor = (brand?: string, flavor?: string) => {
      const b = (brand ?? "").trim();
      const f = (flavor ?? "").trim();
      if (!b || !f || !knownBrandSet.has(b.toLowerCase())) return;
      const knownFlavors = new Set((known.flavorsByBrand[b] ?? []).map((x) => x.trim().toLowerCase()));
      if (knownFlavors.has(f.toLowerCase())) return;
      flavorCandidates.set(`${b.toLowerCase()}\u0000${f.toLowerCase()}`, { brand: b, flavor: f });
    };

    for (const p of working.profiles) {
      noteBrand(p.brand);
      noteFlavor(p.brand, p.flavor);
    }
    for (const r of working.recipes) {
      noteBrand(r.brand);
      noteFlavor(r.brand, r.flavor);
      for (const t of r.targets ?? []) {
        noteBrand(t.brand);
        noteFlavor(t.brand, t.flavor);
      }
    }

    if (brandCandidates.size || flavorCandidates.size) {
      const result = await requestMatchImport({
        brands: known.brands,
        brandFlavors: known.flavorsByBrand,
        unmatchedBrands: [...brandCandidates.values()],
        unmatchedFlavors: [...flavorCandidates.values()],
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
      const applied = applyNameMatches(working, brandMatches, flavorMatches);
      working = applied.parsed;
      matchAliases = applied.aliases;
    }
  } catch {
    // Fail-safe: keep the canonicalized parse exactly as-is.
  }

  working = crossFillSpecImport(working).parsed;
  return { parsed: working, matchAliases };
}

/** Build the "what will change" diff of the incoming spec vs current recipes. */
function buildDiscrepancies(parsed: ParsedSpecImport, store: SpecImportStore): Discrepancy[] {
  try {
    return reconcileSpecWithRecipes({
      specRecipes: toReconcileRecipes(parsed.recipes),
      currentRecipes: store.currentRecipes,
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

/** Learned aliases are best-effort; proceed without them if the fetch fails. */
async function loadSpecImportAliases(): Promise<SpecImportAlias[]> {
  try {
    return await fetchSpecImportAliases();
  } catch {
    return [];
  }
}

/**
 * Full read → AI → canonicalize → summarize step. Throws on a hard failure
 * (e.g. empty workbook, AI unavailable/forbidden) so the UI can show why.
 */
export async function prepareSpecImport(
  grids: SheetGrid[],
  store: SpecImportStore,
): Promise<SpecImportPrepared> {
  const aliases = await loadSpecImportAliases();
  const { parsed: rawParsed, resolved, flagged, droppedRows } = await parseGridsCore(
    grids,
    store,
    aliases,
  );

  // Fold "new" names onto existing saved ones (no dupes) + conservative cross-fill.
  const { parsed, matchAliases } = await linkParsed(rawParsed, store);

  const summary = summarizeSpecImport(parsed, store.profileExists, store.recipeExists);
  const newAliases = [...collectSpecAliases(resolved), ...matchAliases];
  const discrepancies = buildDiscrepancies(parsed, store);
  const note = appendDroppedNote(parsed.note, droppedRows);

  return { parsed, summary, newAliases, flagged, discrepancies, ...(note ? { note } : {}) };
}

/** Hard cap on files per import so one batch can't fan out into a flood of AI calls. */
export const MAX_SPEC_IMPORT_FILES = 10;

/**
 * Multi-file variant: parse several workbooks in ONE import. Each file is its
 * own AI call (run sequentially to respect the endpoint's cost/rate guards),
 * then the per-file parses are merged into a single review (profiles deduped by
 * brand+flavor, recipes by kind+name, later files winning). Files that fail to
 * read are skipped and surfaced as a note; it only throws if EVERY file failed.
 * Mirrors web prepareSpecImportMulti (replit.md parity).
 */
export async function prepareSpecImportMulti(
  gridsList: SheetGrid[][],
  store: SpecImportStore,
  onProgress?: (done: number, total: number) => void,
): Promise<SpecImportPrepared> {
  const aliases = await loadSpecImportAliases();

  const parsedList: ParsedSpecImport[] = [];
  const allResolved: ParseCore["resolved"] = [];
  const flagged: SpecFlaggedItem[] = [];
  const errors: string[] = [];
  let totalDropped = 0;

  let done = 0;
  for (const grids of gridsList) {
    try {
      const core = await parseGridsCore(grids, store, aliases);
      parsedList.push(core.parsed);
      allResolved.push(...core.resolved);
      flagged.push(...core.flagged);
      totalDropped += core.droppedRows;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Could not read a file.");
    } finally {
      done += 1;
      onProgress?.(done, gridsList.length);
    }
  }

  if (parsedList.length === 0) {
    throw new Error(errors[0] ?? "Nothing to import.");
  }

  const merged = mergeParsedSpecImports(parsedList);
  // Fold "new" names onto existing saved ones (no dupes) + conservative cross-fill.
  const { parsed, matchAliases } = await linkParsed(merged, store);

  const summary = summarizeSpecImport(parsed, store.profileExists, store.recipeExists);
  const newAliases = [...collectSpecAliases(allResolved), ...matchAliases];
  const discrepancies = buildDiscrepancies(parsed, store);

  const noteParts: string[] = [];
  if (parsed.note) noteParts.push(parsed.note);
  if (errors.length) {
    noteParts.push(
      `${errors.length} file${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "was" : "were"} skipped.`,
    );
  }
  const note = appendDroppedNote(noteParts.length ? noteParts.join("\n") : undefined, totalDropped);

  return { parsed, summary, newAliases, flagged, discrepancies, ...(note ? { note } : {}) };
}

/** Apply a prepared import: write profiles + recipes, then persist new aliases. */
export async function commitSpecImport(
  prepared: SpecImportPrepared,
  store: SpecImportStore,
): Promise<void> {
  store.apply(prepared.parsed);

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
