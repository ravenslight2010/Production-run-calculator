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

import type { SpecImportAlias } from "@workspace/spec-import";
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
  const aliases: SpecImportAlias[] = sources
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== tgt.toLowerCase())
    .map((s) => ({
      kind,
      externalName: s,
      canonicalName: tgt,
      context: kind === "flavor" ? (brandContext?.trim() || null) : null,
    }));
  await saveSpecImportAliases(aliases);
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
