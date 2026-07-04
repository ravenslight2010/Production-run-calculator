// Named recipes (Dough & Sauce) — mobile platform glue.
//
// Mirrors the web glue in artifacts/run-calculator/src/namedRecipes.ts
// (replit.md parity). Managers define named dough / sauce recipes (a name plus a
// list of {ingredient, lbs} components) once; they are persisted server-side
// (shared across all signed-in users) and are NOT part of the per-day sync
// payload. Reading is open to any signed-in user (the run form's Dough / Sauce
// cards pick one and hydrate their rows from it); creating, updating and deleting
// are manager-only (the server enforces "manage-inventory"). Dough and sauce are
// their OWN master-data pools; one helper serves both endpoints since they share
// the identical NamedRecipe shape. Mobile has no cookie jar, so the session
// bearer token is attached explicitly to every request.

import { getAuthToken } from "@workspace/api-client-react";
import {
  normalizeNamedRecipes,
  addNamedRecipesIfAbsentByName,
  type NamedRecipe,
} from "@workspace/named-recipes";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";

export type NamedRecipeKind = "dough" | "sauce";

function pathFor(kind: NamedRecipeKind): string {
  return kind === "dough" ? "/dough-recipes" : "/sauce-recipes";
}

async function call(path: string, opts?: RequestInit): Promise<NamedRecipe[]> {
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
  return normalizeNamedRecipes(data.items);
}

export async function fetchNamedRecipes(kind: NamedRecipeKind): Promise<NamedRecipe[]> {
  return call(pathFor(kind));
}

export async function saveNamedRecipes(
  kind: NamedRecipeKind,
  items: NamedRecipe[],
): Promise<NamedRecipe[]> {
  return call(pathFor(kind), { method: "POST", body: JSON.stringify({ items }) });
}

export async function deleteNamedRecipes(
  kind: NamedRecipeKind,
  ids: string[],
): Promise<NamedRecipe[]> {
  return call(pathFor(kind), { method: "DELETE", body: JSON.stringify({ ids }) });
}

// Append recipes to the server pool, skipping any whose name (case-insensitive)
// or id already exists — the "match, don't clobber" rule shared by the one-time
// local→server migration and by spec-import. Reads the current server pool,
// merges additively, and POSTs only when something new was added. Best-effort:
// writes require the manage-inventory role, so a non-manager (or offline device)
// simply no-ops. Returns how many recipes were newly added. Mirrors web.
export async function addNamedRecipesToServerIfAbsent(
  kind: NamedRecipeKind,
  candidates: NamedRecipe[],
): Promise<{ added: number; items: NamedRecipe[] }> {
  const existing = await fetchNamedRecipes(kind);
  const { merged, added } = addNamedRecipesIfAbsentByName(existing, candidates);
  if (added === 0) return { added: 0, items: existing };
  const items = await saveNamedRecipes(kind, merged);
  return { added, items };
}
