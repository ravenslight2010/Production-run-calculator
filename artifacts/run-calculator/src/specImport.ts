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
  blendLinkSuggestionKey,
  canonicalize,
  collectMatchCandidates,
  collectSpecAliases,
  collectSpecImportMixes,
  collectSpecImportCheeseRecipes,
  applySpecImportBlendNameAliases,
  canonicalizeSpecImportCheeseRecipeNames,
  canonicalizeSpecImportNamedRecipeNames,
  cleanSpecCheeseRecipeName,
  dedupeSpecImportCheeseRecipes,
  sanitizeSpecAliases,
  pickAlias,
  linkSpecImportCheeseToExisting,
  linkSpecImportNamedRecipesToExisting,
  linkSpecImportDieTypesToExisting,
  crossFillSpecImport,
  fillSpecCheeseTargetsFromProfiles,
  findOverflowColumnRows,
  findTruncatedCells,
  extractEmbeddedApplicatorBlends,
  formatOverflowColumnsNote,
  formatTruncatedCellsNote,
  gridSanityIssue,
  gridsToPromptText,
  mergeParsedSpecImports,
  mergePruneSnapshots,
  partitionTombstonedParse,
  pruneSpecImportAgainstSnapshot,
  recipeLinkSuggestionKey,
  recipeTargets,
  resolveRetriedParsePass,
  shouldRetryParsePass,
  specImportNameMatchKey,
  specImportNamedRecipeNamesEqual,
  findSpecImportDoughFamilyMatch,
  splitGridsForPrompt,
  summarizeSpecImport,
  updateRecipePoolComponents,
  type CanonicalResult,
  type ExtraNameMatches,
  type NameMatch,
  type ParsedProfile,
  type ParsedRecipeTarget,
  type ParsedSpecImport,
  type ScopedNameMatch,
  type SheetGrid,
  type SpecAliasKind,
  type SpecImportAlias,
  type SpecImportSkipped,
  type SpecImportSummary,
  type SpecMatchKnown,
  type OverflowColumnRow,
  type TruncatedCell,
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
  isNameDeleted,
  flavorNamespace,
  type SpecImportRecipePlaceholder,
  type SpecImportServerPoolRecipe,
} from "./storage";
import { fetchSpecImportAliases, saveSpecImportAliases } from "./specImportAliases";
import {
  saveSpecSheet,
  fetchSavedSpecSheets,
  buildSpecSheetLabel,
  deriveSourceKey,
  selectPruneSnapshots,
  selectReusableSnapshot,
  type SavedSpecSheet,
  loadCurrentReconcileRecipes,
} from "./savedSpecSheets";
import { requestParseSpecSheet } from "./parseSpecSheet";
import { requestMatchImport } from "./matchImport";
import { saveAiCorrections } from "./aiCorrections";
import { fetchMixes, saveMixes } from "./mixes";
import { fetchCheeseRecipes, saveCheeseRecipes } from "./cheeseRecipes";
import { fetchNamedRecipes, saveNamedRecipes, addNamedRecipesToServerIfAbsent } from "./namedRecipes";
import { namedRecipeFromDraft, type NamedRecipe as PoolNamedRecipe } from "@workspace/named-recipes";
import { specMixDraftToMix } from "@workspace/premix-import";
import { addSpecMixesIfAbsent, fillSpecMixTags, type Mix } from "@workspace/mixes";
import {
  specCheeseDraftToRecipe,
  addCheeseRecipesIfAbsentByName,
  applyCheeseOzPerPizza,
  fillCheeseRecipeTags,
  type CheeseRecipe,
} from "@workspace/cheese-recipes";
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
  /**
   * SHA-256 content fingerprint of the uploaded file bytes (per-file hashes
   * sorted + re-hashed for multi-file imports). Saved with the snapshot so a
   * later re-import of the EXACT same file reuses the stored parse instead of
   * re-running the AI (whose read of the same sheet can drift between calls).
   */
  sourceHash?: string;
  /**
   * Previously learned "use existing recipe" picks (sheet blend/mix name →
   * existing saved recipe name, lower-cased key). The review dialog uses these
   * to PRE-SELECT the "Use existing" picker for cheese/mix recipes so a
   * re-import of a known sheet recommends linking instead of "create new".
   * Advisory only — the user can still clear or change the pick.
   */
  aliasLinkSuggestions?: Record<string, string>;
  note?: string;
};

/**
 * Build the review's link suggestions from the saved learned aliases. Cheese
 * blend / mix name links are stored under the "appType" kind (the applicator /
 * blend-name namespace) — the same pool the user's confirmed "Use existing"
 * picks are written back to on Apply.
 */
export function buildAliasLinkSuggestions(aliases: SpecImportAlias[]): Record<string, string> {
  const out: Record<string, string> = {};
  // Sanitize FIRST: poisoned rows (generic "Mix"/"cheese" names, digit
  // mismatches, cycles) must never become pre-selected "Use existing" picks —
  // a generic-name suggestion links every blend to one garbage pool record
  // AND gets re-learned on Apply, making the poison self-perpetuating.
  for (const a of sanitizeSpecAliases(aliases)) {
    const canon = a.canonicalName.trim();
    if (a.kind === "appType") {
      const ext = a.externalName.trim().toLowerCase();
      if (!ext || !canon || ext === canon.toLowerCase()) continue;
      const brandCtx = (a.context ?? "").trim();
      // Brand-scoped rows (saved alongside the context-free row since picks
      // became brand-aware) go under a brand-scoped key so two brands using
      // the same generic blend name each keep their OWN remembered pick;
      // context-free rows keep the legacy plain-name key (the cross-brand
      // fallback).
      if (brandCtx) out[blendLinkSuggestionKey(brandCtx, ext)] = canon;
      else out[ext] = canon;
    } else if (a.kind === "recipeName") {
      // Dough/sauce "use existing" picks, scoped by kind via context so a
      // dough link never pre-selects on a sauce row (or vice versa).
      const ext = a.externalName.trim();
      const kindCtx = (a.context ?? "").trim();
      if (!ext || !canon || !kindCtx) continue;
      if (ext.toLowerCase() === canon.toLowerCase()) continue;
      out[recipeLinkSuggestionKey(kindCtx, ext)] = canon;
    }
  }
  return out;
}

