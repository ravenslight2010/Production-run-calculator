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
  upsertNamedRecipesByName,
  fillNamedRecipeTags,
  fillNamedRecipeDoughballWeights,
  fillNamedRecipeDoughballsPerTray,
  mergeNamedRecipeDoughballVariants,
  type DoughballVariant,
  type NamedRecipe,
  type NamedRecipeTag,
} from "@workspace/named-recipes";
import {
  findSpecImportNamedRecipeFamilyMatch,
  specImportDoughFormulasConflict,
} from "@workspace/spec-import";
import { inventoryClientId } from "./inventoryShared";
import { captureIngredientNamesToCatalog } from "./ingredients";

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
  // Fire-and-forget: newly typed component names join the factory-wide
  // ingredient catalog so every suggestion list sees them.
  void captureIngredientNamesToCatalog(
    items.flatMap((r) => (r.components ?? []).map((c) => c.ingredient)),
    kind === "dough" ? "dough" : "frontline",
  );
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
  variantsByName?: ReadonlyMap<string, ReadonlyArray<DoughballVariant>>,
  options?: {
    /**
     * When true, matched existing recipes have their components and numeric
     * doughball fields updated from the candidate (upsert semantics).  When
     * false/absent the old "add-if-absent" behaviour is preserved.
     */
    upsertComponents?: boolean;
    /**
     * When true, the doughball variants list for each matched recipe is
     * REPLACED by the incoming list (replace semantics) instead of being
     * merged additively. Use for spec re-imports so renamed variants
     * ("Bashas Ultra Thin" → "Craft Bashas Ultra Thin") remove the old entry
     * rather than accumulating both in the pool.
     */
    replaceVariants?: boolean;
  },
): Promise<{ added: number; updated: number; items: NamedRecipe[] }> {
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
  // Bug 2 fix: when a candidate is family-collapsed onto a pool recipe with a
  // DIFFERENT name (e.g. parse produced "Craft CRB" but pool has "CRB Dough"),
  // the variantsByName key is the PARSE name, not the pool name. Collect the
  // mapping so we can remap variant lookups to the pool recipe name below.
  const variantKeyRemap = new Map<string, string>(); // candKey → familyKey
  for (const c of candidates) {
    const family = findSpecImportNamedRecipeFamilyMatch(kind, c.name ?? "", existingNames);
    if (family === null) {
      filtered.push(c);
      continue;
    }
    // Formula guard (dough only): a candidate carrying its OWN components must
    // never be dropped onto a family recipe whose ingredients differ — a
    // family-looking NAME over a different formula ("Masa Dough (Lowes
    // Natural)" vs "Masa Dough") is its own recipe, not a variant.
    if (kind === "dough") {
      const familyEntry = existing.find((r) => r.name === family);
      if (
        specImportDoughFormulasConflict(
          (c.components ?? []).map((x) => ({ ingredient: x.ingredient })),
          (familyEntry?.components ?? []).map((x) => ({ ingredient: x.ingredient })),
        )
      ) {
        filtered.push(c);
        continue;
      }
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
    // Collect variant key remap for mismatched parse vs pool names.
    if (kind === "dough" && familyKey !== candKey && variantsByName?.has(candKey)) {
      variantKeyRemap.set(candKey, familyKey);
    }
  }
  // Build effectiveVariants: a copy of variantsByName with any parse-name keys
  // that were family-collapsed also registered under the pool recipe name.
  // Without this remap, mergeNamedRecipeDoughballVariants would look up pool
  // recipe names in the map and find nothing (key mismatch → customers never set).
  let effectiveVariants = variantsByName;
  if (kind === "dough" && variantsByName && variantKeyRemap.size > 0) {
    const remapped = new Map<string, ReadonlyArray<DoughballVariant>>(variantsByName);
    for (const [candKey, familyKey] of variantKeyRemap) {
      const candVariants = variantsByName.get(candKey)!;
      if (!remapped.has(familyKey)) {
        remapped.set(familyKey, candVariants);
      } else {
        // Union: merge incoming onto existing (don't clobber existing entries)
        const cur = [...remapped.get(familyKey)!];
        const curLabels = new Set(cur.map((v) => v.label.toLowerCase()));
        for (const v of candVariants) {
          if (!curLabels.has(v.label.toLowerCase())) cur.push(v);
        }
        remapped.set(familyKey, cur);
      }
    }
    effectiveVariants = remapped;
  }
  const mergeResult = options?.upsertComponents
    ? upsertNamedRecipesByName(existing, filtered)
    : { ...addNamedRecipesIfAbsentByName(existing, filtered), updated: 0 };
  const { merged, added, updated } = mergeResult;
  // When upsertComponents is active, `merged` already carries the updated
  // components for existing recipes — use it as the base for the overlay chain
  // so tag/weight/tray fills layer on top of the NEW components, not on top of
  // the pre-upsert snapshot (`existing`). When not upserting, use `existing` as
  // before (new additions in `merged` are folded in via existingChainById below).
  const overlayBase = options?.upsertComponents ? merged : existing;
  const tagged =
    tagsByName && tagsByName.size > 0
      ? fillNamedRecipeTags(overlayBase, tagsByName)
      : [];
  // Dough only: backfill learned doughball weights onto EXISTING pool recipes
  // whose weight is still unset (never overriding a manager's explicit value).
  const afterTags =
    tagged.length > 0
      ? overlayBase.map((r) => tagged.find((t) => t.id === r.id) ?? r)
      : overlayBase;
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
  const afterTrays =
    trayed.length > 0
      ? afterWeights.map((r) => trayed.find((t) => t.id === r.id) ?? r)
      : afterWeights;
  // Dough only: additively merge learned per-VARIANT doughball numbers
  // ("11\" CRB" → weight/tray) into the family recipe's variants list.
  // When upsertComponents is active, afterTrays is already based on `merged`
  // (complete list = updated-existing + new additions), so mergedCurrent IS
  // afterTrays. When not upserting, afterTrays is based on `existing` and we
  // overlay it onto `merged` to re-introduce new additions.
  const existingChainById = new Map(afterTrays.map((r) => [r.id, r]));
  const mergedCurrent = options?.upsertComponents
    ? afterTrays
    : merged.map((r) => existingChainById.get(r.id) ?? r);
  const varied =
    kind === "dough" && (effectiveVariants?.size ?? 0) > 0
      ? mergeNamedRecipeDoughballVariants(mergedCurrent, effectiveVariants!, { replace: options?.replaceVariants })
      : [];
  if (
    added === 0 &&
    updated === 0 &&
    tagged.length === 0 &&
    weighted.length === 0 &&
    trayed.length === 0 &&
    varied.length === 0
  )
    return { added: 0, updated: 0, items: existing };
  const variedById = new Map(varied.map((r) => [r.id, r]));
  const toSave = mergedCurrent.map((r) => variedById.get(r.id) ?? r);
  const items = await saveNamedRecipes(kind, toSave);
  return { added, updated, items };
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
