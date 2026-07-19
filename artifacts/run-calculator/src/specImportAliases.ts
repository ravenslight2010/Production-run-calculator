// Learned spec-sheet-import aliases — web platform glue.
//
// When the Excel spec-sheet importer resolves a messy spreadsheet label to a
// saved canonical name (brand, flavor, applicator/pepperoni type, or a recipe
// ingredient), that mapping is persisted server-side (factory-wide, shared
// across all signed-in users). Future imports fetch these and auto-apply
// remembered matches BEFORE falling back to AI/fuzzy matching — no AI call
// needed, and it works for operators too (the endpoint is requireAuth, not
// manager-gated).
//
// Best-effort: on any failure (sync disabled, network) the importer silently
// proceeds without learned aliases. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/specImportAliases.ts (replit.md parity).

import type { SpecAliasKind, SpecImportAlias } from "@workspace/spec-import";
import { inventoryClientId } from "./inventoryShared";
import { fetchWithTimeout } from "./fetchWithTimeout";

export async function fetchSpecImportAliases(): Promise<SpecImportAlias[]> {
  // Bounded wait: this is the FIRST request of every spec import. If the
  // deployment is cold-starting it can hang at the edge; the caller treats any
  // failure as "no learned aliases" and proceeds, so a short timeout keeps the
  // import moving instead of freezing the loading dialog.
  const res = await fetchWithTimeout(
    "/api/spec-import-aliases",
    { headers: { "x-client-id": inventoryClientId() } },
    15_000,
  );
  if (!res.ok) throw new Error(`List spec-import aliases failed (${res.status})`);
  const data = (await res.json()) as { aliases: SpecImportAlias[] };
  return data.aliases ?? [];
}

/**
 * Learn spec-import aliases when a brand/flavor is MERGED or RENAMED so a later
 * re-import of the same workbook resolves the old name to the new one instead
 * of resurrecting it. The merge UI already learns a merge-suggester alias, but
 * the importers canonicalize through THIS store — without this record, a
 * re-import treats the merged-away/renamed name as brand-new. Flavor aliases
 * carry the canonical brand as context (flavor names are brand-scoped).
 * Best-effort by design: callers fire-and-forget; a failure just means the next
 * re-import shows the old name for manual review again.
 */
export async function learnSpecImportAliasesForNameChange(
  kind: "brand" | "flavor",
  sources: ReadonlyArray<string>,
  target: string,
  brandContext?: string,
): Promise<void> {
  const tgt = target.trim();
  if (!tgt) return;
  if (kind === "brand") {
    // Brand changes go through the full builder: chain re-point of prior brand
    // aliases PLUS re-contexting of flavor aliases scoped to the old brand
    // (without which merged-away flavors resurrect under the renamed brand).
    let existing: SpecImportAlias[] = [];
    try {
      existing = await fetchSpecImportAliases();
    } catch {
      // Proceed without re-points; the direct old→new rows still save.
    }
    await saveSpecImportAliases(buildBrandRenameAliases(sources, tgt, existing));
    return;
  }
  const aliases: SpecImportAlias[] = sources
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== tgt.toLowerCase())
    .map((s) => ({
      kind,
      externalName: s,
      canonicalName: tgt,
      context: brandContext?.trim() || null,
    }));
  await saveSpecImportAliases(aliases);
}

// ── Customer (brand) rename learning (pool-manager group renames) ────────────

/**
 * Build the `kind:"brand"` alias rows to persist after a customer-group RENAME
 * (or merge into an existing group) inside the Cheese Recipes / Mixes pool
 * managers, so a later re-import of a workbook whose tab still carries the OLD
 * customer name maps onto the renamed group (via `remapCheeseRecipeBrands` /
 * the premix brand remap) instead of resurrecting it. Also RE-POINTS existing
 * brand aliases whose canonical was the old name (chain guard — without it a
 * raw→old alias plus old→new alias gets dropped wholesale by the sanitizer's
 * conflict drop on the next import). Brand aliases are context-free. Pure.
 */
