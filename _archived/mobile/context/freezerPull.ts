// Freezer-pull items — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/freezerPull.ts
// (replit.md parity). Managers tag ingredients that must be pulled from the
// freezer a set number of days before the run that uses them. Items are
// persisted server-side (shared across all signed-in users) and are NOT part of
// the per-day sync payload. Reading is open to any signed-in user; creating,
// updating and deleting are manager-only (the server enforces "manage-inventory").
// Mobile has no cookie jar, so the session bearer token is attached explicitly
// to every request.

import { getAuthToken } from "@workspace/api-client-react";
import {
  normalizeFreezerPullItems,
  type FreezerPullItem,
} from "@workspace/freezer-pull";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

async function call(path: string, opts?: RequestInit): Promise<FreezerPullItem[]> {
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
  return normalizeFreezerPullItems(data.items);
}

export async function fetchFreezerPullItems(): Promise<FreezerPullItem[]> {
  return call("/freezer-pull-items");
}

export async function saveFreezerPullItems(
  items: FreezerPullItem[],
): Promise<FreezerPullItem[]> {
  return call("/freezer-pull-items", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function deleteFreezerPullItems(
  ids: string[],
): Promise<FreezerPullItem[]> {
  return call("/freezer-pull-items", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}
