// Ingredient catalog — mobile platform glue (Task #102).
//
// The ingredient catalog is a factory-wide, server-managed master list with
// stable ids (own table, NOT part of the per-day sync payload). Reading is
// open to any signed-in user; creating, renaming, merging and deleting are
// manager-only (the server enforces "manage-inventory"). Recipe rows carry an
// `ingredientId` that resolves to a display name through this catalog (see
// @workspace/ingredient-catalog), so a rename/merge updates every reference
// with no client-side rewrite.
//
// Mirrors the web glue in artifacts/run-calculator/src/ingredients.ts
// (replit.md parity). Mobile has no cookie jar, so the session bearer token
// is attached explicitly to every request (see context/mixes.ts).

import { getAuthToken } from "@workspace/api-client-react";
import {
  normalizeIngredient,
  type Ingredient,
  type IngredientCategory,
} from "@workspace/ingredient-catalog";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

function normalizeIngredients(items: unknown): Ingredient[] {
  if (!Array.isArray(items)) return [];
  const out: Ingredient[] = [];
  for (const raw of items) {
    const item = normalizeIngredient(raw);
    if (item) out.push(item);
  }
  return out;
}

async function call(path: string, opts?: RequestInit): Promise<Ingredient[]> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${opts?.method ?? "GET"} ${path} -> ${res.status}`);
  const data = (await res.json()) as { items: unknown };
  return normalizeIngredients(data.items);
}

export async function fetchIngredients(): Promise<Ingredient[]> {
  return call("/ingredients");
}

export async function saveIngredients(items: Ingredient[]): Promise<Ingredient[]> {
  return call("/ingredients", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function deleteIngredients(ids: string[]): Promise<Ingredient[]> {
  return call("/ingredients", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

export async function mergeIngredientsRemote(
  sourceIds: string[],
  targetId: string,
): Promise<Ingredient[]> {
  return call("/ingredients/merge", {
    method: "POST",
    body: JSON.stringify({ sourceIds, targetId }),
  });
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