export function buildBrandRenameAliases(
  sources: ReadonlyArray<string>,
  target: string,
  existingAliases: ReadonlyArray<SpecImportAlias> = [],
): SpecImportAlias[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const tgtLc = tgt.toLowerCase();
  const seenSrc = new Set<string>();
  const srcs = sources
    .map((s) => s.trim())
    .filter((s) => {
      const lc = s.toLowerCase();
      if (!s || lc === tgtLc || seenSrc.has(lc)) return false;
      seenSrc.add(lc);
      return true;
    });
  if (srcs.length === 0) return [];

  const out: SpecImportAlias[] = srcs.map((s) => ({
    kind: "brand" as const,
    externalName: s,
    canonicalName: tgt,
    context: null,
  }));

  const srcLc = new Set(srcs.map((s) => s.toLowerCase()));
  for (const a of existingAliases) {
    // Re-point prior brand aliases that resolved onto the now-renamed-away name.
    if (a.kind === "brand") {
      const canonLc = (a.canonicalName ?? "").trim().toLowerCase();
      if (!srcLc.has(canonLc)) continue;
      const extLc = (a.externalName ?? "").trim().toLowerCase();
      if (!extLc || extLc === tgtLc) continue; // would self-alias
      out.push({ ...a, canonicalName: tgt, context: null });
      continue;
    }
    // Re-point FLAVOR aliases whose context (the canonical brand) is one of the
    // renamed-away names. On the next import the brand canonicalizes FIRST, so
    // the flavor lookup runs under the NEW brand as context — an alias still
    // scoped to the old brand never fires and the merged-away flavor
    // resurrects. Emitting the same row re-contexted to the new brand keeps it
    // live (the old-context row becomes inert; the server upserts by
    // kind+externalName+context so both keys are distinct and harmless).
    if (a.kind === "flavor") {
      const ctxLc = (a.context ?? "").trim().toLowerCase();
      if (!ctxLc || !srcLc.has(ctxLc)) continue;
      out.push({ ...a, context: tgt });
    }
  }

  // De-dup by upsert key (kind, externalName, context), last row wins.
  const byKey = new Map<string, SpecImportAlias>();
  for (const a of out) {
    byKey.set(
      `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`,
      a,
    );
  }
  return [...byKey.values()];
}

/**
 * Learn a customer-group rename as a context-free brand alias (with chain
 * re-point). Fetches the current alias store first (best-effort) so chained
 * aliases get re-pointed. Best-effort by design: callers fire-and-forget; a
 * failure just means the next re-import resurrects the old group once more.
 */
export async function learnBrandRenameAliases(
  oldBrand: string,
  newBrand: string,
): Promise<void> {
  let existing: SpecImportAlias[] = [];
  try {
    existing = await fetchSpecImportAliases();
  } catch {
    // Proceed without re-points; the direct old→new row still saves.
  }
  await saveSpecImportAliases(buildBrandRenameAliases([oldBrand], newBrand, existing));
}

/**
 * Fire-and-forget brand rename learning for the pool managers. Skips no-op
 * renames and blank names.
 */
export function maybeLearnBrandRename(oldBrand: string, newBrand: string): void {
  const from = oldBrand.trim();
  const to = newBrand.trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
  void learnBrandRenameAliases(from, to).catch(() => {});
}

/**
 * Per-row brand-edit rule: when a single pool row's brand is changed and NO
 * other row in the pool still carries the old brand, the whole group
 * effectively moved — learn the rename alias. If other rows keep the old
 * brand it's a re-scope (the customer still exists), so learn nothing.
 * Mirrors `maybeLearnPoolRename`'s fire-and-forget pattern.
 */
export function maybeLearnRowBrandChange(
  oldBrand: string,
  newBrand: string,
  otherRowsStillCarryOldBrand: boolean,
): void {
  if (otherRowsStillCarryOldBrand) return;
  maybeLearnBrandRename(oldBrand, newBrand);
}

