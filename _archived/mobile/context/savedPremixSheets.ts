// Saved premix sheets — mobile platform glue.
//
// When a premix workbook is imported, the full set of Mix[] it declared is
// snapshotted server-side (factory-wide, shared across all signed-in users, like
// the saved spec sheets) so the current mixes can later be reconciled against it
// to see which products need a NEW mix and which existing mixes have DRIFTED. The
// server keeps only the two most recent snapshots.
//
// The deterministic diff lives in @workspace/mix-reconcile and runs CLIENT-side
// (see ./mixReconcile). Mirrors the web glue in
// artifacts/run-calculator/src/savedPremixSheets.ts (replit.md parity). The one
// platform difference is plumbing: mobile threads the session bearer token +
// client id through fetch (no cookie jar), exactly like context/mixes.ts.

import { getAuthToken } from "@workspace/api-client-react";
import type { Mix } from "@workspace/mixes";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type SavedPremixSheet = {
  id: number;
  label: string;
  createdAt: number;
  data: Mix[];
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

export async function fetchSavedPremixSheets(): Promise<SavedPremixSheet[]> {
  const base = requireBase();
  const res = await fetch(`${base}/api/premix-sheets`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`List saved premix sheets failed (${res.status})`);
  const data = (await res.json()) as { premixSheets: SavedPremixSheet[] };
  return data.premixSheets ?? [];
}

export async function savePremixSheet(label: string, data: Mix[]): Promise<SavedPremixSheet[]> {
  const base = requireBase();
  const res = await fetch(`${base}/api/premix-sheets`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`Save premix sheet failed (${res.status})`);
  const out = (await res.json()) as { premixSheets: SavedPremixSheet[] };
  return out.premixSheets ?? [];
}

export async function deletePremixSheet(id: number): Promise<SavedPremixSheet[]> {
  const base = requireBase();
  const res = await fetch(`${base}/api/premix-sheets/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete premix sheet failed (${res.status})`);
  const out = (await res.json()) as { premixSheets: SavedPremixSheet[] };
  return out.premixSheets ?? [];
}

/** Build a short, human-friendly label for an auto-saved premix snapshot. */
export function buildPremixSheetLabel(mixes: ReadonlyArray<Mix>): string {
  const n = mixes.length;
  const when = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${n} mix${n === 1 ? "" : "es"} — ${when}`;
}
