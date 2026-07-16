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
  fillNamedRecipeDoughballWeights,
  fillNamedRecipeDoughballsPerTray,
  type NamedRecipe,
  type NamedRecipeTag,
} from "@workspace/named-recipes";
import { findSpecImportNamedRecipeFamilyMatch } from "@workspace/spec-import";
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
  weightsByName?: ReadonlyMap<string, number>,
  traysByName?: ReadonlyMap<string, number>,
): Promise<{ added: number; items: NamedRecipe[] }> {
  const existing = await fetchNamedRecipes(kind);
  // Family guard — the last line of defense for EVERY pool write path (spec
  // import, local→server migration/push): a candidate whose name is only a
  // variant of an existing pool recipe ("Thick CRB recipe" vs "CRB Dough",
  // "Lucia's" vs "Lucia Pizza Sauce") must NEVER mint a duplicate. Import-side
  // link passes normally catch these; this guard catches anything that slips
  // through (e.g. stale local presets pushed wholesale).
  const existingNames = existing.map((r) => r.name);
  const filtered: NamedRecipe[] = [];
  // A dropped variant's learned doughball weight must not be stranded — remap
  // it onto the family recipe it collapsed into (fills only unset weights).
  const remappedWeights = new Map<string, number>(weightsByName ?? []);
  const remappedTrays = new Map<string, number>(traysByName ?? []);
  for (const c of candidates) {
    const family = findSpecImportNamedRecipeFamilyMatch(kind, c.name ?? "", existingNames);
    if (family === null) {
      filtered.push(c);
      continue;
    }
    const familyKey = family.trim().toLowerCase();
    const candKey = (c.name ?? "").trim().toLowerCase();
    const oz = c.doughballWeightOz ?? weightsByName?.get(candKey) ?? 0;
    if (kind === "dough" && oz > 0 && !remappedWeights.has(familyKey)) {
      remappedWeights.set(familyKey, oz);
    }
    const perTray = c.doughballsPerTray ?? traysByName?.get(candKey) ?? 0;
    if (kind === "dough" && perTray > 0 && !remappedTrays.has(familyKey)) {
      remappedTrays.set(familyKey, perTray);
    }
  }
  const { merged, added } = addNamedRecipesIfAbsentByName(existing, filtered);
  const tagged =
    tagsByName && tagsByName.size > 0
      ? fillNamedRecipeTags(existing, tagsByName)
      : [];
  // Dough only: backfill learned doughball weights onto EXISTING pool recipes
  // whose weight is still unset (never overriding a manager's explicit value).
  const afterTags =
    tagged.length > 0
      ? existing.map((r) => tagged.find((t) => t.id === r.id) ?? r)
      : existing;
  const weighted =
    kind === "dough" && remappedWeights.size > 0
      ? fillNamedRecipeDoughballWeights(afterTags, remappedWeights)
      : [];
  // Dough only: same unset-only backfill for learned doughballs-per-tray.
  const afterWeights =
    weighted.length > 0
      ? afterTags.map((r) => weighted.find((w) => w.id === r.id) ?? r)
      : afterTags;
  const trayed =
    kind === "dough" && remappedTrays.size > 0
      ? fillNamedRecipeDoughballsPerTray(afterWeights, remappedTrays)
      : [];
  if (added === 0 && tagged.length === 0 && weighted.length === 0 && trayed.length === 0)
    return { added: 0, items: existing };
  const changedById = new Map<string, NamedRecipe>();
  for (const r of tagged) changedById.set(r.id, r);
  for (const r of weighted) changedById.set(r.id, r);
  for (const r of trayed) changedById.set(r.id, r);
  const toSave = merged.map((r) => changedById.get(r.id) ?? r);
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