// ── Recipe-NAME change learning (merge / rename in Manage Lists) ─────────────
//
// Importer↔alias-kind mapping (which store each importer consults, so a learned
// alias here actually fires on the next re-import):
//   * MIXES  — premix importer `suggestPremixRedirects` + spec importer blend
//     link pass read kind "appType" (the shared blend-name namespace): a
//     brand-scoped row (context = brand) wins, the context-free row (context =
//     null) is the cross-importer fallback. Same rows the "Use existing mix"
//     dialog pick writes.
//   * CHEESE — cheese importer `buildCheeseAliasLinkMaps`/`findCheeseAliasLink`
//     + spec importer blend link pass read the SAME "appType" namespace with
//     the same brand-scoped + context-free precedence.
//   * DOUGH / SAUCE — spec importer's named-recipe link pass reads kind
//     "recipeName" with the recipe kind in `context` ("dough" | "sauce"), the
//     same rows the dough/sauce "Use existing" dialog pick writes.
// Stale-reference REMOVE learns nothing on purpose: an alias maps old→new and
// there is no "nothing" target — a re-import simply re-offers the removed name
// for manual review, which is the intended behavior.

export type RecipeNameAliasCategory = "mixes" | "cheese" | "dough" | "sauce";

/**
 * Build the alias rows to persist after a recipe-name MERGE or RENAME so the
 * next re-import of the original workbook maps the old sheet name onto the
 * surviving recipe instead of resurrecting it. Also RE-POINTS any existing
 * alias row whose canonical name is one of the merged-away sources (the server
 * upserts by (kind, externalName, context), replacing the old row) — without
 * this, a chained alias (raw→old plus old→new) gets discarded wholesale by the
 * sanitizer's conflict drop on the next import. Pure.
 */
export function buildRecipeNameChangeAliases(
  category: RecipeNameAliasCategory,
  sources: ReadonlyArray<string>,
  target: string,
  opts: {
    brandContext?: string | null;
    existingAliases?: ReadonlyArray<SpecImportAlias>;
  } = {},
): SpecImportAlias[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const tgtLc = tgt.toLowerCase();
  const seenSrc = new Set<string>();
  const srcs = sources
    .map((s) => s.trim())
    .filter((s) => {
      const lc = s.toLowerCase();
      if (!s || lc === tgtLc || seenSrc.has(lc)) return false;
      seenSrc.add(lc);
      return true;
    });
  if (srcs.length === 0) return [];

  const isBlend = category === "mixes" || category === "cheese";
  const kind = isBlend ? ("appType" as const) : ("recipeName" as const);
  const brand = (opts.brandContext ?? "").trim();
  const out: SpecImportAlias[] = [];
  for (const s of srcs) {
    if (isBlend) {
      // Context-free row = cross-importer fallback; brand-scoped row (when the
      // surviving recipe's brand is known) wins at suggest time.
      out.push({ kind, externalName: s, canonicalName: tgt, context: null });
      if (brand) out.push({ kind, externalName: s, canonicalName: tgt, context: brand });
    } else {
      out.push({ kind, externalName: s, canonicalName: tgt, context: category });
    }
  }

  // Re-point prior aliases that resolved onto a now-merged-away source.
  const srcLc = new Set(srcs.map((s) => s.toLowerCase()));
  for (const a of opts.existingAliases ?? []) {
    if (a.kind !== kind) continue;
    if (!isBlend && (a.context ?? "").trim().toLowerCase() !== category) continue;
    const canonLc = (a.canonicalName ?? "").trim().toLowerCase();
    if (!srcLc.has(canonLc)) continue;
    const extLc = (a.externalName ?? "").trim().toLowerCase();
    if (!extLc || extLc === tgtLc) continue; // would self-alias
    out.push({ ...a, canonicalName: tgt });
  }

  // De-dup by upsert key (kind, externalName, context), last row wins.
  const byKey = new Map<string, SpecImportAlias>();
  for (const a of out) {
    byKey.set(
      `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`,
      a,
    );
  }
  return [...byKey.values()];
}

/**
 * Learn recipe-name change aliases after a merge or rename. Fetches the
 * current alias store first (best-effort) so chained aliases get re-pointed.
 * Best-effort by design: callers fire-and-forget; a failure just means the
 * next re-import shows the old name for manual review again.
 */
export async function learnRecipeNameChangeAliases(
  category: RecipeNameAliasCategory,
  sources: ReadonlyArray<string>,
  target: string,
  brandContext?: string | null,
): Promise<void> {
  let existing: SpecImportAlias[] = [];
  try {
    existing = await fetchSpecImportAliases();
  } catch {
    // Proceed without re-points; the direct old→new rows still save.
  }
  const aliases = buildRecipeNameChangeAliases(category, sources, target, {
    brandContext,
    existingAliases: existing,
  });
  await saveSpecImportAliases(aliases);
}

