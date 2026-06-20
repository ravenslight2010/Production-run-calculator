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
  summarizeSpecImport,
  type CanonicalResult,
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
    return out;
  });

  return { parsed: { profiles, recipes, ...(raw.note ? { note: raw.note } : {}) }, resolved };
}

/**
 * Full read → AI → canonicalize → summarize step. Throws on a hard failure
 * (e.g. unreadable workbook, AI unavailable/forbidden) so the UI can show why.
 */
export async function prepareSpecImport(data: ArrayBuffer): Promise<SpecImportPrepared> {
  const grids = await readWorkbookGrids(data);
  const workbookText = gridsToPromptText(grids);
  if (!workbookText.trim()) {
    throw new Error("That workbook looks empty — nothing to import.");
  }

  const known = loadSpecImportKnown();
  // Learned aliases are best-effort; proceed without them if the fetch fails.
  let aliases: SpecImportAlias[] = [];
  try {
    aliases = await fetchSpecImportAliases();
  } catch {
    aliases = [];
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

  const summary = summarizeSpecImport(parsed, profileExistsForImport, recipeExistsForImport);
  const newAliases = collectSpecAliases(resolved);

  // Reviewer-AI flags ride on the raw AI profiles/recipes (warn/reject only).
  const flagged: SpecFlaggedItem[] = [];
  for (const p of ai.profiles) {
    if (p.review && p.review.status !== "ok") {
      flagged.push({ label: `${p.brand} / ${p.flavor}`.trim(), review: p.review });
    }
  }
  for (const r of ai.recipes) {
    if (r.review && r.review.status !== "ok") {
      const ctx = r.brand ? ` — ${r.brand}${r.flavor ? `/${r.flavor}` : ""}` : "";
      flagged.push({ label: `${r.kind} recipe${ctx}`, review: r.review });
    }
  }

  return { parsed, summary, newAliases, flagged, ...(parsed.note ? { note: parsed.note } : {}) };
}

/** Apply a prepared import: write profiles + recipes, then persist new aliases. */
export async function commitSpecImport(prepared: SpecImportPrepared): Promise<void> {
  applySpecImport(prepared.parsed);
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
