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
  /** Stable per-file identity (normalized filename); null for legacy snapshots. */
  sourceKey?: string | null;
  /**
   * SHA-256 content fingerprint of the imported file bytes (per-file hashes
   * sorted + re-hashed for multi-file imports); null for legacy snapshots.
   */
  sourceHash?: string | null;
  createdAt: number;
  data: ParsedSpecImport;
};

/**
 * Normalize one or more uploaded filenames into a stable per-file identity so
 * retention keeps the two most recent versions of each distinct spec sheet.
 * Lowercased, extension-stripped, whitespace-collapsed; multi-file imports join
 * their sorted names. Returns undefined when no usable name is available.
 */
export function deriveSourceKey(names: ReadonlyArray<string>): string | undefined {
  const norm = names
    .map((n) => (n ?? "").trim().toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort();
  const key = [...new Set(norm)].join("|");
  return key || undefined;
}

/**
 * Select the previous-import snapshots relevant to a new import of the file(s)
 * behind `sourceKey`, newest first. Matching is per-FILE, not per exact key: a
 * multi-file batch import saves ONE snapshot under a compound sourceKey
 * (filenames joined with "|"), so a later single-file re-import must still
 * find the batch snapshot that contained its file — and vice versa. A snapshot
 * matches when its file set INTERSECTS the current import's file set. Feed the
 * result (newest first) to mergePruneSnapshots so the newest occurrence of
 * each profile/recipe wins. Legacy snapshots without a sourceKey never match.
 */
export function selectPruneSnapshots<
  T extends { id: number; sourceKey?: string | null; createdAt: number },
>(sheets: ReadonlyArray<T>, sourceKey: string): T[] {
  const current = new Set(
    sourceKey.split("|").map((s) => s.trim()).filter(Boolean),
  );
  if (current.size === 0) return [];
  return sheets
    .filter((s) => {
      const key = (s.sourceKey ?? "").trim();
      if (!key) return false;
      return key
        .split("|")
        .some((part) => current.has(part.trim()));
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}

/**
 * Pick the snapshot whose parse can be REUSED for a new import: the file set
 * must be exactly the same (identical sourceKey) AND the file bytes must be
 * identical (matching sourceHash). Exact-key only — a batch snapshot's data is
 * the MERGED parse of every file in the batch, so reusing it for a partial
 * re-import would resurrect the other files' content. Newest first; returns
 * undefined when nothing qualifies. Reusing the stored parse sidesteps AI
 * re-read drift: the same workbook parsed twice can come back with slightly
 * different numbers, which the re-import prune then treats as real changes.
 */
export function selectReusableSnapshot<
  T extends { id: number; sourceKey?: string | null; sourceHash?: string | null; createdAt: number },
>(sheets: ReadonlyArray<T>, sourceKey: string, sourceHash: string): T | undefined {
  const key = sourceKey.trim();
  const hash = sourceHash.trim();
  if (!key || !hash) return undefined;
  return [...sheets]
    .filter(
      (s) =>
        (s.sourceKey ?? "").trim() === key &&
        (s.sourceHash ?? "").trim() === hash,
    )
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)[0];
}

/**
 * Given saved snapshots, return the ids that are the NEWEST version within their
 * distinct file (sourceKey) — i.e. the default source to use. Legacy snapshots
 * WITHOUT a sourceKey share one bucket, matching the server's `null -> ""`
 * retention grouping, so only the newest legacy snapshot is "latest". Works for
 * both spec and premix snapshots (same id/sourceKey shape). Tie-break by id desc
 * mirrors the server's newest-first ordering.
 */
export function latestSourceKeyIds(
  sheets: ReadonlyArray<{ id: number; sourceKey?: string | null; createdAt: number }>,
): Set<number> {
  const sorted = [...sheets].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  const seen = new Set<string>();
  const latest = new Set<number>();
  for (const s of sorted) {
    const key = s.sourceKey && s.sourceKey.trim() ? s.sourceKey : "";
    if (!seen.has(key)) {
      seen.add(key);
      latest.add(s.id);
    }
  }
  return latest;
}

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
  sourceKey?: string,
  sourceHash?: string,
): Promise<SavedSpecSheet[]> {
  const res = await fetch("/api/spec-sheets", {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      label,
      data,
      ...(sourceKey ? { sourceKey } : {}),
      ...(sourceHash ? { sourceHash } : {}),
    }),
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

/**
 * Build a short, human-friendly label for an auto-saved import snapshot. When the
 * uploaded filename(s) are known they lead the label so distinct files (each kept
 * to its two most recent versions) are easy to tell apart.
 */
export function buildSpecSheetLabel(
  parsed: ParsedSpecImport,
  sourceNames?: ReadonlyArray<string>,
): string {
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
  const fileLabel = (sourceNames ?? [])
    .map((n) => (n ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const summary = parts.join(", ") || "Spec sheet";
  const head = fileLabel ? `${fileLabel} · ${summary}` : summary;
  return `${head} — ${when}`;
}
