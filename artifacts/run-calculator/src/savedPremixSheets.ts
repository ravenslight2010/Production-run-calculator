// Saved premix sheets — web platform glue.
//
// When a premix workbook is imported, the full set of Mix[] it declared is
// snapshotted server-side (factory-wide, shared across all signed-in users, like
// the saved spec sheets) so the current mixes can later be reconciled against it
// to see which products need a NEW mix and which existing mixes have DRIFTED. The
// server keeps only the two most recent snapshots.
//
// The deterministic diff lives in @workspace/mix-reconcile and runs CLIENT-side
// (see ./mixReconcile); this module only sequences the snapshot fetches. Mirrors
// the mobile glue in artifacts/run-calculator-mobile/context/savedPremixSheets.ts
// (replit.md parity).

import type { Mix } from "@workspace/mixes";
import { inventoryClientId } from "./inventoryShared";
import { deriveSourceKey } from "./savedSpecSheets";

export { deriveSourceKey };

export type SavedPremixSheet = {
  id: number;
  label: string;
  /** Stable per-file identity (normalized filename); null for legacy snapshots. */
  sourceKey?: string | null;
  createdAt: number;
  data: Mix[];
};

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { "x-client-id": inventoryClientId() };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function fetchSavedPremixSheets(): Promise<SavedPremixSheet[]> {
  const res = await fetch("/api/premix-sheets", { headers: authHeaders() });
  if (!res.ok) throw new Error(`List saved premix sheets failed (${res.status})`);
  const data = (await res.json()) as { premixSheets: SavedPremixSheet[] };
  return data.premixSheets ?? [];
}

export async function savePremixSheet(
  label: string,
  data: Mix[],
  sourceKey?: string,
): Promise<SavedPremixSheet[]> {
  const res = await fetch("/api/premix-sheets", {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ label, data, ...(sourceKey ? { sourceKey } : {}) }),
  });
  if (!res.ok) throw new Error(`Save premix sheet failed (${res.status})`);
  const out = (await res.json()) as { premixSheets: SavedPremixSheet[] };
  return out.premixSheets ?? [];
}

export async function deletePremixSheet(id: number): Promise<SavedPremixSheet[]> {
  const res = await fetch(`/api/premix-sheets/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete premix sheet failed (${res.status})`);
  const out = (await res.json()) as { premixSheets: SavedPremixSheet[] };
  return out.premixSheets ?? [];
}

/**
 * Build a short, human-friendly label for an auto-saved premix snapshot. When the
 * uploaded filename(s) are known they lead the label so distinct workbooks (each
 * kept to its two most recent versions) are easy to tell apart.
 */
export function buildPremixSheetLabel(
  mixes: ReadonlyArray<Mix>,
  sourceNames?: ReadonlyArray<string>,
): string {
  const n = mixes.length;
  const when = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const fileLabel = (sourceNames ?? [])
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const summary = `${n} mix${n === 1 ? "" : "es"}`;
  const head = fileLabel ? `${fileLabel} · ${summary}` : summary;
  return `${head} — ${when}`;
}
