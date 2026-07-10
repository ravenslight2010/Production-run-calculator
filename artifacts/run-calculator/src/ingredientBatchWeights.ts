// Learned per-ingredient batch weights — web platform glue + pure helpers.
//
// Mixes and cheese recipes carry their own batch weight (the sum of their
// recipe rows), but plain ingredients (applicator toppings, non-default pep
// types, ready-made sauce barrels) only have a manually typed "Batch Weight
// (lbs)" field. Once a user enters one, it is remembered server-side (factory
// wide, keyed case-insensitively by ingredient name) and auto-filled the next
// time that ingredient is picked — "the weight follows the ingredient".
//
// Same shape as the other learned-memory stores (fill-missing values, photo
// aliases): requireAuth-only endpoints, app-level ci-upsert, best-effort glue
// (a network failure never blocks the user's entry).

import { inventoryClientId } from "./inventoryShared";

export type IngredientBatchWeightRow = { name: string; lbs: number };

export async function fetchIngredientBatchWeights(): Promise<IngredientBatchWeightRow[]> {
  const res = await fetch("/api/ingredient-batch-weights", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List ingredient batch weights failed (${res.status})`);
  const data = (await res.json()) as { weights: IngredientBatchWeightRow[] };
  return data.weights ?? [];
}

export async function saveIngredientBatchWeights(
  weights: IngredientBatchWeightRow[],
): Promise<void> {
  if (weights.length === 0) return;
  const res = await fetch("/api/ingredient-batch-weights", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ weights }),
  });
  if (!res.ok) throw new Error(`Save ingredient batch weights failed (${res.status})`);
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function buildBatchWeightMap(
  rows: IngredientBatchWeightRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = (r.name ?? "").trim().toLowerCase();
    const lbs = Number(r.lbs);
    if (!key || !Number.isFinite(lbs) || lbs <= 0) continue;
    map.set(key, lbs);
  }
  return map;
}

export function lookupBatchWeight(
  map: Map<string, number>,
  name: string,
): number | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  return map.get(key) ?? null;
}

// One (ingredient name, entered lbs) pair as currently visible on the run form.
// Only pairs whose Batch Weight field is actually shown in the UI are eligible:
// a mix / recipe-backed slot hides the manual field, so its stale form value
// must never be learned.
export type BatchWeightCandidate = { name: string; lbs: number };

type RecipeRowLike = { lbs?: number | string | null };

function hasRecipeRows(rows: RecipeRowLike[] | null | undefined): boolean {
  return (rows ?? []).some((r) => Number(r?.lbs) > 0);
}

export type BatchWeightFormSlice = {
  // Applicators 1-4 (ingredientTypes pickers)
  apps: Array<{
    type: string | null | undefined;
    batchLbs: number | null | undefined;
    cheeseRecipe: RecipeRowLike[] | null | undefined;
  }>;
  // Pep applicator slots (A + B), already filtered to the slots the UI shows
  peps: Array<{
    type: string | null | undefined;
    batchLbs: number | null | undefined;
  }>;
  defaultPepTypes: string[];
  sauce: {
    recipeName: string | null | undefined;
    barrelLbs: number | null | undefined;
    recipe: RecipeRowLike[] | null | undefined;
  };
};

// Collect the pairs worth remembering right now: named ingredient + a positive
// manually-visible batch weight that differs from what's already learned.
export function collectBatchWeightCandidates(
  slice: BatchWeightFormSlice,
  learned: Map<string, number>,
): BatchWeightCandidate[] {
  const out = new Map<string, BatchWeightCandidate>();

  const consider = (name: string | null | undefined, lbs: number | null | undefined) => {
    const trimmed = (name ?? "").trim();
    const weight = Number(lbs);
    if (!trimmed || !Number.isFinite(weight) || weight <= 0) return;
    const key = trimmed.toLowerCase();
    if (learned.get(key) === weight) return; // already remembered as-is
    out.set(key, { name: trimmed, lbs: weight });
  };

  for (const app of slice.apps) {
    const type = (app.type ?? "").trim();
    if (!type) continue;
    // Mix slots and recipe-backed cheese slots hide the manual field — the sum
    // of the recipe rows IS their batch weight, so never learn the stale value.
    if (type.toLowerCase().includes("mix")) continue;
    if (hasRecipeRows(app.cheeseRecipe)) continue;
    consider(type, app.batchLbs);
  }

  for (const pep of slice.peps) {
    const type = (pep.type ?? "").trim();
    if (!type) continue;
    // Default pep types are measured in sticks; the lbs field is hidden.
    if (slice.defaultPepTypes.includes(type)) continue;
    consider(type, pep.batchLbs);
  }

  const sauceName = (slice.sauce.recipeName ?? "").trim();
  // A sauce WITH recipe rows derives its barrel weight from the rows
  // (ready-made sauces like BBQ/Ranch are the ones with a manual barrel field).
  if (sauceName && !hasRecipeRows(slice.sauce.recipe)) {
    consider(sauceName, slice.sauce.barrelLbs);
  }

  return [...out.values()];
}
