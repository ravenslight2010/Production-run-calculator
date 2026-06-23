// Saved spec sheets — mobile platform glue.
//
// The last few imported spec sheets are snapshotted server-side (factory-wide,
// shared across all signed-in users, like the learned spec-import aliases) so
// they can later be cross-referenced against the CURRENT recipe library to see
// whether the recipes still match the spec ("does the recipe match the spec?").
// The server keeps only the two most recent snapshots.
//
// The deterministic diff lives in @workspace/spec-reconcile and runs on the
// server; this module only sequences the fetches. Mirrors the web glue in
// artifacts/run-calculator/src/savedSpecSheets.ts (replit.md parity). The one
// platform difference is plumbing: mobile threads the session bearer token +
// client id through fetch (no cookie jar), exactly like context/specImportAliases.ts,
// and the caller passes the current recipe snapshot (no localStorage).

import { getAuthToken } from "@workspace/api-client-react";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { Discrepancy, ReconcileRecipe } from "@workspace/spec-reconcile";
import type { RecipeRow } from "@workspace/inventory-math";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type SavedSpecSheet = {
  id: number;
  label: string;
  createdAt: number;
  data: ParsedSpecImport;
};

export type SpecReconcileResult = {
  specSheetId: number;
  discrepancies: Discrepancy[];
  generatedAt: number;
  summary?: string;
};

async function authHeaders(json = false): Promise<Record<string, string>> {
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const h: Record<string, string> = {
    "x-client-id": clientId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function requireBase(): string {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  return base;
}

export async function fetchSavedSpecSheets(): Promise<SavedSpecSheet[]> {
  const base = requireBase();
  const res = await fetch(`${base}/api/spec-sheets`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`List saved spec sheets failed (${res.status})`);
  const data = (await res.json()) as { specSheets: SavedSpecSheet[] };
  return data.specSheets ?? [];
}

export async function saveSpecSheet(
  label: string,
  data: ParsedSpecImport,
): Promise<SavedSpecSheet[]> {
  const base = requireBase();
  const res = await fetch(`${base}/api/spec-sheets`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`Save spec sheet failed (${res.status})`);
  const out = (await res.json()) as { specSheets: SavedSpecSheet[] };
  return out.specSheets ?? [];
}

export async function deleteSpecSheet(id: number): Promise<SavedSpecSheet[]> {
  const base = requireBase();
  const res = await fetch(`${base}/api/spec-sheets/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete spec sheet failed (${res.status})`);
  const out = (await res.json()) as { specSheets: SavedSpecSheet[] };
  return out.specSheets ?? [];
}

/** Build the current recipe snapshot from the RunContext preset maps. */
export function presetMapsToReconcileRecipes(maps: {
  dough: Record<string, RecipeRow[]>;
  sauce: Record<string, RecipeRow[]>;
  cheese: Record<string, RecipeRow[]>;
}): ReconcileRecipe[] {
  const out: ReconcileRecipe[] = [];
  const push = (kind: ReconcileRecipe["kind"], map: Record<string, RecipeRow[]>) => {
    for (const [name, rows] of Object.entries(map)) {
      out.push({
        kind,
        name,
        rows: (rows ?? []).map((r) => ({ ingredient: r.ingredient, lbs: r.lbs })),
      });
    }
  };
  push("dough", maps.dough);
  push("sauce", maps.sauce);
  push("cheese", maps.cheese);
  return out;
}

/**
 * Cross-reference one saved spec sheet against the current recipe library. The
 * server runs the deterministic diff and adds an advisory plain-language
 * summary; the discrepancy list is always returned even if the AI is down.
 */
export async function reconcileSpecSheet(
  specSheetId: number,
  currentRecipes: ReconcileRecipe[],
): Promise<SpecReconcileResult> {
  const base = requireBase();
  const res = await fetch(`${base}/api/ai/spec-reconcile`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ specSheetId, currentRecipes }),
  });
  if (!res.ok) throw new Error(`Spec cross-reference failed (${res.status})`);
  return (await res.json()) as SpecReconcileResult;
}

/** Build a short, human-friendly label for an auto-saved import snapshot. */
export function buildSpecSheetLabel(parsed: ParsedSpecImport): string {
  const recipes = parsed.recipes?.length ?? 0;
  const profiles = parsed.profiles?.length ?? 0;
  const parts: string[] = [];
  if (recipes) parts.push(`${recipes} recipe${recipes === 1 ? "" : "s"}`);
  if (profiles) parts.push(`${profiles} profile${profiles === 1 ? "" : "s"}`);
  const when = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${parts.join(", ") || "Spec sheet"} — ${when}`;
}
