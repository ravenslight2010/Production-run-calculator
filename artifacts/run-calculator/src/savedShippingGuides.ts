// Saved shipping & palletizing guides — web platform glue.
//
// When the deterministic Shipping & Palletizing Guide importer commits, a
// snapshot of the REVIEWED rows (each a matched brand + optional flavor
// targeting + the packaging patch the guide stated) is saved server-side
// (factory-wide, shared across all signed-in users, like saved spec sheets) so
// the Setup Profiles "Auto-Fill From Imports" panel can later reach back to what
// the guide said and cross-reference it against the spec sheet. Before this the
// guide's numbers only ever merged into brand profiles at import time and were
// then unrecoverable. The server keeps only the two most recent per distinct file.
//
// Web-only for now (parity paused per replit.md).

import type { ShippingPatch } from "@workspace/shipping-import";
import { inventoryClientId } from "./inventoryShared";

export type SavedShippingGuideRowEntry = {
  brand: string;
  flavors?: string[];
  patch: ShippingPatch;
};

export type SavedShippingGuideData = {
  rows: SavedShippingGuideRowEntry[];
};

export type SavedShippingGuide = {
  id: number;
  label: string;
  /** Stable per-file identity (normalized filename); null for legacy snapshots. */
  sourceKey?: string | null;
  /** SHA-256 content fingerprint of the imported file bytes; null for legacy. */
  sourceHash?: string | null;
  createdAt: number;
  data: SavedShippingGuideData;
};

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { "x-client-id": inventoryClientId() };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function fetchSavedShippingGuides(): Promise<SavedShippingGuide[]> {
  const res = await fetch("/api/shipping-guides", { headers: authHeaders() });
  if (!res.ok) throw new Error(`List saved shipping guides failed (${res.status})`);
  const data = (await res.json()) as { shippingGuides: SavedShippingGuide[] };
  return data.shippingGuides ?? [];
}

export async function saveShippingGuide(
  label: string,
  data: SavedShippingGuideData,
  sourceKey?: string,
  sourceHash?: string,
): Promise<SavedShippingGuide[]> {
  const res = await fetch("/api/shipping-guides", {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      label,
      data,
      ...(sourceKey ? { sourceKey } : {}),
      ...(sourceHash ? { sourceHash } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Save shipping guide failed (${res.status})`);
  const out = (await res.json()) as { shippingGuides: SavedShippingGuide[] };
  return out.shippingGuides ?? [];
}

export async function deleteShippingGuide(id: number): Promise<SavedShippingGuide[]> {
  const res = await fetch(`/api/shipping-guides/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete shipping guide failed (${res.status})`);
  const out = (await res.json()) as { shippingGuides: SavedShippingGuide[] };
  return out.shippingGuides ?? [];
}

/**
 * Build a short, human-friendly label for an auto-saved guide snapshot. When the
 * uploaded filename is known it leads the label so distinct files are easy to
 * tell apart in the picker/retention.
 */
export function buildShippingGuideLabel(rowCount: number, sourceName?: string): string {
  const when = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const summary = rowCount
    ? `${rowCount} brand${rowCount === 1 ? "" : "s"}`
    : "Palletizing guide";
  const file = (sourceName ?? "").trim();
  const head = file ? `${file} · ${summary}` : summary;
  return `${head} — ${when}`;
}
