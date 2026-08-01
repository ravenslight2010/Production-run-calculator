// Cheese recipes — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/cheeseRecipes.ts
// (replit.md parity). Managers define named cheese blends (the customer's
// "Cheese Mix Recipe") once; they are persisted server-side (shared across all
// signed-in users) and are NOT part of the per-day sync payload. Reading is
// open to any signed-in user (the run applicator "Cheese" cards pick one and
// hydrate their rows from it); creating, updating and deleting are manager-only
// (the server enforces "manage-inventory"). Cheese is deliberately kept as its
// OWN master-data pool, not routed into Mixes. Mobile has no cookie jar, so the
// session bearer token is attached explicitly to every request.

import { getAuthToken } from "@workspace/api-client-react";
import {
  normalizeCheeseRecipes,
  type CheeseRecipe,
} from "@workspace/cheese-recipes";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

async function call(path: string, opts?: RequestInit): Promise<CheeseRecipe[]> {
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
  return normalizeCheeseRecipes(data.items);
}

export async function fetchCheeseRecipes(): Promise<CheeseRecipe[]> {
  return call("/cheese-recipes");
}

export async function saveCheeseRecipes(items: CheeseRecipe[]): Promise<CheeseRecipe[]> {
  return call("/cheese-recipes", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function deleteCheeseRecipes(ids: string[]): Promise<CheeseRecipe[]> {
  return call("/cheese-recipes", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}
