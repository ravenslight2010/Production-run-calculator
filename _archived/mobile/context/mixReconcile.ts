// Mix reconciliation — mobile platform glue.
//
// The deterministic new-mix / drifted-mix detection lives in the shared
// @workspace/mix-reconcile lib and runs CLIENT-side (instant, free) against two
// import sources the user chose to watch:
//   - a saved PREMIX sheet snapshot (Mix-vs-Mix; can flag a brand-new mix), and
//   - a saved SPEC sheet (drift only — a mix is a subset of the full recipe).
// The /ai/mix-reconcile endpoint only NARRATES the already-computed discrepancies
// and is fail-safe: the discrepancy list/items are always returned even if the AI
// is unavailable. Applying a fix writes through the manager-gated saveMixes path.
//
// Mirrors the web glue in artifacts/run-calculator/src/mixReconcile.ts (replit.md
// parity). The platform difference is plumbing: mobile threads the session bearer
// token + client id (no cookie jar) and resolves the API base URL.

import { getAuthToken } from "@workspace/api-client-react";
import type { Mix } from "@workspace/mixes";
import {
  reconcileMixesWithPremixSheet,
  reconcileMixesWithSpec,
  specImportToMixProducts,
  type MixDiscrepancy,
  type MixReconcileItem,
} from "@workspace/mix-reconcile";
import { fetchMixes, saveMixes } from "./mixes";
import { fetchSavedPremixSheets } from "./savedPremixSheets";
import { fetchSavedSpecSheets } from "./savedSpecSheets";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type MixReconcileView = {
  source: "premix" | "spec";
  label: string;
  discrepancies: MixDiscrepancy[];
  items: MixReconcileItem[];
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

/** Strip undefined optional fields so the wire payload stays minimal/valid. */
function toWire(discrepancies: MixDiscrepancy[]): MixDiscrepancy[] {
  return discrepancies.map((d) => {
    const out: MixDiscrepancy = {
      source: d.source,
      type: d.type,
      brand: d.brand,
      flavor: d.flavor,
      mixName: d.mixName,
      message: d.message,
    };
    if (d.ingredient !== undefined) out.ingredient = d.ingredient;
    if (d.sheetPerPizza !== undefined) out.sheetPerPizza = d.sheetPerPizza;
    if (d.mixPerPizza !== undefined) out.mixPerPizza = d.mixPerPizza;
    return out;
  });
}

/**
 * Ask the AI for an advisory plain-language narration of the computed
 * discrepancies. Fail-safe: returns an empty summary on any error rather than
 * throwing, because the deterministic list is what actually matters.
 */
async function narrate(label: string, discrepancies: MixDiscrepancy[]): Promise<string> {
  if (discrepancies.length === 0) return "";
  try {
    const base = getApiBaseUrl();
    if (!base) return "";
    const res = await fetch(`${base}/api/ai/mix-reconcile`, {
      method: "POST",
      headers: await authHeaders(true),
      body: JSON.stringify({ label, discrepancies: toWire(discrepancies) }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { summary?: string };
    return data.summary ?? "";
  } catch {
    return "";
  }
}

/** Reconcile current mixes against a saved PREMIX sheet snapshot. */
export async function reconcilePremixSheet(
  sheetId: number,
  label: string,
): Promise<MixReconcileView> {
  const [currentMixes, sheets] = await Promise.all([fetchMixes(), fetchSavedPremixSheets()]);
  const sheet = sheets.find((s) => s.id === sheetId);
  const sheetMixes: Mix[] = sheet?.data ?? [];
  const { discrepancies, items } = reconcileMixesWithPremixSheet({ currentMixes, sheetMixes });
  const summary = await narrate(label, discrepancies);
  return {
    source: "premix",
    label,
    discrepancies,
    items,
    generatedAt: Date.now(),
    ...(summary ? { summary } : {}),
  };
}

/** Reconcile current mixes against a saved SPEC sheet's per-product recipes. */
export async function reconcileSpecSheetMixes(
  sheetId: number,
  label: string,
): Promise<MixReconcileView> {
  const [currentMixes, sheets] = await Promise.all([fetchMixes(), fetchSavedSpecSheets()]);
  const sheet = sheets.find((s) => s.id === sheetId);
  const specProducts = specImportToMixProducts(sheet?.data);
  const { discrepancies, items } = reconcileMixesWithSpec({ currentMixes, specProducts });
  const summary = await narrate(label, discrepancies);
  return {
    source: "spec",
    label,
    discrepancies,
    items,
    generatedAt: Date.now(),
    ...(summary ? { summary } : {}),
  };
}

/**
 * Apply one reconcile item by upserting its suggestedMix into the current mix
 * list (replace by id, or append a brand-new mix) and persisting through the
 * manager-gated saveMixes path. Returns the saved list.
 */
export async function applyMixReconcileItem(item: MixReconcileItem): Promise<Mix[]> {
  const existing = await fetchMixes();
  const idx = existing.findIndex((m) => m.id === item.suggestedMix.id);
  const next =
    idx >= 0
      ? existing.map((m) => (m.id === item.suggestedMix.id ? item.suggestedMix : m))
      : [...existing, item.suggestedMix];
  return saveMixes(next);
}
