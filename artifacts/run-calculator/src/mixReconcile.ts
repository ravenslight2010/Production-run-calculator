// Mix reconciliation — web platform glue.
//
// The deterministic new-mix / drifted-mix detection lives in the shared
// @workspace/mix-reconcile lib and runs CLIENT-side (instant, free) against two
// import sources the user chose to watch:
//   - a saved PREMIX sheet snapshot (Mix-vs-Mix; can flag a brand-new mix), and
//   - a saved SPEC sheet (drift only — a mix is a subset of the full recipe).
// The discrepancy list/items are the complete result; no model narration is
// involved.
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

export type MixReconcileView = {
  source: "premix" | "spec";
  label: string;
  discrepancies: MixDiscrepancy[];
  items: MixReconcileItem[];
  generatedAt: number;
  summary?: string;
};

/** Reconcile current mixes against a saved PREMIX sheet snapshot. */
export async function reconcilePremixSheet(
  sheetId: number,
  label: string,
): Promise<MixReconcileView> {
  const [currentMixes, sheets] = await Promise.all([fetchMixes(), fetchSavedPremixSheets()]);
  const sheet = sheets.find((s) => s.id === sheetId);
  const sheetMixes: Mix[] = sheet?.data ?? [];
  const { discrepancies, items } = reconcileMixesWithPremixSheet({ currentMixes, sheetMixes });
  return {
    source: "premix",
    label,
    discrepancies,
    items,
    generatedAt: Date.now(),
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
  return {
    source: "spec",
    label,
    discrepancies,
    items,
    generatedAt: Date.now(),
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