// Map a learned spec-import alias kind to a shared-corrections domain.
function aliasKindToDomain(kind: SpecAliasKind): string {
  if (kind === "brand") return "brand";
  if (kind === "flavor") return "flavor";
  if (kind === "appType" || kind === "pepType" || kind === "recipeName") return "item";
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

  // Applicator slots whose grid cell names a cheese/mix RECIPE parsed from this
  // same sheet must keep the sheet's blend name VERBATIM: applySpecImport's
  // slot resolvers (resolveCheeseApplicatorSlots / resolveMixApplicatorSlots)
  // re-type those slots to the generic "cheese"/"Mix" card by loose-matching the
  // applicator type against the import's recipe names. Letting an appType alias
  // (the blend-name namespace — learned from "Use existing recipe" picks) or a
  // fuzzy appType match rename the type here silently disconnects the slot from
  // its recipe (e.g. the user declines the suggested link and creates new), and
  // the blend leaks into the raw applicator Type dropdown instead of the
  // cheese/mix slot. Link decisions are the review dialog's job, never a
  // prepare-time rename.
  const blendTypeKeys = new Set<string>();
  for (const r of raw.recipes) {
    if (r.kind !== "cheese") continue;
    const key = specImportNameMatchKey(cleanSpecCheeseRecipeName(r.name ?? ""));
    if (key) blendTypeKeys.add(key);
  }
  const isBlendNamedType = (type: string): boolean => {
    const key = specImportNameMatchKey(cleanSpecCheeseRecipeName(type));
    return !!key && blendTypeKeys.has(key);
  };

  // Profile-level dough/sauce TYPE assignments honor learned "recipeName"
  // aliases (the user's prior review-time renames / "use existing" picks for
  // dough & sauce recipes) so a re-import applies the user's reassignment
  // instead of resurrecting the raw sheet name — even when the recipe itself
  // isn't in this sheet. Alias-only on purpose: exact/fuzzy snapping to the
  // saved pools is the link pass's job (it has stronger near-dup guards).
  const usableAliases = sanitizeSpecAliases(aliases);
  const aliasNamedRecipe = (
    nm: string | undefined,
    kindCtx: "dough" | "sauce",
  ): string | undefined => {
    const raw = (nm ?? "").trim();
    if (!raw) return undefined;
    return pickAlias(usableAliases, "recipeName", raw, kindCtx) ?? undefined;
  };

  const profiles = raw.profiles.map(p => {
    const brand = track("brand", canonicalize(p.brand, known.brands, aliases, "brand"));
    const knownFlavors = known.flavorsByBrand[brand] ?? [];
    const flavor = track("flavor", canonicalize(p.flavor, knownFlavors, aliases, "flavor", brand), brand);
    const doughAlias = aliasNamedRecipe(p.doughName, "dough");
    const sauceAlias = aliasNamedRecipe(p.sauceName, "sauce");
    return {
      ...p,
      brand,
      flavor,
      ...(doughAlias ? { doughName: doughAlias } : {}),
      ...(sauceAlias ? { sauceName: sauceAlias } : {}),
      applicators: p.applicators.map(a =>
        isBlendNamedType(a.type ?? "")
          ? { ...a }
          : {
              ...a,
              type: track("appType", canonicalize(a.type, known.appTypes, aliases, "appType")),
            },
      ),
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

  // Canonicalize grounding-warning brand/flavor the same way (WITHOUT alias
  // tracking — warnings aren't new names to learn) so each warning still keys to
  // its profile row after canonicalization renames.
  const warnings = (raw.warnings ?? []).map(w => {
    const brand = canonicalize(w.brand, known.brands, aliases, "brand").value;
    const kf = known.flavorsByBrand[brand] ?? [];
    const flavor = canonicalize(w.flavor, kf, aliases, "flavor", brand).value;
    return { ...w, brand, flavor };
  });

  return {
    parsed: {
      profiles,
      recipes,
      ...(raw.note ? { note: raw.note } : {}),
      ...(warnings.length ? { warnings } : {}),
    },
    resolved,
  };
}

type ParseCore = {
  parsed: ParsedSpecImport;
  resolved: ReturnType<typeof canonicalizeParsed>["resolved"];
  flagged: SpecFlaggedItem[];
  /** Rows dropped because the workbook was too large to chunk fully. */
  droppedRows: number;
  /** Cells whose tails were cut by the per-cell prompt clamp (AI never saw them). */
  truncatedCells: TruncatedCell[];
  /** Rows with non-empty cells past the column cap (dropped entirely, AI never saw them). */
  overflowRows: OverflowColumnRow[];
};

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
  // Cheap pre-AI guard: the xlsx reader does NOT throw on garbage bytes (a
  // renamed PDF/image "reads" as one junk sheet), so reject empty or
  // binary-junk grids BEFORE burning an AI parse call. In the multi-file path
  // this throw becomes the per-file "could not be read … skipped" note.
  const sanity = gridSanityIssue(grids);
  if (sanity) {
    throw new Error(sanity);
  }
  const { chunks, droppedRows } = splitGridsForPrompt(grids);
  if (!chunks.length) {
    throw new Error("That workbook looks empty — nothing to import.");
  }
  // Cells longer than the per-cell prompt clamp lose their tails before the AI
  // reads them — detect these up front so the review can warn the user.
  const truncatedCells = findTruncatedCells(grids);
  // Sibling silent-loss path: rows wider than the column cap lose those extra
  // cells ENTIRELY (not just their tails) — warn about those too.
  const overflowRows = findOverflowColumnRows(grids);

  const knownInput = {
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    appTypes: known.appTypes,
    pepTypes: known.pepTypes,
    cheeseIngredients: known.cheeseIngredients,
    doughIngredients: known.doughIngredients,
    sauceIngredients: known.sauceIngredients,
    sauceNames: known.sauceNames,
    dieTypes: known.dieTypes,
    doughRecipes: known.doughRecipes,
    sauceRecipes: known.sauceRecipes,
    cheeseRecipes: known.cheeseRecipes,
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
    if (shouldRetryParsePass(ai, workbookText)) {
      try {
        const retry = await requestParseSpecSheet({ workbookText, known: knownInput, aliases });
        ai = resolveRetriedParsePass(ai, retry);
      } catch {
        // Keep the original result (empty + note) — the note still surfaces.
      }
    }
    rawList.push({
      profiles: ai.profiles,
      recipes: ai.recipes,
      ...(ai.note ? { note: ai.note } : {}),
      ...(ai.warnings?.length ? { warnings: ai.warnings } : {}),
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

  // Deterministic safety net over the MERGED workbook: unpack any blend
  // composition the AI left embedded in an applicator cell (clean name → type,
  // number+ingredient pairs → ONE cheese recipe). Must run post-merge, never
  // per chunk — see extractEmbeddedApplicatorBlends.
  const rawMerged = extractEmbeddedApplicatorBlends(
    // Chunks of ONE workbook: union same-profile applicator/pepperoni lists —
    // a chunk boundary can split a product's spec block, so the chunks'
    // lists are complementary; the default wholesale replace would silently
    // drop the earlier chunk's applicator weights.
    rawList.length === 1 ? rawList[0] : mergeParsedSpecImports(rawList, { profileSlots: "union" }),
  );
  const { parsed, resolved } = canonicalizeParsed(rawMerged, known, aliases);

  return { parsed, resolved, flagged, droppedRows, truncatedCells, overflowRows };
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

  // One automatic retry for a failed match request, mirroring the parse-chunk
  // retry: a transient hiccup (network blip, 429/502) would otherwise silently
  // no-op the WHOLE match pass and the import would duplicate brands/flavors
  // instead of updating existing ones. linkParsed makes at most 2 match calls,
  // so with one retry each we stay well under the server's 10/min rate limit.
  // If the retry throws too, the error propagates to the outer catch and the
  // pass stays fail-safe (canonicalized parse kept as-is).
  const requestMatchImportWithRetry = async (
    input: Parameters<typeof requestMatchImport>[0],
  ): Promise<Awaited<ReturnType<typeof requestMatchImport>>> => {
    try {
      return await requestMatchImport(input);
    } catch {
      return await requestMatchImport(input);
    }
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
      const result = await requestMatchImportWithRetry({
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
        const r2 = await requestMatchImportWithRetry({
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
  // Deterministic backstop to the AI match pass above: snap imported die types
  // and dough/sauce recipe names onto the factory's EXISTING lists by a loose
  // key (case/punctuation/spacing) so an import links to what the user already
  // has instead of creating a disconnected duplicate. Mirrors mobile (parity).
  working = linkSpecImportDieTypesToExisting(working, known.dieTypes ?? []);
  // Strip spec-sheet packaging noise off dough/sauce names — "(made in house)"
  // qualifiers and "Parbake crust (… Dies)" wrapping — BEFORE the link pass so
  // the cleaned generic name is what snaps onto the existing pool. Recipes and
  // the profiles referencing them are renamed in lockstep.
  working = canonicalizeSpecImportNamedRecipeNames(working);
  // Dough matches against local presets UNIONED with the server pool: dough is
  // server-backed master data now, and the base family recipe ("CRB Dough")
  // the variant names must collapse onto may exist only in the pool.
  let doughUniverse = known.doughRecipes ?? [];
  try {
    const pool = await fetchNamedRecipes("dough");
    doughUniverse = [...new Set([...doughUniverse, ...pool.map((r) => r.name)])];
  } catch {
    // Best-effort (offline) — local names still match.
  }
  working = linkSpecImportNamedRecipesToExisting(working, "dough", doughUniverse);
  // Sauce matches against the server pool too — the family recipe ("Lucia
  // Pizza Sauce") a variant reference ("Lucia's Sauce") must snap onto may
  // exist only in the pool, not in the local preset list.
  let sauceUniverse = known.sauceRecipes ?? [];
  try {
    const pool = await fetchNamedRecipes("sauce");
    sauceUniverse = [...new Set([...sauceUniverse, ...pool.map((r) => r.name)])];
  } catch {
    // Best-effort (offline) — local names still match.
  }
  working = linkSpecImportNamedRecipesToExisting(working, "sauce", sauceUniverse);
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

/** Append the shortened-cells advisory to a parse note when some workbook cells
 * were longer than the per-cell prompt clamp (their tails never reached the AI). */
function appendTruncatedNote(
  note: string | undefined,
  truncatedCells: ReadonlyArray<TruncatedCell>,
): string | undefined {
  const msg = formatTruncatedCellsNote(truncatedCells);
  if (!msg) return note;
  return note ? `${note}\n${msg}` : msg;
}

/** Append the dropped-columns advisory to a parse note when some rows had
 * non-empty cells past the column cap — those cells never reached the AI. */
function appendOverflowNote(
  note: string | undefined,
  overflowRows: ReadonlyArray<OverflowColumnRow>,
): string | undefined {
  const msg = formatOverflowColumnsNote(overflowRows);
  if (!msg) return note;
  return note ? `${note}\n${msg}` : msg;
}

/** SHA-256 hex of one buffer via WebCrypto (throws when unavailable). */
async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto unavailable");
  // Copy into a fresh Uint8Array so TS sees a plain ArrayBuffer-backed view.
  const view = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes);
  const digest = await subtle.digest("SHA-256", view);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Parse-pipeline version mixed into the source fingerprint. Bump this whenever
 * the AI parse prompt or the parse/merge pipeline changes in a way that should
 * produce a BETTER read of the same bytes: old snapshots' hashes stop matching,
 * so a re-import of an unchanged file re-runs the (improved) AI parse instead
 * of resurrecting a stale parse made by the old pipeline. Without this, hash
 * reuse pins users to whatever the parser produced when the file was first
 * imported — prompt fixes silently never take effect on re-imports.
 * v2: duplicate-applicator prompt hardening (per-station entries, tolerance
 * values never emitted as a second applicator).
 * v3: dough sheets now parse "doughballs per tray" (doughballsPerTray).
 * v4: applicator station slots are now mandatory whenever a profile has pep
 * rows (before pep = 1/2, after pep = 3/4 in listed order).
 * v5: deleted brands/flavors are excluded from the match universe and stale
 * aliases targeting deleted names are ignored — saved v4 parses have renamed
 * sheets' flavors grounded onto deleted old names baked in, so they must not
 * be reused.
 * v7: cheese-kind recipe rows are exempt from the oz→lbs conversion (their
 * lbs field carries per-pizza OUNCES by contract) — v6 parses baked in ÷16'd
 * mix/cheese amounts, so they must not be reused.
 * v8: parse prompt now calls out parenthesized crust-row dough names
 * ("Parbake Crust (CRB Recipe - 12\" Dies)") — v7 parses omitted `doughName`
 * on such sheets, leaving profiles with no dough selected.
 */
export const SPEC_PARSE_VERSION = "8";

/**
 * Content fingerprint for an import's uploaded file bytes: the per-file
 * SHA-256 hashes are SORTED (order-independent, matching deriveSourceKey's
 * sorted filename join), joined with the parse-pipeline version salt, then
 * re-hashed into one digest. Returns undefined when hashing isn't possible —
 * callers then simply skip parse reuse (fail-safe, never block an import).
 */
export async function hashSpecImportSource(
  buffers: ReadonlyArray<ArrayBuffer>,
): Promise<string | undefined> {
  try {
    if (!buffers.length) return undefined;
    const hashes: string[] = [];
    for (const b of buffers) hashes.push(await sha256Hex(b));
    hashes.sort();
    return await sha256Hex(
      new TextEncoder().encode(`v${SPEC_PARSE_VERSION}|${hashes.join("|")}`),
    );
  } catch {
    return undefined;
  }
}

/**
 * Look for a saved snapshot whose parse can be reused for this import: the
 * EXACT same file set (identical sourceKey) with identical bytes (matching
 * sourceHash). Reusing the stored parse instead of re-running the AI keeps a
 * re-import of an unchanged file byte-for-byte identical to the previous
 * import — the AI's read of the same sheet can drift between calls (values
 * swapping between rows, a weight misread), and the re-import prune would
 * treat that drift as real spec changes and clobber the user's data with it.
 * Best-effort: any failure returns just the hash so the normal AI parse runs.
 */
async function findReusableParse(
  names: ReadonlyArray<string>,
  buffers: ReadonlyArray<ArrayBuffer>,
): Promise<{ sourceHash?: string; snapshot?: SavedSpecSheet }> {
  const sourceHash = await hashSpecImportSource(buffers);
  if (!sourceHash) return {};
  const sourceKey = deriveSourceKey(names);
  if (!sourceKey) return { sourceHash };
  try {
    const sheets = await fetchSavedSpecSheets();
    const snapshot = selectReusableSnapshot(sheets, sourceKey, sourceHash);
    if (
      snapshot?.data &&
      ((snapshot.data.profiles?.length ?? 0) > 0 || (snapshot.data.recipes?.length ?? 0) > 0)
    ) {
      return { sourceHash, snapshot };
    }
  } catch {
    // Best-effort — fall back to a fresh AI parse.
  }
  return { sourceHash };
}

/**
 * Build the prepared review from a reused snapshot parse: same post-parse
 * hygiene as a fresh parse (current tombstones still respected, cheese-name
 * canonicalize + dedupe, summary/discrepancies against CURRENT data) minus the
 * AI passes — the snapshot data was already canonicalized and linked when it
 * was first imported. newAliases/flagged stay empty: nothing new was learned
 * and any reviewer flags were already surfaced on the original import.
 */
function buildReusedPrepared(
  snapshotData: ParsedSpecImport,
  known: ReturnType<typeof loadSpecImportKnown>,
  aliases: SpecImportAlias[],
  sourceHash: string | undefined,
): SpecImportPrepared {
  const { kept, skipped } = partitionTombstonedParse(
    snapshotData,
    importProfileIsTombstoned,
    recipeNameIsTombstoned,
  );
  const parsed = dedupeSpecImportCheeseRecipes(
    applySpecImportBlendNameAliases(
      canonicalizeSpecImportCheeseRecipeNames(
        canonicalizeSpecImportNamedRecipeNames(kept),
      ),
      aliases,
    ),
  );
  const summary = summarizeSpecImport(parsed, profileExistsForImport, recipeExistsForImport);
  const discrepancies = buildDiscrepancies(parsed);
  const reuseNote =
    "This exact file was imported before — reused the earlier read (no new AI parse), so unchanged values stay identical to the previous import.";
  const note = parsed.note ? `${parsed.note}\n${reuseNote}` : reuseNote;
  return {
    parsed,
    summary,
    newAliases: [],
    flagged: [],
    discrepancies,
    skipped,
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    aliasLinkSuggestions: buildAliasLinkSuggestions(aliases),
    ...(sourceHash ? { sourceHash } : {}),
    note,
  };
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
  // Drop aliases whose canonical target the user has since DELETED. Aliases
  // outrank exact/fuzzy matching, so a stale learned rename (e.g.
  // "HOUSE DLUX" → deleted "House Special") would silently pull a renamed
  // sheet's flavor back onto a tombstoned name the user can no longer see.
  aliases = aliases.filter((a) => {
    if (a.kind === "brand") return !isNameDeleted("brands", a.canonicalName);
    if (a.kind === "flavor") {
      const brand = (a.context ?? "").trim();
      if (!brand) return true;
      if (isNameDeleted("brands", brand)) return false;
      return !isNameDeleted(flavorNamespace(brand), a.canonicalName);
    }
    return true;
  });
  return { known, aliases };
}

/**
 * Full read → AI → canonicalize → summarize step. Throws on a hard failure
 * (e.g. unreadable workbook, AI unavailable/forbidden) so the UI can show why.
 */
export async function prepareSpecImport(
  data: ArrayBuffer,
  name?: string,
): Promise<SpecImportPrepared> {
  const { known, aliases } = await loadSpecImportContext();

  // Exact re-import of an unchanged file: reuse the previous import's stored
  // parse instead of asking the AI to re-read it (AI re-reads of the same
  // sheet can drift, and the prune would apply that drift as "changes").
  const { sourceHash, snapshot } = await findReusableParse(name ? [name] : [], [data]);
  if (snapshot) {
    return buildReusedPrepared(snapshot.data, known, aliases, sourceHash);
  }

  const grids = await readWorkbookGrids(data);
  const { parsed: rawParsed, resolved, flagged, droppedRows, truncatedCells, overflowRows } =
    await parseWorkbookCore(grids, known, aliases);

  // Fold "new" names onto existing saved ones (no dupes) + conservative cross-fill.
  const { parsed: linked, matchAliases } = await linkParsed(rawParsed, known);

  // Respect the user's prior merges/deletions: an import must not resurrect a
  // brand/flavor or recipe name they tombstoned. Skipped items are surfaced (not
  // silently dropped) so they can be knowingly re-included in review.
  const { kept, skipped } = partitionTombstonedParse(
    linked,
    importProfileIsTombstoned,
    recipeNameIsTombstoned,
  );

  // Collapse per-weight cheese-blend name variants and merge the resulting
  // duplicate cheese recipes into one (unioning their profile targets) so the
  // review shows a single "Aldo's Cheese Mix" attaching to every flavor instead
  // of one numbered recipe per applicator weight. Learned blend-name aliases
  // (prior review links/renames) are then applied to recipe + slots in
  // lockstep so a re-import remembers the user's reassignment. Mirrors mobile
  // (parity paused — web only for now).
  const parsed = dedupeSpecImportCheeseRecipes(
    applySpecImportBlendNameAliases(
      canonicalizeSpecImportCheeseRecipeNames(kept),
      aliases,
    ),
  );

  const summary = summarizeSpecImport(parsed, profileExistsForImport, recipeExistsForImport);
  const newAliases = [...collectSpecAliases(resolved), ...matchAliases];
  const discrepancies = buildDiscrepancies(parsed);
  const note = appendOverflowNote(
    appendTruncatedNote(appendDroppedNote(parsed.note, droppedRows), truncatedCells),
    overflowRows,
  );

  return {
    parsed,
    summary,
    newAliases,
    flagged,
    discrepancies,
    skipped,
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    aliasLinkSuggestions: buildAliasLinkSuggestions(aliases),
    ...(sourceHash ? { sourceHash } : {}),
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

  // Exact re-import of the SAME unchanged file set: reuse the stored parse
  // (see prepareSpecImport). Must run before the parse loop — it releases the
  // buffers as it goes, and the hash needs the original bytes.
  const { sourceHash, snapshot } = await findReusableParse(names ?? [], buffers);
  if (snapshot) {
    onProgress?.(buffers.length, buffers.length);
    return buildReusedPrepared(snapshot.data, known, aliases, sourceHash);
  }

  const parsedList: ParsedSpecImport[] = [];
  const allResolved: ParseCore["resolved"] = [];
  const flagged: SpecFlaggedItem[] = [];
  const errors: string[] = [];
  const failedNames: string[] = [];
  let totalDropped = 0;
  const allTruncated: TruncatedCell[] = [];
  const allOverflow: OverflowColumnRow[] = [];

  for (let i = 0; i < buffers.length; i++) {
    // Name each file so a failure can say WHICH file was skipped (fall back to a
    // positional label when the caller didn't pass filenames).
    const label = names?.[i]?.trim() || `File ${i + 1}`;
    try {
      // Yield to the event loop between files: workbook parsing is synchronous
      // and CPU-heavy, and back-to-back parses on a big batch can freeze the
      // tab long enough for the browser to kill the page mid-import.
      await new Promise((r) => setTimeout(r, 0));
      const grids = await readWorkbookGrids(buffers[i]);
      const core = await parseWorkbookCore(grids, known, aliases);
      parsedList.push(core.parsed);
      allResolved.push(...core.resolved);
      flagged.push(...core.flagged);
      totalDropped += core.droppedRows;
      // Prefix the sheet label with the file so a multi-file review says WHICH
      // workbook holds the shortened cell.
      allTruncated.push(...core.truncatedCells.map((t) => ({ ...t, sheet: `${label} ${t.sheet}` })));
      allOverflow.push(...core.overflowRows.map((o) => ({ ...o, sheet: `${label} ${o.sheet}` })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not be read";
      failedNames.push(label);
      errors.push(`${label}: ${msg}`);
    } finally {
      // Release the raw file bytes (parsed or failed) so a 10-file batch
      // doesn't hold every workbook in memory for the whole import.
      buffers[i] = new ArrayBuffer(0);
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
  const { kept, skipped } = partitionTombstonedParse(
    linked,
    importProfileIsTombstoned,
    recipeNameIsTombstoned,
  );

  // Collapse per-weight cheese-blend name variants + merge duplicate cheese
  // recipes into one (union targets) so review shows a single "Aldo's Cheese Mix"
  // attaching to every flavor, not one per applicator weight. Learned
  // blend-name aliases then apply to recipe + slots in lockstep (remembered
  // reassignments). Mirrors mobile.
  const parsed = dedupeSpecImportCheeseRecipes(
    applySpecImportBlendNameAliases(
      canonicalizeSpecImportCheeseRecipeNames(kept),
      aliases,
    ),
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
  const note = appendOverflowNote(
    appendTruncatedNote(
      appendDroppedNote(noteParts.length ? noteParts.join("\n") : undefined, totalDropped),
      allTruncated,
    ),
    allOverflow,
  );

  return {
    parsed,
    summary,
    newAliases,
    flagged,
    discrepancies,
    skipped,
    brands: known.brands,
    flavorsByBrand: known.flavorsByBrand,
    aliasLinkSuggestions: buildAliasLinkSuggestions(aliases),
    ...(sourceHash ? { sourceHash } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * Apply a prepared import: write profiles + recipes, persist new aliases, and
 * add any mixes detected in the sheet to the factory-wide Mixes list. Returns
 * how many new mixes were added so the UI can refresh the Mixes screen.
 */
export async function commitSpecImport(
  prepared: SpecImportPrepared,
): Promise<{
  mixesAdded: number;
  cheeseRecipesAdded: number;
  /**
   * Existing server-pool cheese recipes whose components' PER-PIZZA OUNCE
   * column was refreshed from this sheet (matched by name). Batch pounds are
   * never touched — spec sheets carry per-pizza ounces only.
   */
  cheeseOzUpdated: number;
  /**
   * Saved server-pool recipes (dough / sauce) whose ingredient rows were
   * REPLACED with this sheet's, because the user linked the parsed recipe
   * to them AND checked "update it with this sheet" in the review.
   */
  recipesUpdated: number;
  /**
   * Empty-components dough/sauce placeholder recipes added to the server pool
   * for profile-named recipes with no backing recipe anywhere (so the name is
   * visible under Manage Lists → Dough/Sauce Recipes).
   */
  placeholderRecipesAdded: number;
  /** Brand+flavor profiles this import wrote — see applySpecImport. */
  touchedProfiles: Array<{ brand: string; flavor: string }>;
}> {
  // Collapse per-weight cheese-blend name variants ("Aldo's Cheese Mix 2.07" /
  // "…1.75") to one clean name up front, so the profile applicator fields and the
  // server cheese pool both link to a single recipe (the per-pizza weight lives
  // on app{n}OzPerPizza, not in the recipe name). Mirrors mobile (replit.md parity).
  prepared.parsed = canonicalizeSpecImportCheeseRecipeNames(prepared.parsed);

  // Snap imported cheese blends onto the EXISTING server Cheese Recipes pool by
  // name (loose match on case/punctuation/spacing) BEFORE apply, so a flavor's
  // applicator links to the recipe the user already saved instead of a
  // disconnected copy the pick-only Cheese card can't resolve. Best-effort: if
  // the pool can't be fetched, apply the imported names as-is. Mirrors mobile
  // (replit.md parity).
  let existingCheeseForLink: CheeseRecipe[] | null = null;
  try {
    existingCheeseForLink = await fetchCheeseRecipes();
    prepared.parsed = linkSpecImportCheeseToExisting(
      prepared.parsed,
      existingCheeseForLink.map((r) => r.name),
    );
  } catch {
    // Best-effort — apply with imported names if the pool is unavailable.
  }

  // Re-import prune: compare against the snapshot(s) saved by PREVIOUS imports
  // of this same file and strip everything the spec didn't change, so manual
  // edits made since the last import survive a re-import. Only what actually
  // changed in the workbook is applied. Snapshots are matched per FILE (set
  // intersection on the "|"-joined sourceKey), not by exact key: a file first
  // imported inside a multi-file batch lives in a compound-key snapshot that an
  // exact match would miss — which silently skipped the prune and clobbered
  // user edits. Multiple matching snapshots (newest first) merge so the newest
  // occurrence of each profile/recipe wins. The snapshot saved below stays the
  // FULL parse (never the pruned one) so the next re-import compares against
  // the complete previous state. Best-effort: if snapshots can't be fetched,
  // apply the full parse (previous behavior).
  let applyParsed = prepared.parsed;
  try {
    const sourceKey = deriveSourceKey(prepared.sourceNames ?? []);
    if (sourceKey) {
      const sheets = await fetchSavedSpecSheets();
      const candidates = selectPruneSnapshots(sheets, sourceKey).filter((s) => s.data);
      if (candidates.length > 0) {
        const previous = mergePruneSnapshots(candidates.map((s) => s.data));
        applyParsed = pruneSpecImportAgainstSnapshot(prepared.parsed, previous).parsed;
      }
    }
  } catch {
    // Best-effort — a failed snapshot fetch must never block the import.
  }

  // Commit-time dough relink against the LIVE server pool. Prepare's link
  // pass is best-effort (its pool fetch may have failed offline), so a
  // profile could still carry a variant dough name ("CRB Heavy Plus recipe")
  // whose base family recipe ("CRB Dough") exists in the pool. Re-snapping
  // here keeps the apply and the placeholder suppression below consistent —
  // otherwise suppression could strand a profile pointing at a name with no
  // backing recipe anywhere.
  // The fetched pools are also handed to applySpecImport below: it snaps
  // spec names onto pool spellings (no phantom dropdown names) and hydrates
  // profile recipe rows from the pool when this device has no local preset.
  const livePools: {
    dough?: SpecImportServerPoolRecipe[];
    sauce?: SpecImportServerPoolRecipe[];
  } = {};
  for (const kind of ["dough", "sauce"] as const) {
    try {
      const livePool = await fetchNamedRecipes(kind);
      livePools[kind] = livePool.map((r) => ({
        name: r.name,
        components: (r.components ?? []).map((c) => ({ ingredient: c.ingredient, lbs: c.lbs })),
        doughballWeightOz: r.doughballWeightOz,
        doughballsPerTray: r.doughballsPerTray,
      }));
      applyParsed = linkSpecImportNamedRecipesToExisting(
        applyParsed,
        kind,
        livePool.map((r) => r.name),
      );
    } catch {
      // Best-effort (offline) — prepare's link result stands.
    }
  }

  const applyOut: { recipePlaceholders?: SpecImportRecipePlaceholder[] } = {};
  const touchedProfiles = applySpecImport(applyParsed, applyOut, livePools);

  // For the SERVER-POOL collects below only: backfill "who it goes to"
  // brand/flavor targets onto cheese-kind recipes that arrived unscoped, from
  // the profiles whose applicator grid references them by name. Without this,
  // sheets that express the tie only through the applicator grid produce
  // Cheese Recipes / Mixes pool entries with no customer tag. The local apply
  // above intentionally uses the untouched parse (its own slot-matching pass
  // already ties recipes to profiles).
  const scopedParsed = fillSpecCheeseTargetsFromProfiles(applyParsed);

  // Spec-named dough/sauce with no backing recipe anywhere: create an
  // empty-components placeholder in the server pool so the name is visible
  // (and editable) under Manage Lists → Dough/Sauce Recipes instead of living
  // only on the profile. Tagged "who it goes to" from the referencing
  // profiles when they all share one brand. Loose near-dup guard against the
  // existing pool: if a pool entry already loose-matches the name, the
  // profile relink pass should have (or will) snap onto it — never mint a
  // near-duplicate placeholder. Best-effort, manager-gated server-side.
  let placeholderRecipesAdded = 0;
  for (const kind of ["dough", "sauce"] as const) {
    const cands = (applyOut.recipePlaceholders ?? []).filter((c) => c.kind === kind);
    if (!cands.length) continue;
    try {
      const pool = await fetchNamedRecipes(kind);
      // Group per recipe name: union flavors; multi-brand names stay untagged.
      const byName = new Map<string, { name: string; brands: Set<string>; flavors: string[] }>();
      const poolNames = pool.map((r) => r.name);
      for (const c of cands) {
        if (pool.some((r) => specImportNamedRecipeNamesEqual(r.name, c.name))) continue;
        // Dough variant of an existing base recipe ("CRB Heavy Plus" when the
        // pool already has "CRB Dough"): never mint a placeholder — the link
        // pass snapped the profile onto the base recipe (one recipe per dough
        // family; qualifiers only locate the doughball weight row).
        if (kind === "dough" && findSpecImportDoughFamilyMatch(c.name, poolNames)) continue;
        const key = c.name.trim().toLowerCase();
        const g = byName.get(key) ?? { name: c.name.trim(), brands: new Set<string>(), flavors: [] };
        if (c.brand.trim()) g.brands.add(c.brand.trim());
        const fl = c.flavor.trim();
        if (fl && !g.flavors.some((f) => f.toLowerCase() === fl.toLowerCase())) g.flavors.push(fl);
        byName.set(key, g);
      }
      const drafts = [...byName.values()]
        .map((g) => {
          const singleBrand = g.brands.size === 1 ? [...g.brands][0] : undefined;
          return namedRecipeFromDraft({
            name: g.name,
            components: [],
            idPrefix: kind,
            brand: singleBrand,
            flavors: singleBrand ? g.flavors : [],
          });
        })
        .filter((r): r is PoolNamedRecipe => r != null);
      if (drafts.length) {
        const { added } = await addNamedRecipesToServerIfAbsent(kind, drafts);
        placeholderRecipesAdded += added;
      }
    } catch {
      // Best-effort (non-manager 403, offline) — import applied.
    }
  }

  // Add any mixes detected in this import to the factory-wide Mixes list so they
  // appear on the Mixes screen alongside premix-imported ones. Manager-gated on
  // the server (saveMixes → 403 for non-managers) and fully best-effort: the
  // recipes already applied locally, so a failed mix sync must never surface as
  // an import error. New mixes are matched by name against existing ones so an
  // import never duplicates (or blanks) a mix the manager already keeps; a spec
  // sheet can't express per-pizza/batch amounts, so they arrive with those at 0
  // for the manager to fill in the editor.
  let mixesAdded = 0;
  try {
    const existingMixes = await fetchMixes();
    const userMixNamesLower = new Set(existingMixes.map((m) => m.name.trim().toLowerCase()));
    const candidates = collectSpecImportMixes(scopedParsed, userMixNamesLower)
      .map((d) => specMixDraftToMix(d))
      .filter((m): m is Mix => m != null);
    if (candidates.length) {
      const { merged, added } = addSpecMixesIfAbsent(existingMixes, candidates);
      // Backfill product tags onto already-saved UNBRANDED mixes this sheet
      // scopes (e.g. a prior import saved them with no customer) — a mix that
      // already has a brand is never re-scoped.
      const tagRes = fillSpecMixTags(merged, candidates);
      if (added > 0 || tagRes.tagged > 0) {
        await saveMixes(tagRes.next);
        mixesAdded = added;
      }
    }
  } catch {
    // Best-effort (non-manager 403, offline, sync disabled) — import applied.
  }

  // Add any named cheese blends detected in this import to the factory-wide
  // Cheese Recipes pool so the run applicator "Cheese" cards (pick-only, they
  // hydrate rows from the pool) can select them. Matched by name against the
  // existing pool so an import never duplicates or clobbers a manager's curated
  // recipe — it simply links to it. Manager-gated on the server and fully
  // best-effort: the recipes already applied locally, so a failed sync must
  // never surface as an import error.
  // "Update the existing recipe with this sheet" picks from the review: the
  // recipe applied locally like a normal one (under the linked existing name),
  // and here the matching SERVER pool recipe's ingredient rows are replaced
  // too — the dough/sauce pickers hydrate rows from the pools, so without
  // this the on-screen recipe would keep its old rows. DOUGH/SAUCE ONLY:
  // cheese rows are never replaced here — spec sheets carry per-PIZZA ounces
  // while the cheese pool's rows are per-BATCH pounds (the Cheese Mix Recipe
  // Specs workbook importer owns those). Instead the cheese block below
  // refreshes ONLY the components' separate per-pizza-oz column.
  const updateTargets = (applyParsed.recipes ?? []).filter(
    (r): r is typeof r & { name: string } =>
      Boolean(r.updateExisting) &&
      !r.referenceOnly &&
      (r.kind === "dough" || r.kind === "sauce") &&
      Boolean((r.name ?? "").trim()) &&
      (r.rows?.length ?? 0) > 0,
  );
  let recipesUpdated = 0;

  let cheeseRecipesAdded = 0;
  let cheeseOzUpdated = 0;
  try {
    const existingMixes = await fetchMixes();
    const userMixNamesLower = new Set(existingMixes.map((m) => m.name.trim().toLowerCase()));
    const drafts = collectSpecImportCheeseRecipes(scopedParsed, userMixNamesLower);
    const candidates = drafts
      .map((d) => specCheeseDraftToRecipe(d))
      .filter((r): r is CheeseRecipe => r != null);
    if (drafts.length) {
      const existingCheese = existingCheeseForLink ?? (await fetchCheeseRecipes());
      const { merged, added } = addCheeseRecipesIfAbsentByName(existingCheese, candidates);
      // Refresh the PER-PIZZA OUNCE column on pool recipes this sheet names
      // (linked picks were already renamed onto the pool name). Safe by
      // construction: only ozPerPizza is written, per-batch lbs is untouched,
      // so a spec import can never corrupt curated batch pounds. Recipes just
      // added above are unchanged (their oz values already match the drafts).
      const ozRes = applyCheeseOzPerPizza(merged, drafts);
      // Backfill customer tags onto already-saved UNBRANDED pool recipes this
      // sheet scopes (e.g. a prior import saved them with no customer) — a
      // recipe that already has a brand is never re-scoped.
      const tagRes = fillCheeseRecipeTags(ozRes.next, drafts);
      if (added > 0 || ozRes.updated > 0 || tagRes.tagged > 0) {
        await saveCheeseRecipes(tagRes.next);
        cheeseRecipesAdded = added;
        cheeseOzUpdated = ozRes.updated;
      }
    }
  } catch {
    // Best-effort (non-manager 403, offline, sync disabled) — import applied.
  }

  // Same update step for the Dough / Sauce named-recipe pools. Best-effort for
  // the same reasons — the sheet's rows already applied locally either way.
  for (const kind of ["dough", "sauce"] as const) {
    const updates = updateTargets
      .filter((r) => r.kind === kind)
      .map((r) => ({ name: r.name.trim(), rows: r.rows ?? [] }));
    if (!updates.length) continue;
    try {
      const pool = await fetchNamedRecipes(kind);
      const upd = updateRecipePoolComponents(pool, updates);
      if (upd.updated > 0) {
        await saveNamedRecipes(kind, upd.next);
        recipesUpdated += upd.updated;
      }
    } catch {
      // Best-effort (non-manager 403, offline) — import applied.
    }
  }

  // Snapshot this import server-side (factory-wide; only the two most recent are
  // kept) so it can later be cross-referenced against the current recipe library
  // (see /ai/spec-reconcile) and diffed by the next re-import of the same file
  // (see the prune above). Profile-only sheets snapshot too so their re-imports
  // can also skip unchanged profiles. Best-effort: the import already applied
  // locally, so a failed snapshot must never surface as an import error.
  if ((prepared.parsed.recipes?.length ?? 0) > 0 || (prepared.parsed.profiles?.length ?? 0) > 0) {
    try {
      const names = prepared.sourceNames ?? [];
      await saveSpecSheet(
        buildSpecSheetLabel(prepared.parsed, names),
        prepared.parsed,
        deriveSourceKey(names),
        prepared.sourceHash,
      );
    } catch {
      // best-effort
    }
  }

  // Final hygiene gate before persisting learned aliases: whatever path
  // produced them (canonicalize tracking, review links/renames, match
  // aliases), never save poisoned pairs — generic "Mix"/"cheese" names,
  // digit mismatches, cycles. Applies to the corrections mirror too.
  const savableAliases = sanitizeSpecAliases(prepared.newAliases);
  if (savableAliases.length) {
    try {
      await saveSpecImportAliases(savableAliases);
    } catch {
      // Best-effort: the import already applied; learning is a bonus.
    }
    // Mirror each learned name mapping into the factory-wide corrections pool
    // (additive — alongside the spec-import aliases above) so every other
    // name-resolving AI helper honors it too.
    void saveAiCorrections(
      savableAliases.map((a) => ({
        domain: aliasKindToDomain(a.kind),
        fromText: a.externalName,
        toText: a.canonicalName,
      })),
    );
  }

  return { mixesAdded, cheeseRecipesAdded, cheeseOzUpdated, recipesUpdated, placeholderRecipesAdded, touchedProfiles };
}
