// Mix reconciliation — web platform glue.
//
// The deterministic new-mix / drifted-mix detection lives in the shared
// @workspace/mix-reconcile lib and runs CLIENT-side (instant, free) against two
// import sources the user chose to watch:
//   - a saved PREMIX sheet snapshot (Mix-vs-Mix; can flag a brand-new mix), and
//   - a saved SPEC sheet (drift only — a mix is a subset of the full recipe).
// The /ai/mix-reconcile endpoint only NARRATES the already-computed discrepancies
// (it can't invent or miss one), and is fail-safe: the discrepancy list/items are
// always returned even if the AI is unavailable.
//
// Applying a suggested fix writes the item's suggestedMix through the existing
// manager-gated saveMixes path. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/mixReconcile.ts (replit.md parity).

import type { Mix } from "@workspace/mixes";
import {
  reconcileMixesWithPremixSheet,
  reconcileMixesWithSpec,
  specImportToMixProducts,
  type MixDiscrepancy,
  type MixReconcileItem,
  mixReconcileSignature,
} from "@workspace/mix-reconcile";
import { fetchMixes, saveMixes } from "./mixes";
import { fetchSavedPremixSheets } from "./savedPremixSheets";
import { fetchSavedSpecSheets } from "./savedSpecSheets";
import { inventoryClientId } from "./inventoryShared";
import type { AiStatus } from "./aiStatus";

export type MixReconcileView = {
  source: "premix" | "spec";
  label: string;
  discrepancies: MixDiscrepancy[];
  items: MixReconcileItem[];
  generatedAt: number;
  summary?: string;
  aiStatus?: AiStatus;
};

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { "x-client-id": inventoryClientId() };
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
async function narrate(
  label: string,
  discrepancies: MixDiscrepancy[],
): Promise<{ summary: string; aiStatus?: AiStatus }> {
  if (discrepancies.length === 0) return { summary: "", aiStatus: "deterministic" };
  try {
    const res = await fetch("/api/ai/mix-reconcile", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ label, discrepancies: toWire(discrepancies) }),
    });
    if (!res.ok) return { summary: "" };
    const data = (await res.json()) as { summary?: string; aiStatus?: AiStatus };
    return { summary: data.summary ?? "", aiStatus: data.aiStatus };
  } catch {
    return { summary: "" };
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
  const narration = await narrate(label, discrepancies);
  return {
    source: "premix",
    label,
    discrepancies,
    items,
    generatedAt: Date.now(),
    ...(narration.summary ? { summary: narration.summary } : {}),
    ...(narration.aiStatus ? { aiStatus: narration.aiStatus } : {}),
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
  const narration = await narrate(label, discrepancies);
  return {
    source: "spec",
    label,
    discrepancies,
    items,
    generatedAt: Date.now(),
    ...(narration.summary ? { summary: narration.summary } : {}),
    ...(narration.aiStatus ? { aiStatus: narration.aiStatus } : {}),
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
  if (item.currentSignature && (idx < 0 || mixReconcileSignature(existing[idx]!) !== item.currentSignature)) {
    throw new Error("The current mix changed while this repair was open. Refresh and review it again.");
  }
  const next = idx >= 0
    ? existing.map((m) => (m.id === item.suggestedMix.id ? item.suggestedMix : m))
    : [...existing, item.suggestedMix];
  return saveMixes(next);
}
