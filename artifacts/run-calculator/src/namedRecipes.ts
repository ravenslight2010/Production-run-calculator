// Named recipes (Dough & Sauce) — web platform glue.
//
// Managers define named dough / sauce recipes (a name plus a list of
// {ingredient, lbs} components) once; they are persisted server-side (shared
// across all signed-in users) and are NOT part of the per-day sync payload.
// Reading is open to any signed-in user (the run form's Dough / Sauce cards pick
// one and hydrate their rows from it); creating, updating and deleting are
// manager-only (the server enforces "manage-inventory").
//
// Works exactly like the Cheese Recipes / Mixes glue (see ./cheeseRecipes.ts) —
// dough and sauce are their OWN master-data pools. One helper serves both
// endpoints (they share the identical NamedRecipe shape). Mirrors the mobile
// glue in artifacts/run-calculator-mobile/context/namedRecipes.ts (replit.md
// parity).

import {
  normalizeNamedRecipes,
  addNamedRecipesIfAbsentByName,
  fillNamedRecipeTags,
  type NamedRecipe,
  type NamedRecipeTag,
} from "@workspace/named-recipes";
import { inventoryClientId } from "./inventoryShared";

export type NamedRecipeKind = "dough" | "sauce";

function endpointFor(kind: NamedRecipeKind): string {
  return kind === "dough" ? "/api/dough-recipes" : "/api/sauce-recipes";
}

export async function fetchNamedRecipes(
  kind: NamedRecipeKind,
): Promise<NamedRecipe[]> {
  const res = await fetch(endpointFor(kind), {
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`List ${kind} recipes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeNamedRecipes(data.items);
}

export async function saveNamedRecipes(
  kind: NamedRecipeKind,
  items: NamedRecipe[],
): Promise<NamedRecipe[]> {
  const res = await fetch(endpointFor(kind), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Save ${kind} recipes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeNamedRecipes(data.items);
}

// Append recipes to the server pool, skipping any whose name (case-insensitive)
// or id already exists — the "match, don't clobber" rule shared by the one-time
// local→server migration and by spec-import. Reads the current server pool,
// merges additively, and POSTs only when something new was added. When a spec
// import learned "who it goes to" brand/flavor tags, they are additively filled
// onto matching EXISTING recipes too (never overriding a manager's different
// brand — see fillNamedRecipeTags), so re-importing a sheet tags recipes that
// were imported before the tags existed. Best-effort by design: writes require
// the manage-inventory role, so a non-manager (or an offline device) simply
// no-ops. Returns how many recipes were newly added.
export async function addNamedRecipesToServerIfAbsent(
  kind: NamedRecipeKind,
  candidates: NamedRecipe[],
  tagsByName?: ReadonlyMap<string, NamedRecipeTag>,
): Promise<{ added: number; items: NamedRecipe[] }> {
  const existing = await fetchNamedRecipes(kind);
  const { merged, added } = addNamedRecipesIfAbsentByName(existing, candidates);
  const tagged =
    tagsByName && tagsByName.size > 0
      ? fillNamedRecipeTags(existing, tagsByName)
      : [];
  if (added === 0 && tagged.length === 0) return { added: 0, items: existing };
  const taggedById = new Map(tagged.map((r) => [r.id, r]));
  const toSave = merged.map((r) => taggedById.get(r.id) ?? r);
  const items = await saveNamedRecipes(kind, toSave);
  return { added, items };
}

export async function deleteNamedRecipes(
  kind: NamedRecipeKind,
  ids: string[],
): Promise<NamedRecipe[]> {
  const res = await fetch(endpointFor(kind), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Delete ${kind} recipes failed (${res.status})`);
  const data = (await res.json()) as { items: unknown };
  return normalizeNamedRecipes(data.items);
}