/**
 * Fire-and-forget rename learning for inline server-pool row edits in the
 * Manage Lists managers (Mixes / Cheese Recipes / Dough / Sauce). Skips
 * no-op edits, blank names, and the fresh-row placeholders ("" / "New Dough
 * Recipe" etc.) so naming a brand-new row never mints a bogus alias.
 */
export function maybeLearnPoolRename(
  category: RecipeNameAliasCategory,
  oldName: string,
  newName: string,
  brandContext?: string | null,
): void {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
  // Fresh-row placeholder names must never become aliases: they'd hijack any
  // future sheet that happened to carry the placeholder text.
  if (/^new (mix|dough recipe|sauce recipe|cheese recipe|recipe)$/i.test(from)) return;
  void learnRecipeNameChangeAliases(category, [from], to, brandContext).catch(() => {});
}

// ── Ingredient merge/rename learning ─────────────────────────────────────────

/**
 * The three spec-import ingredient alias namespaces. The spec importer
 * canonicalizes recipe rows per recipe kind: dough rows → "doughIngredient",
 * sauce (frontline) rows → "sauceIngredient", cheese AND mix rows →
 * "cheeseIngredient" (mixes ride the cheese recipe kind in spec parses).
 */
export const INGREDIENT_ALIAS_KIND_LIST: ReadonlyArray<SpecAliasKind> = [
  "doughIngredient",
  "sauceIngredient",
  "cheeseIngredient",
];

/**
 * Build the `*Ingredient` alias rows to persist after an ingredient MERGE or
 * RENAME so a spec-sheet re-import maps the old row name onto the survivor
 * instead of resurrecting it in recipe rows. Same chain re-point + self-alias
 * drop + upsert-key dedup as the brand/recipe builders. `kinds` picks which
 * namespaces learn: the unified Ingredients MERGE tab is category-agnostic
 * (the same physical ingredient can appear in dough, sauce and cheese
 * recipes), so merges learn ALL THREE; a per-pool rename learns only its own
 * kind. Note: the sanitizer's modifier-drop guard (isModifierDropNamePair)
 * still drops token-subset pairs like "Sea Salt"→"Salt" at APPLY time by
 * design — those stay manual-review on re-import. Pure.
 */
export function buildIngredientChangeAliases(
  sources: ReadonlyArray<string>,
  target: string,
  opts: {
    kinds?: ReadonlyArray<SpecAliasKind>;
    existingAliases?: ReadonlyArray<SpecImportAlias>;
  } = {},
): SpecImportAlias[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const tgtLc = tgt.toLowerCase();
  const seenSrc = new Set<string>();
  const srcs = sources
    .map((s) => s.trim())
    .filter((s) => {
      const lc = s.toLowerCase();
      if (!s || lc === tgtLc || seenSrc.has(lc)) return false;
      seenSrc.add(lc);
      return true;
    });
  if (srcs.length === 0) return [];
  const kinds = opts.kinds?.length ? opts.kinds : INGREDIENT_ALIAS_KIND_LIST;

  const out: SpecImportAlias[] = [];
  for (const kind of kinds) {
    for (const s of srcs) {
      out.push({ kind, externalName: s, canonicalName: tgt, context: null });
    }
  }

  // Re-point prior aliases that resolved onto a now-merged-away source.
  const srcLc = new Set(srcs.map((s) => s.toLowerCase()));
  const kindSet = new Set(kinds);
  for (const a of opts.existingAliases ?? []) {
    if (!kindSet.has(a.kind)) continue;
    const canonLc = (a.canonicalName ?? "").trim().toLowerCase();
    if (!srcLc.has(canonLc)) continue;
    const extLc = (a.externalName ?? "").trim().toLowerCase();
    if (!extLc || extLc === tgtLc) continue; // would self-alias
    out.push({ ...a, canonicalName: tgt });
  }

  // De-dup by upsert key (kind, externalName, context), last row wins.
  const byKey = new Map<string, SpecImportAlias>();
  for (const a of out) {
    byKey.set(
      `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`,
      a,
    );
  }
  return [...byKey.values()];
}

/**
 * Learn ingredient merge/rename aliases. Fetches the current alias store first
 * (best-effort) so chained aliases get re-pointed. Best-effort by design:
 * callers fire-and-forget; a failure just means the next re-import shows the
 * old name for manual review again.
 */
