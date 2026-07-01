// Saved spec sheets — web platform glue.
//
// The last few imported spec sheets are snapshotted server-side (factory-wide,
// shared across all signed-in users, like the learned spec-import aliases) so
// they can later be cross-referenced against the CURRENT recipe library to see
// whether the recipes still match the spec ("does the recipe match the spec?").
// The server keeps only the two most recent snapshots.
//
// The deterministic diff lives in @workspace/spec-reconcile and runs on the
// server; this module only sequences the fetches and builds the current-recipe
// snapshot from local storage. Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/savedSpecSheets.ts (replit.md parity).

import type { ParsedSpecImport } from "@workspace/spec-import";
import type { Discrepancy, ReconcileRecipe, ReconcileProfile } from "@workspace/spec-reconcile";
import { inventoryClientId } from "./inventoryShared";
import {
  loadDoughRecipePresets,
  loadFrontlineRecipePresets,
  loadCheeseRecipePresets,
  loadProfile,
} from "./storage";

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

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { "x-client-id": inventoryClientId() };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function fetchSavedSpecSheets(): Promise<SavedSpecSheet[]> {
  const res = await fetch("/api/spec-sheets", { headers: authHeaders() });
  if (!res.ok) throw new Error(`List saved spec sheets failed (${res.status})`);
  const data = (await res.json()) as { specSheets: SavedSpecSheet[] };
  return data.specSheets ?? [];
}

export async function saveSpecSheet(
  label: string,
  data: ParsedSpecImport,
): Promise<SavedSpecSheet[]> {
  const res = await fetch("/api/spec-sheets", {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ label, data }),
  });
  if (!res.ok) throw new Error(`Save spec sheet failed (${res.status})`);
  const out = (await res.json()) as { specSheets: SavedSpecSheet[] };
  return out.specSheets ?? [];
}

export async function deleteSpecSheet(id: number): Promise<SavedSpecSheet[]> {
  const res = await fetch(`/api/spec-sheets/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete spec sheet failed (${res.status})`);
  const out = (await res.json()) as { specSheets: SavedSpecSheet[] };
  return out.specSheets ?? [];
}

/** Snapshot the current recipe library (dough/sauce/cheese presets) for diffing. */
export function loadCurrentReconcileRecipes(): ReconcileRecipe[] {
  const out: ReconcileRecipe[] = [];
  try {
    for (const [name, p] of Object.entries(loadDoughRecipePresets())) {
      out.push({ kind: "dough", name, rows: (p.rows ?? []).map((r) => ({ ingredient: r.ingredient, lbs: r.lbs })) });
    }
  } catch {
    // best-effort
  }
  try {
    for (const [name, rows] of Object.entries(loadFrontlineRecipePresets())) {
      out.push({ kind: "sauce", name, rows: (rows ?? []).map((r) => ({ ingredient: r.ingredient, lbs: r.lbs })) });
    }
  } catch {
    // best-effort
  }
  try {
    for (const [name, rows] of Object.entries(loadCheeseRecipePresets())) {
      out.push({ kind: "cheese", name, rows: (rows ?? []).map((r) => ({ ingredient: r.ingredient, lbs: r.lbs })) });
    }
  } catch {
    // best-effort
  }
  return out;
}

/**
 * Snapshot the current profile (run-setup spec fields) for one brand+flavor so
 * the reconcile can compare die type, sauce oz/pizza, and applicator/pepperoni
 * slots. Returns null when no profile is stored for that brand+flavor.
 */
export function currentReconcileProfile(brand: string, flavor: string): ReconcileProfile | null {
  const v = loadProfile(brand, flavor);
  if (!v) return null;
  const rec = v as Record<string, unknown>;
  const num = (key: string): number => {
    const n = Number(rec[key]);
    return Number.isFinite(n) ? n : 0;
  };
  const str = (key: string): string => String(rec[key] ?? "").trim();
  const applicators = [1, 2, 3, 4].map((slot) => ({
    type: str(`app${slot}Type`),
    ozPerPizza: num(`app${slot}OzPerPizza`),
  }));
  const pepperonis = [1, 2].map((slot) => ({
    type: str(`pep${slot}Type`),
    sticks: num(`pep${slot}Sticks`),
    ozPerPizza: num(`pep${slot}OzPerPizza`),
  }));
  const dieType = str("dieType");
  return {
    brand,
    flavor,
    ...(dieType ? { dieType } : {}),
    sauceOzPerPizza: num("sauceOzPerPizza"),
    applicators,
    pepperonis,
  };
}

/**
 * Snapshot the current profiles for the brand+flavors referenced by the given
 * spec-sheet profiles (deduped, only those that exist locally). Sent to the
 * server so the AI summary can also narrate profile discrepancies.
 */
export function loadCurrentReconcileProfiles(
  specProfiles: ReadonlyArray<{ brand: string; flavor: string }>,
): ReconcileProfile[] {
  const out: ReconcileProfile[] = [];
  const seen = new Set<string>();
  for (const p of specProfiles) {
    const brand = (p?.brand ?? "").trim();
    const flavor = (p?.flavor ?? "").trim();
    if (!brand || !flavor) continue;
    const key = `${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cur = currentReconcileProfile(brand, flavor);
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * Cross-reference one saved spec sheet against the current recipe library and
 * profiles. The server runs the deterministic diff and adds an advisory
 * plain-language summary; the discrepancy list is always returned even if the
 * AI is down. Current profiles are sent for the brand+flavors this sheet covers.
 */
export async function reconcileSpecSheet(sheet: SavedSpecSheet): Promise<SpecReconcileResult> {
  const specProfiles = Array.isArray(sheet.data?.profiles) ? sheet.data.profiles : [];
  const res = await fetch("/api/ai/spec-reconcile", {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      specSheetId: sheet.id,
      currentRecipes: loadCurrentReconcileRecipes(),
      currentProfiles: loadCurrentReconcileProfiles(specProfiles),
    }),
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
