// Mixes — web platform glue.
//
// Managers define pre-blended "mixes" (a veggie/topping mix, a cheese mix, a
// sauce mix, …) that the floor makes ahead for a given product. Mixes are
// persisted server-side (shared across all signed-in users) and are NOT part of
// the per-day sync payload. Reading is open to any signed-in user (both apps
// build the mix make-day plan); creating, updating and deleting are
// manager-only (the server enforces "manage-inventory").
//
// Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/mixes.ts (replit.md parity).

import { normalizeMixes, type Mix } from "@workspace/mixes";
import { inventoryClientId } from "./inventoryShared";
import { captureIngredientNamesToCatalog } from "./ingredients";

export async function fetchMixes(): Promise<Mix[]> {
  const res = await fetch("/api/mixes", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List mixes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeMixes(data.items);
}

export async function saveMixes(items: Mix[]): Promise<Mix[]> {
  const res = await fetch("/api/mixes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Save mixes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  // Fire-and-forget: any ingredient name newly typed into a mix row joins the
  // factory-wide catalog so it appears in every ingredient suggestion list.
  void captureIngredientNamesToCatalog(
    items.flatMap((m) => (m.components ?? []).map((c) => c.ingredient)),
    "mix",
  );
  return normalizeMixes(data.items);
}

/**
 * Apply a partial mix update without throwing away the rest of the cached pool.
 *
 * Mix Plan's inline "already made" editor sends one mix optimistically while
 * the server write is in flight. It can only update records that are already
 * in the cache; a one-item save must never recreate a concurrently deleted
 * mix or replace the complete factory-wide list.
 */
export function mergeMixUpdates(current: Mix[] | undefined, updates: Mix[]): Mix[] {
  if (!current) return updates;

  const updatesById = new Map(updates.map((item) => [item.id, item]));
  return current.map((item) => updatesById.get(item.id) ?? item);
}

export async function deleteMixes(ids: string[]): Promise<Mix[]> {
  const res = await fetch("/api/mixes", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete mixes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeMixes(data.items);
}
