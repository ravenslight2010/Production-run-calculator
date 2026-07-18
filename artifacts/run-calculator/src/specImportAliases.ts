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
