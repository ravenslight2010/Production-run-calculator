// Learned spec-sheet-import aliases — mobile platform glue.
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
// proceeds without learned aliases. Mirrors the web glue in
// artifacts/run-calculator/src/specImportAliases.ts (replit.md parity). The one
// platform difference is plumbing: mobile threads the session bearer token +
// client id through fetch (no cookie jar), exactly like context/importAliases.ts.

import { getAuthToken } from "@workspace/api-client-react";
import type { SpecImportAlias } from "@workspace/spec-import";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export async function fetchSpecImportAliases(): Promise<SpecImportAlias[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/spec-import-aliases`, {
    headers: {
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`List spec-import aliases failed (${res.status})`);
  const data = (await res.json()) as { aliases: SpecImportAlias[] };
  return data.aliases ?? [];
}

export async function saveSpecImportAliases(aliases: SpecImportAlias[]): Promise<void> {
  if (aliases.length === 0) return;
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/spec-import-aliases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ aliases }),
  });
  if (!res.ok) throw new Error(`Save spec-import aliases failed (${res.status})`);
}
