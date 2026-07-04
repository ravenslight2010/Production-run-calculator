// Ingredient catalog — web platform glue (Task #102).
//
// The ingredient catalog is a factory-wide, server-managed master list with
// stable ids (own table, NOT part of the per-day sync payload). Reading is
// open to any signed-in user; creating, renaming, merging and deleting are
// manager-only (the server enforces "manage-inventory"). Recipe rows carry an
// `ingredientId` that resolves to a display name through this catalog (see
// @workspace/ingredient-catalog), so a rename/merge updates every reference
// with no client-side rewrite.
//
// Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/ingredients.ts (replit.md parity).

import {
  normalizeIngredient,
  type Ingredient,
  type IngredientCategory,
} from "@workspace/ingredient-catalog";
import { inventoryClientId } from "./inventoryShared";

function normalizeIngredients(items: unknown): Ingredient[] {
  if (!Array.isArray(items)) return [];
  const out: Ingredient[] = [];
  for (const raw of items) {
    const item = normalizeIngredient(raw);
    if (item) out.push(item);
  }
  return out;
}

export async function fetchIngredients(): Promise<Ingredient[]> {
  const res = await fetch("/api/ingredients", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List ingredients failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeIngredients(data.items);
}

export async function saveIngredients(items: Ingredient[]): Promise<Ingredient[]> {
  const res = await fetch("/api/ingredients", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Save ingredients failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeIngredients(data.items);
}

export async function deleteIngredients(ids: string[]): Promise<Ingredient[]> {
  const res = await fetch("/api/ingredients", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete ingredients failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeIngredients(data.items);
}

export async function mergeIngredientsRemote(
  sourceIds: string[],
  targetId: string,
): Promise<Ingredient[]> {
  const res = await fetch("/api/ingredients/merge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ sourceIds, targetId }),
  });
  if (!res.ok) throw new Error(`Merge ingredients failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeIngredients(data.items);
}

// Idempotent "get id for name in category, creating it if it doesn't exist
// yet" — used to seed the catalog from local option lists and to backfill an
// id when a legacy recipe row only has a name. Case-insensitive match.
export function findOrBuildIngredient(
  name: string,
  category: IngredientCategory,
  existing: Ingredient[],
): Ingredient {
  const key = name.trim().toLowerCase();
  const found = existing.find((i) => i.name.trim().toLowerCase() === key);
  if (found) {
    if (found.categories.includes(category)) return found;
    return { ...found, categories: [...found.categories, category] };
  }
  return {
    id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    categories: [category],
    mergedInto: null,
    enabled: true,
  };
}
