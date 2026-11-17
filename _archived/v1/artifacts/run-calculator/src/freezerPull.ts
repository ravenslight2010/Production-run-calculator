// Freezer-pull items — web platform glue.
//
// Managers tag ingredients that must be pulled from the freezer a set number of
// days before the run that uses them. Items are persisted server-side (shared
// across all signed-in users) and are NOT part of the per-day sync payload.
// Reading is open to any signed-in user (both apps build the warehouse pull
// notices); creating, updating and deleting are manager-only (the server
// enforces "manage-inventory").
//
// Mirrors the mobile glue in
// artifacts/run-calculator-mobile/context/freezerPull.ts (replit.md parity).

import {
  normalizeFreezerPullItems,
  type FreezerPullItem,
} from "@workspace/freezer-pull";
import { inventoryClientId } from "./inventoryShared";

export async function fetchFreezerPullItems(): Promise<FreezerPullItem[]> {
  const res = await fetch("/api/freezer-pull-items", {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List freezer-pull items failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeFreezerPullItems(data.items);
}

export async function saveFreezerPullItems(
  items: FreezerPullItem[],
): Promise<FreezerPullItem[]> {
  const res = await fetch("/api/freezer-pull-items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Save freezer-pull items failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeFreezerPullItems(data.items);
}

export async function deleteFreezerPullItems(
  ids: string[],
): Promise<FreezerPullItem[]> {
  const res = await fetch("/api/freezer-pull-items", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete freezer-pull items failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeFreezerPullItems(data.items);
}
