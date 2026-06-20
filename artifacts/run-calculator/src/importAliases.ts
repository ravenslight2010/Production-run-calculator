// Learned import aliases — web platform glue.
//
// When a user confirms a non-exact match of an imported brand/flavor name to a
// saved one during an Excel import, that mapping is persisted server-side
// (factory-wide, shared across all signed-in users). Future imports fetch these
// and auto-apply remembered matches BEFORE falling back to AI/fuzzy matching —
// no AI call needed, and works for operators too.
//
// Best-effort: on any failure (sync disabled, network) the dialog silently
// proceeds without learned aliases. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/importAliases.ts (replit.md parity).

import { inventoryClientId } from "./inventoryShared";

export type ImportAlias = {
  type: "brand" | "flavor";
  externalName: string;
  canonicalName: string;
  brandContext?: string | null;
};

export async function fetchImportAliases(): Promise<ImportAlias[]> {
  const res = await fetch("/api/import-aliases", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List import aliases failed (${res.status})`);
  const data = (await res.json()) as { aliases: ImportAlias[] };
  return data.aliases ?? [];
}

export async function saveImportAliases(aliases: ImportAlias[]): Promise<void> {
  if (aliases.length === 0) return;
  const res = await fetch("/api/import-aliases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ aliases }),
  });
  if (!res.ok) throw new Error(`Save import aliases failed (${res.status})`);
}