export async function learnIngredientChangeAliases(
  sources: ReadonlyArray<string>,
  target: string,
  kinds?: ReadonlyArray<SpecAliasKind>,
): Promise<void> {
  let existing: SpecImportAlias[] = [];
  try {
    existing = await fetchSpecImportAliases();
  } catch {
    // Proceed without re-points; the direct old→new rows still save.
  }
  await saveSpecImportAliases(
    buildIngredientChangeAliases(sources, target, { kinds, existingAliases: existing }),
  );
}

/**
 * Fire-and-forget ingredient rename learning for the per-pool rename controls
 * (Dough / Sauce (frontline) / Cheese / Mix ingredient lists). Skips no-op
 * renames and blank names.
 */
export function maybeLearnIngredientRename(
  kinds: ReadonlyArray<SpecAliasKind>,
  oldName: string,
  newName: string,
): void {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
  void learnIngredientChangeAliases([from], to, kinds).catch(() => {});
}

// ── Applicator/pepperoni TYPE rename learning ────────────────────────────────

/**
 * Build the `appType`/`pepType`/`dieType` alias rows to persist after a type
 * RENAME in Manage Lists so a spec re-import maps the old type name onto the
 * new one instead of resurrecting it. Same chain re-point + self-alias drop +
 * dedup pattern. The sanitizer's digit guard (DIGIT_GUARDED_ALIAS_KINDS) still
 * drops digit-mismatched pairs at apply time by design (for die types that is
 * exactly right: an 11" die must never silently become a 12" one). Pure.
 */
export function buildTypeRenameAliases(
  kind: "appType" | "pepType" | "dieType",
  sources: ReadonlyArray<string>,
  target: string,
  existingAliases: ReadonlyArray<SpecImportAlias> = [],
): SpecImportAlias[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const tgtLc = tgt.toLowerCase();
  const seenSrc = new Set<string>();
  const srcs = sources
    .map((s) => s.trim())
    .filter((s) => {
      const lc = s.toLowerCase();
      if (!s || lc === tgtLc || seenSrc.has(lc)) return false;
      seenSrc.add(lc);
      return true;
    });
  if (srcs.length === 0) return [];

  const out: SpecImportAlias[] = srcs.map((s) => ({
    kind,
    externalName: s,
    canonicalName: tgt,
    context: null,
  }));

  // Re-point prior aliases (any context — appType rows may be brand-scoped)
  // that resolved onto the now-renamed-away name.
  const srcLc = new Set(srcs.map((s) => s.toLowerCase()));
  for (const a of existingAliases) {
    if (a.kind !== kind) continue;
    const canonLc = (a.canonicalName ?? "").trim().toLowerCase();
    if (!srcLc.has(canonLc)) continue;
    const extLc = (a.externalName ?? "").trim().toLowerCase();
    if (!extLc || extLc === tgtLc) continue; // would self-alias
    out.push({ ...a, canonicalName: tgt });
  }

  // De-dup by upsert key (kind, externalName, context), last row wins.
  const byKey = new Map<string, SpecImportAlias>();
  for (const a of out) {
    byKey.set(
      `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`,
      a,
    );
  }
  return [...byKey.values()];
}

/**
 * Fire-and-forget type rename learning for the Manage Lists applicator /
 * pepperoni / die type rename controls. Skips no-op renames and blank names.
 * Best-effort by design.
 */
export function maybeLearnTypeRename(
  kind: "appType" | "pepType" | "dieType",
  oldName: string,
  newName: string,
): void {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
  void (async () => {
    let existing: SpecImportAlias[] = [];
    try {
      existing = await fetchSpecImportAliases();
    } catch {
      // Proceed without re-points; the direct old→new row still saves.
    }
    await saveSpecImportAliases(buildTypeRenameAliases(kind, [from], to, existing));
  })().catch(() => {});
}

export async function saveSpecImportAliases(aliases: SpecImportAlias[]): Promise<void> {
  if (aliases.length === 0) return;
  const res = await fetch("/api/spec-import-aliases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ aliases }),
  });
  if (!res.ok) throw new Error(`Save spec-import aliases failed (${res.status})`);
}
