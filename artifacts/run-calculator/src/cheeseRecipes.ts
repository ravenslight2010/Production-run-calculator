// Cheese recipes — web platform glue.
//
// Managers define named cheese blends (the customer's "Cheese Mix Recipe")
// once; they are persisted server-side (shared across all signed-in users) and
// are NOT part of the per-day sync payload. Reading is open to any signed-in
// user (the run applicator "Cheese" cards pick one and hydrate their rows from
// it); creating, updating and deleting are manager-only (the server enforces
// "manage-inventory").
//
// Works exactly like the Mixes glue (see ./mixes.ts) — cheese is deliberately
// kept as its OWN master-data pool, not routed into Mixes. Mirrors the mobile
// glue in artifacts/run-calculator-mobile/context/cheeseRecipes.ts (replit.md
// parity).

import {
  normalizeCheeseRecipes,
  type CheeseRecipe,
} from "@workspace/cheese-recipes";
import { inventoryClientId } from "./inventoryShared";
import { captureIngredientNamesToCatalog } from "./ingredients";

export async function fetchCheeseRecipes(): Promise<CheeseRecipe[]> {
  const res = await fetch("/api/cheese-recipes", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List cheese recipes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeCheeseRecipes(data.items);
}

export async function saveCheeseRecipes(items: CheeseRecipe[]): Promise<CheeseRecipe[]> {
  const res = await fetch("/api/cheese-recipes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Save cheese recipes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  // Fire-and-forget: newly typed component names join the factory-wide
  // ingredient catalog so every suggestion list sees them.
  void captureIngredientNamesToCatalog(
    items.flatMap((r) => (r.components ?? []).map((c) => c.ingredient)),
    "cheese",
  );
  return normalizeCheeseRecipes(data.items);
}

export async function deleteCheeseRecipes(ids: string[]): Promise<CheeseRecipe[]> {
  const res = await fetch("/api/cheese-recipes", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete cheese recipes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeCheeseRecipes(data.items);
}
