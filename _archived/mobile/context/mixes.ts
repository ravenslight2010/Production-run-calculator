// Mixes — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/mixes.ts (replit.md
// parity). Managers define pre-blended "mixes" (a veggie/topping mix, a cheese
// mix, a sauce mix, …) made ahead for a given product. Mixes are persisted
// server-side (shared across all signed-in users) and are NOT part of the
// per-day sync payload. Reading is open to any signed-in user (both apps build
// the mix make-day plan); creating, updating and deleting are manager-only (the
// server enforces "manage-inventory"). Mobile has no cookie jar, so the session
// bearer token is attached explicitly to every request.

import { getAuthToken } from "@workspace/api-client-react";
import { normalizeMixes, type Mix } from "@workspace/mixes";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

async function call(path: string, opts?: RequestInit): Promise<Mix[]> {
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
  return normalizeMixes(data.items);
}

export async function fetchMixes(): Promise<Mix[]> {
  return call("/mixes");
}

export async function saveMixes(items: Mix[]): Promise<Mix[]> {
  return call("/mixes", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function deleteMixes(ids: string[]): Promise<Mix[]> {
  return call("/mixes", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}
