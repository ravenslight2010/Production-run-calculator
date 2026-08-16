// Shared "mixes" model for the run calculator (web + mobile parity).
//
// A "mix" is a pre-blended recipe (a veggie/topping mix, a cheese mix, a dough
// mix, a sauce mix, …) that the floor makes ahead of time for a given product.
// Each mix names the product it belongs to (brand + flavor, so it can be matched
// against scheduled runs), a batch size (lbs per batch), an optional "make N days
// early" value, optional notes, an optional "amount already made", and a list of
// components — each an ingredient with a "per pizza" weight in OUNCES.
//
// Given a chosen make-day and that day's resolved scheduled runs (product +
// pizzas), this module computes, per run/product, how many batches to make, the
// total pounds needed, and a "Pull For Mix" breakdown of pounds per component
// (pounds = perPizza-ounces × that day's pizzas ÷ 16). It honors the "amount already made"
// (which reduces the remaining pounds and therefore the batch count) and the
// "make N days early" window (mirroring how the freezer-pull window works).
//
// This module is PURE so both apps compute the same plan. Mix definitions are
// stored factory-wide on the server (NOT in the per-day sync payload) and edited
// by managers only; this module only models the config and builds the plan from
// already-resolved per-run pizza counts. Each app resolves a scheduled run ->
// pizzas using its own existing profile/calc code, then feeds {date, brand,
// flavor, pizzas, cases} rows in here. The match key is brand + flavor (case-
// insensitive), the same join key the schedule uses, so web and mobile line up
// exactly. Advisory only — this never moves stock.

import {
  brandPrefixedName,
  buildNearDupNameMatcher,
  looseNameKey,
} from "@workspace/name-match";

// Mixes are made same-day by default; a manager can opt a mix into being made
// ahead by giving it a positive "make N days early" value.
export const DEFAULT_DAYS_EARLY = 0;

// One component of a mix: an ingredient and how many OUNCES of it go into a
// single pizza's worth of the finished mix (this matches the "Per Pizza" column
// on the premix spec sheets, which is in ounces). Batch/total weights below are
// in pounds, so plan math converts ounces → pounds by dividing by 16.
export interface MixComponent {
  ingredient: string;
  /** Ounces of this ingredient per pizza — drives all make-day math. */
  perPizza: number;
  /**
   * Pounds of this ingredient in one BATCH of the mix (manager-entered
   * reference, e.g. from a batch recipe card). Display/record only — the plan
   * math scales from `perPizza`. Absent/0 = not recorded.
   */
  perBatchLbs?: number;
}

// Ounces in a pound — per-pizza component weights are in ounces while batch
// sizes and totals are in pounds, so the plan converts between them.
export const OZ_PER_LB = 16;

// A single manager-defined mix. Flat shape (plus a components array) so it
// serializes cleanly to the API/DB and is easy to edit field-by-field in the UI.
export interface Mix {
  id: string;
  // Optional persistence scope (live vs sandbox); carried through opaquely.
  scope?: string;
  // Display name of the mix (e.g. "Bobo's Deluxe Veggie Mix").
  name: string;
  // The product this mix belongs to, matched case-insensitively against a
  // scheduled run's brand/flavor. An empty flavor matches runs with no flavor.
  brand: string;
  flavor: string;
  // Pounds of finished mix per batch. Used to turn total pounds into a batch
  // count. <= 0 means "batch count not applicable" (pounds only).
  batchSize: number;
  // How many days before the run this mix may be made ahead (default 0 =
  // same-day). A run is included on the chosen make-day when
  // 0 <= daysUntil(run) <= daysEarly.
  daysEarly: number;
  // Free-form notes (e.g. "Pull 2 days early", "Mix cold").
  notes?: string;
  // Pounds already made/on hand, subtracted from the total before computing the
  // remaining pounds and batch count.
  amountAlreadyMade: number;
  // The ingredients that make up the mix.
  components: MixComponent[];
  // Disabled mixes are kept (so toggling is easy) but never produce a plan entry.
  enabled: boolean;
  // When true, this mix is a prep recipe. It appears in the plan for any run
  // whose profile includes any of this mix's component ingredient names.
  // Brand/flavor matching is skipped for prep mixes.
  isPrep?: boolean;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function coerceInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function coerceNum(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return n;
}

// Coerce a raw value into a clean component, or null if it has no usable
// ingredient name. perPizza defaults to 0 and is clamped to >= 0.
export function normalizeMixComponent(input: unknown): MixComponent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const ingredient =
    typeof raw.ingredient === "string" ? raw.ingredient.trim() : "";
  if (!ingredient) return null;
  const perPizza = Math.max(0, coerceNum(raw.perPizza, 0));
  const perBatchLbs = Math.max(0, coerceNum(raw.perBatchLbs, 0));
  const out: MixComponent = { ingredient, perPizza };
  if (perBatchLbs > 0) out.perBatchLbs = perBatchLbs;
  return out;
}

// Coerce a raw API/DB record into a clean Mix, or null if it has no usable name.
// Numeric fields are clamped to >= 0; daysEarly defaults to 0; enabled defaults
// to true; malformed components are dropped.
export function normalizeMix(input: unknown): Mix | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id : name.toLowerCase();
  const brand = typeof raw.brand === "string" ? raw.brand.trim() : "";
  const flavor = typeof raw.flavor === "string" ? raw.flavor.trim() : "";
  const batchSize = Math.max(0, coerceNum(raw.batchSize, 0));
  const daysEarly = Math.max(0, coerceInt(raw.daysEarly, DEFAULT_DAYS_EARLY));
  const amountAlreadyMade = Math.max(0, coerceNum(raw.amountAlreadyMade, 0));
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false;
  const components = Array.isArray(raw.components)
    ? raw.components
        .map(normalizeMixComponent)
        .filter((c): c is MixComponent => c !== null)
    : [];
  const mix: Mix = {
    id,
    name,
    brand,
    flavor,
    batchSize,
    daysEarly,
    amountAlreadyMade,
    components,
    enabled,
  };
  if (typeof raw.notes === "string" && raw.notes.trim()) mix.notes = raw.notes.trim();
  if (typeof raw.scope === "string" && raw.scope) mix.scope = raw.scope;
  if (raw.isPrep === true) mix.isPrep = true;
  return mix;
}

// Normalize a list, dropping malformed entries and collapsing duplicate ids onto
// the last-seen entry.
export function normalizeMixes(input: unknown): Mix[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, Mix>();
  for (const raw of input) {
    const mix = normalizeMix(raw);
    if (!mix) continue;
    byId.set(mix.id, mix);
  }
  return Array.from(byId.values());
}

// ---------------------------------------------------------------------------
// Brand / flavor merge re-pointing
// ---------------------------------------------------------------------------
//
// Mixes are brand+flavor-keyed server master-data (NOT part of day-state sync),
// so a brand or flavor merge in the Merge tool won't touch them. These pure
// helpers re-point the affected mixes so they stop naming a merged-away brand or
// flavor. Both return ONLY the changed mixes (the server upserts by id), matched
// case-insensitively.

/** Re-point mixes whose brand is one of the merged-away sources onto the target. */
export function repointMixesForBrandMerge(
  mixes: ReadonlyArray<Mix>,
  sources: ReadonlyArray<string>,
  target: string,
): Mix[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: Mix[] = [];
  for (const m of mixes) {
    if (srcSet.has(m.brand.trim().toLowerCase())) changed.push({ ...m, brand: tgt });
  }
  return changed;
}

/**
 * Rename one brand group in the mixes pool (Manage Lists "rename / merge
 * brand" control). Every mix whose brand matches `from` (case-insensitive)
 * is rewritten to `to`. Unlike the merge repoint helper this ALLOWS a
 * case-only respelling ("aldos" → "Aldo's"); renaming to another existing
 * brand's name merges the groups (grouping is case-insensitive). Returns
 * only the changed rows. Pure.
 */
export function renameMixesBrand(
  mixes: ReadonlyArray<Mix>,
  from: string,
  to: string,
): Mix[] {
  const tgt = to.trim();
  const fromKey = from.trim().toLowerCase();
  if (!tgt || !fromKey || from.trim() === tgt) return [];
  const changed: Mix[] = [];
  for (const m of mixes) {
    if (m.brand.trim().toLowerCase() === fromKey && m.brand.trim() !== tgt) {
      changed.push({ ...m, brand: tgt });
    }
  }
  return changed;
}

/**
 * Re-point mixes when flavors are merged WITHIN a brand. Only mixes of that
 * brand whose flavor is a merged-away source are rewritten to the target.
 */
export function repointMixesForFlavorMerge(
  mixes: ReadonlyArray<Mix>,
  brand: string,
  sources: ReadonlyArray<string>,
  target: string,
): Mix[] {
  const b = brand.trim().toLowerCase();
  const tgt = target.trim();
  if (!b || !tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: Mix[] = [];
  for (const m of mixes) {
    if (m.brand.trim().toLowerCase() !== b) continue;
    if (srcSet.has(m.flavor.trim().toLowerCase())) changed.push({ ...m, flavor: tgt });
  }
  return changed;
}

/**
 * Re-point mix COMPONENT ingredient names when an ingredient is merged in the
 * Merge tool. Mixes are server-backed master-data (NOT part of day-state sync),
 * so an ingredient merge — which only rewrites local lists/presets/runs — leaves
 * the server mixes naming the merged-away ingredient, and it resurfaces in the
 * mix plan / Pull-For-Mix lbs. Rewrites each matching component's `ingredient`
 * to the target; rows are NOT combined (both are kept so the mix's per-pizza
 * math is preserved exactly, mirroring mergeRecipeRows). Returns ONLY the mixes
 * that changed, matched case-insensitively.
 */
export function repointMixIngredients(
  mixes: ReadonlyArray<Mix>,
  sources: ReadonlyArray<string>,
  target: string,
): Mix[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: Mix[] = [];
  for (const m of mixes) {
    if (!m.components.some((c) => srcSet.has(c.ingredient.trim().toLowerCase())))
      continue;
    changed.push({
      ...m,
      components: m.components.map((c) =>
        srcSet.has(c.ingredient.trim().toLowerCase())
          ? { ...c, ingredient: tgt }
          : c,
      ),
    });
  }
  return changed;
}

// Loose ingredient-name key for lining up component rows in a merge backfill:
// lowercase, split on non-alphanumerics, tokens sorted then joined (word
// reorder like "Pepperoni, Diced" vs "Diced Pepperoni" folds).
function looseMergeIngredientKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length >= 4 ? t.replace(/s$/, "") : t))
    .sort()
    .join("");
}

/**
 * Backfill a merge TARGET mix from the mixes being merged away, BEFORE the
 * sources are deleted from the server pool. Blank-fill-only: real data on the
 * target is never clobbered — sources only fill gaps. Component rows are
 * matched by loose ingredient name (perPizza / perBatchLbs filled only where
 * the target has none; source-only rows appended); brand / flavor / notes fill
 * only when blank; batchSize / daysEarly / amountAlreadyMade fill only when 0.
 * Sources fold in order. Returns the enriched mix, or null when nothing
 * changed. Pure.
 */
export function backfillMixFromMergedSources(
  target: Mix,
  sources: ReadonlyArray<Mix>,
): Mix | null {
  let changed = false;
  const next: Mix = {
    ...target,
    components: target.components.map((c) => ({ ...c })),
  };
  for (const src of sources) {
    if (!next.brand.trim() && src.brand.trim()) {
      next.brand = src.brand;
      changed = true;
    }
    if (!next.flavor.trim() && src.flavor.trim()) {
      next.flavor = src.flavor;
      changed = true;
    }
    if (!(next.batchSize > 0) && src.batchSize > 0) {
      next.batchSize = src.batchSize;
      changed = true;
    }
    if (!(next.daysEarly > 0) && src.daysEarly > 0) {
      next.daysEarly = src.daysEarly;
      changed = true;
    }
    if (!(next.amountAlreadyMade > 0) && src.amountAlreadyMade > 0) {
      next.amountAlreadyMade = src.amountAlreadyMade;
      changed = true;
    }
    if (!(next.notes ?? "").trim() && (src.notes ?? "").trim()) {
      next.notes = src.notes;
      changed = true;
    }
    if (!next.isPrep && src.isPrep) {
      next.isPrep = true;
      changed = true;
    }
    const byKey = new Map<string, MixComponent>();
    for (const c of next.components) {
      const key = looseMergeIngredientKey(c.ingredient);
      if (key && !byKey.has(key)) byKey.set(key, c);
    }
    for (const sc of src.components) {
      const key = looseMergeIngredientKey(sc.ingredient);
      if (!key) continue;
      const tc = byKey.get(key);
      if (!tc) {
        const added: MixComponent = { ingredient: sc.ingredient, perPizza: sc.perPizza };
        if ((sc.perBatchLbs ?? 0) > 0) added.perBatchLbs = sc.perBatchLbs;
        next.components.push(added);
        byKey.set(key, added);
        changed = true;
        continue;
      }
      if (!(tc.perPizza > 0) && sc.perPizza > 0) {
        tc.perPizza = sc.perPizza;
        changed = true;
      }
      if (!((tc.perBatchLbs ?? 0) > 0) && (sc.perBatchLbs ?? 0) > 0) {
        tc.perBatchLbs = sc.perBatchLbs;
        changed = true;
      }
    }
  }
  return changed ? next : null;
}

/**
 * Add spec-import-detected mixes to the existing list, skipping any whose name
 * already exists (case-insensitive). A spec sheet can only supply a mix's
 * ingredient NAMES (per-pizza amount and batch size come in blank), so this
 * only ADDS mixes the manager doesn't already keep — it never clobbers an
 * existing hand-made or premix-imported mix's real amounts with blanks, and
 * never produces a duplicate of it. Pure. Returns the merged list plus how many
 * mixes were actually added.
 */
// Loose match key: the shared @workspace/name-match normalization (lowercase,
// drop apostrophes/quotes, fold other punctuation to a single space, drop
// generic "standard"/"regular"/"pizza" filler tokens). An imported mix that
// differs from an existing one only in case / punctuation / spacing / a filler
// word ("Aldo's Cheese Mix" vs "Aldo's Standard Cheese Mix") links to the mix
// the manager already keeps instead of creating a duplicate.
function mixNameMatchKey(name: string): string {
  return looseNameKey(name);
}

export function addSpecMixesIfAbsent(
  existing: ReadonlyArray<Mix>,
  candidates: ReadonlyArray<Mix>,
): { merged: Mix[]; added: number } {
  // Near-dup layers (word order / single typo, each with ambiguity + digit
  // guards) catch workbook label drift the loose key alone misses, so a
  // re-import doesn't fork a parallel mix. The extra-word layer stays OFF:
  // "Spicy Cheese Mix" is a distinct mix, not "Cheese Mix".
  //
  // BRAND SCOPE: a duplicate only counts within the candidate's brand scope —
  // same brand, or an unbranded pool mix (shared master-data any brand may link
  // to). A branded candidate whose name collides only with a DIFFERENT brand's
  // mix is a different customer's mix that happens to share a generic name
  // ("Taco Mix"): it is added under an idempotent brand-prefixed name
  // ("Lucia's Taco Mix") so both survive, and a re-import of the same workbook
  // matches its own prefixed row and skips. Matchers are built ONCE per brand
  // scope (never per candidate) to keep large imports linear.
  const brandKeyOf = (m: { brand?: string }) => (m.brand ?? "").trim().toLowerCase();
  // Loose keys per brand scope ("" = unbranded pool mixes).
  const scopeNames = new Map<string, Set<string>>();
  const allNames = new Set<string>();
  for (const m of existing) {
    const k = mixNameMatchKey(m.name);
    if (!k) continue;
    const b = brandKeyOf(m);
    let set = scopeNames.get(b);
    if (!set) scopeNames.set(b, (set = new Set()));
    set.add(k);
    allNames.add(k);
  }
  const matchAll = buildNearDupNameMatcher(existing.map((m) => m.name));
  const scopedMatcherCache = new Map<string, (name: string) => string | null>();
  const matcherFor = (brand: string) => {
    let m = scopedMatcherCache.get(brand);
    if (!m) {
      const pool = brand
        ? existing.filter((x) => {
            const b = brandKeyOf(x);
            return b === "" || b === brand;
          })
        : existing;
      m = buildNearDupNameMatcher(pool.map((x) => x.name));
      scopedMatcherCache.set(brand, m);
    }
    return m;
  };
  const merged: Mix[] = [...existing];
  let added = 0;
  for (const c of candidates) {
    let name = c.name.trim();
    let key = mixNameMatchKey(name);
    if (!key) continue;
    const brand = brandKeyOf(c);
    // Loose keys seen in this candidate's scope (unbranded candidates match
    // everything, mirroring the pre-brand-scope behavior).
    const seenInScope = (k: string) =>
      brand === ""
        ? allNames.has(k)
        : (scopeNames.get("")?.has(k) ?? false) || (scopeNames.get(brand)?.has(k) ?? false);
    // Same-scope duplicate (exact loose key or near-dup) → link, never add.
    if (seenInScope(key) || matcherFor(brand)(name) !== null) continue;
    if (brand !== "" && (allNames.has(key) || matchAll(name) !== null)) {
      // Cross-brand-only collision on a branded candidate: keep both apart by
      // prefixing the new mix with its brand.
      const prefixed = brandPrefixedName((c.brand ?? "").trim(), name);
      const prefixedKey = mixNameMatchKey(prefixed);
      if (prefixedKey === key) continue; // already brand-prefixed yet still colliding — treat as dup
      // Re-import: the prefixed mix already exists in this brand's scope.
      if (seenInScope(prefixedKey) || matcherFor(brand)(prefixed) !== null) continue;
      name = prefixed;
      key = prefixedKey;
    }
    let set = scopeNames.get(brand);
    if (!set) scopeNames.set(brand, (set = new Set()));
    set.add(key);
    allNames.add(key);
    merged.push(name === c.name ? c : { ...c, name });
    added++;
  }
  return { merged, added };
}

/**
 * Convert a cheese-pool recipe into a Mix (the manager "Move to Mixes" action
 * for blends the spec importer misfiled under Cheese — e.g. a meat/gravy blend
 * with no cheese in it). Mix components are PER-PIZZA OUNCES, so only the
 * cheese components' `ozPerPizza` values carry over (spec-import cheese drafts
 * hold their amounts there with lbs=0, making this conversion unit-safe);
 * per-BATCH `lbs` never carries into a Mix — callers should warn first when
 * any component has lbs > 0 (see cheeseComponentsHaveBatchLbs). Brand, notes
 * and enabled state carry over; a Mix has a single flavor, so the first flavor
 * becomes the mix's flavor and any extra flavors are preserved in the notes.
 * The id is minted in its own namespace so it can never collide with an
 * existing mix id. Structural input (no dep on @workspace/cheese-recipes).
 * Pure.
 */
export function mixFromCheeseRecipe(recipe: {
  id: string;
  name: string;
  brand: string;
  flavors: ReadonlyArray<string>;
  notes?: string;
  components: ReadonlyArray<{
    ingredient: string;
    lbs?: number;
    ozPerPizza?: number;
  }>;
  enabled?: boolean;
}): Mix | null {
  const name = recipe.name.trim();
  if (!name) return null;
  const flavors = recipe.flavors.map((f) => f.trim()).filter(Boolean);
  const noteParts: string[] = [];
  if ((recipe.notes ?? "").trim()) noteParts.push((recipe.notes ?? "").trim());
  if (flavors.length > 1) {
    noteParts.push(`Also used on: ${flavors.slice(1).join(", ")}`);
  }
  return normalizeMix({
    id: `mix:from-cheese:${recipe.id}`,
    name,
    brand: recipe.brand,
    flavor: flavors[0] ?? "",
    batchSize: 0,
    daysEarly: 0,
    amountAlreadyMade: 0,
    notes: noteParts.join(" — "),
    components: recipe.components.map((c) => ({
      ingredient: c.ingredient,
      perPizza: c.ozPerPizza ?? 0,
    })),
    enabled: recipe.enabled !== false,
  });
}

/**
 * Whether any component carries per-BATCH pounds — data that canNOT carry into
 * a Mix (mixes are per-pizza oz). Used to warn before "Move to Mixes". Pure.
 */
export function cheeseComponentsHaveBatchLbs(
  components: ReadonlyArray<{ lbs?: number }>,
): boolean {
  return components.some((c) => (c.lbs ?? 0) > 0);
}

/**
 * Backfill product tags onto existing mixes that have NO brand yet, from
 * spec-import candidates matched by the shared loose mix name key. Only fully
 * unbranded mixes are touched (a mix already scoped to a product is never
 * re-scoped), and only from a candidate that actually carries a brand. Pure.
 * Returns the next list plus how many mixes were tagged.
 */
export function fillSpecMixTags(
  existing: ReadonlyArray<Mix>,
  candidates: ReadonlyArray<{ name: string; brand: string; flavor: string }>,
): { next: Mix[]; tagged: number } {
  const byKey = new Map<string, { brand: string; flavor: string }>();
  for (const c of candidates) {
    const key = mixNameMatchKey(c.name);
    const brand = c.brand.trim();
    if (!key || !brand || byKey.has(key)) continue;
    byKey.set(key, { brand, flavor: c.flavor.trim() });
  }
  let tagged = 0;
  const next = existing.map((m) => {
    if ((m.brand ?? "").trim()) return m;
    const c = byKey.get(mixNameMatchKey(m.name));
    if (!c) return m;
    tagged++;
    return { ...m, brand: c.brand, flavor: c.flavor };
  });
  return { next, tagged };
}

/**
 * Backfill per-pizza oz amounts onto already-saved mixes from a new spec-import
 * batch. For each update that matches an existing mix by NAME and BRAND SCOPE,
 * fill in any component whose `perPizza` is currently 0 with the incoming
 * value. Components that already have a nonzero `perPizza` are NEVER touched —
 * the app has no provenance field to distinguish a manager-typed value from a
 * prior import, so the rule is: nonzero wins and is never overwritten. Only
 * updates with perPizza > 0 are applied; zeros are ignored.
 *
 * Brand-scope rule (mirrors addSpecMixesIfAbsent): a branded update only
 * matches existing mixes with the SAME brand (case-insensitive). An unbranded
 * update only matches existing mixes that are also unbranded. This prevents a
 * spec import for one customer from altering same-named mixes owned by a
 * different customer. Pure. Returns the next list plus how many mixes had at
 * least one component's perPizza filled in.
 */
export function applyMixPerPizza(
  existing: ReadonlyArray<Mix>,
  updates: ReadonlyArray<{
    name: string;
    brand?: string;
    components: ReadonlyArray<{ ingredient: string; perPizza: number }>;
  }>,
): { next: Mix[]; updated: number } {
  // Key: "<brandLower>\0<nameMixKey>" → ingredient-name-lower → oz
  const byBrandName = new Map<string, Map<string, number>>();
  for (const u of updates) {
    const nameKey = mixNameMatchKey(u.name);
    if (!nameKey) continue;
    const brandKey = (u.brand ?? "").trim().toLowerCase();
    const mapKey = `${brandKey}\0${nameKey}`;
    if (byBrandName.has(mapKey)) continue; // first update wins
    const oz = new Map<string, number>();
    for (const c of u.components) {
      const ing = c.ingredient.trim().toLowerCase();
      const v = Number(c.perPizza);
      if (!ing || !Number.isFinite(v) || v <= 0) continue;
      if (!oz.has(ing)) oz.set(ing, v);
    }
    if (oz.size) byBrandName.set(mapKey, oz);
  }
  if (!byBrandName.size) return { next: [...existing], updated: 0 };
  let updated = 0;
  const next = existing.map((m) => {
    const brandKey = (m.brand ?? "").trim().toLowerCase();
    const nameKey = mixNameMatchKey(m.name);
    const oz = byBrandName.get(`${brandKey}\0${nameKey}`);
    if (!oz) return m;
    let changed = false;
    const components = m.components.map((c) => {
      // Never overwrite a nonzero value — no provenance to distinguish manager
      // entry from a prior import; preserve whatever is already there.
      if (c.perPizza !== 0) return c;
      const v = oz.get(c.ingredient.trim().toLowerCase());
      if (v === undefined) return c;
      changed = true;
      return { ...c, perPizza: v };
    });
    if (!changed) return m;
    updated++;
    return { ...m, components };
  });
  return { next, updated };
}

/**
 * Find ingredient rows present in `updates` but MISSING from the matched
 * existing mix — i.e. new ingredients the spec sheet added to a mix the
 * manager already keeps. Only fires on mixes that MATCH by name + brand scope
 * (new mixes in `updates` are handled by addSpecMixesIfAbsent, not here).
 * Includes any row with a non-blank ingredient name, regardless of perPizza
 * value — a new ingredient with a missing/zero oz-per-pizza is still visible
 * so the manager can fill it in the Mixes editor after accepting.
 *
 * Brand-scope rule mirrors applyMixPerPizza: a branded update only matches
 * existing mixes of the same brand; unbranded matches unbranded only.
 * Pure. Returns one entry per affected mix.
 */
export function detectNewMixComponents(
  existing: ReadonlyArray<Mix>,
  updates: ReadonlyArray<{
    name: string;
    brand?: string;
    components: ReadonlyArray<{ ingredient: string; perPizza: number }>;
  }>,
): Array<{ mixName: string; brand: string; newComponents: MixComponent[] }> {
  const result: Array<{ mixName: string; brand: string; newComponents: MixComponent[] }> = [];
  for (const u of updates) {
    const nameKey = mixNameMatchKey(u.name);
    if (!nameKey) continue;
    const brandKey = (u.brand ?? "").trim().toLowerCase();
    const matched = existing.find(
      (m) =>
        (m.brand ?? "").trim().toLowerCase() === brandKey &&
        mixNameMatchKey(m.name) === nameKey,
    );
    if (!matched) continue; // no existing mix → addSpecMixesIfAbsent's territory
    const existingIngKeys = new Set(
      matched.components.map((c) => c.ingredient.trim().toLowerCase()),
    );
    const newComponents: MixComponent[] = [];
    const seenNew = new Set<string>();
    for (const c of u.components) {
      const ing = (c.ingredient ?? "").trim();
      if (!ing) continue;
      const ingKey = ing.toLowerCase();
      if (existingIngKeys.has(ingKey)) continue;
      if (seenNew.has(ingKey)) continue;
      seenNew.add(ingKey);
      const v = Number(c.perPizza);
      newComponents.push({ ingredient: ing, perPizza: Number.isFinite(v) ? Math.max(0, v) : 0 });
    }
    if (newComponents.length > 0) {
      result.push({ mixName: matched.name, brand: matched.brand, newComponents });
    }
  }
  return result;
}
export interface MixScheduledRun {
  date: string; // YYYY-MM-DD
  brand: string;
  flavor: string;
  pizzas: number;
  cases: number;
  // All ingredient names used in this run's profile (applicator types,
  // cheese/sauce recipe rows). Used to match prep mixes by ingredient.
  ingredients?: string[];
  // oz/pizza for each ingredient name, sourced from the run's profile.
  // Used by prep mixes so lbs scale to each brand's actual recipe weight,
  // not the mix card's generic perPizza value.
  ingredientOzPerPizza?: Record<string, number>;
}

// One component of a mix, scaled to the run's pizza count.
export interface MixComponentPlan {
  ingredient: string;
  lbs: number; // perPizza-ounces × pizzas ÷ 16
}

// A matched mix for a specific run, fully computed.
/**
 * Per-run contribution to a prep mix — shows how much of the total lbs comes
 * from each individual scheduled run. Only populated for prep mixes (isPrep)
 * when 2+ runs contribute; useful for spotting profile mismatches.
 */
export interface MixContribution {
  brand: string;
  flavor: string;
  pizzas: number;
  /** Sum of all component lbs this run contributes (before waste/startup). */
  totalLbs: number;
}

export interface MixPlanEntry {
  mixId: string;
  name: string;
  batchSize: number;
  daysEarly: number;
  notes?: string;
  // Flat +20 lb startup/hopper buffer added automatically (mirrors applicator +20 lb).
  startupLbs: number;
  // Sum of component pounds + 15% waste buffer + 20 lb startup (= total pounds needed).
  totalLbs: number;
  amountAlreadyMade: number;
  // max(0, totalLbs - amountAlreadyMade).
  remainingLbs: number;
  // remainingLbs / batchSize (fractional; 0 when batchSize <= 0).
  batches: number;
  components: MixComponentPlan[];
  /**
   * True when the mix has at least one component but EVERY component's
   * perPizza is 0 — i.e. no oz/pizza amounts have been entered yet. The
   * plan's totalLbs will be 0 as a result. Callers use this to distinguish
   * "amounts missing" from "legitimately 0 lbs" (e.g. amountAlreadyMade
   * covers everything, or a future-date run with 0 pizzas).
   */
  missingAmounts: boolean;
  /**
   * Per-run breakdown of how many lbs each scheduled run contributes to this
   * prep mix total. Only present on prep-mix entries with 2+ contributing runs,
   * so managers can spot mismatches (e.g. Brand A uses 2 oz/pizza vs Brand B
   * 1.5 oz/pizza of the same ingredient).
   */
  contributions?: MixContribution[];
}

// A run on the make-day with at least one matched mix.
export interface MixPlanRun {
  brand: string;
  flavor: string;
  pizzas: number;
  cases: number;
  mixes: MixPlanEntry[];
}

// A "Mixes to make for [date]" card: all runs whose date carries matched mixes.
export interface MixPlanGroup {
  date: string;
  daysUntil: number;
  runs: MixPlanRun[];
  // Prep mixes matched by ingredient (across all runs on this date).
  prepMixes: MixPlanEntry[];
}

// Whole-days between today and a run date (both YYYY-MM-DD). Parsed as UTC so the
// result is calendar-day based and free of timezone/DST drift.
export function daysUntil(runDate: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${runDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

function productKey(brand: string, flavor: string): string {
  return `${brand.trim().toLowerCase()}|${flavor.trim().toLowerCase()}`;
}

// Compute a single matched mix against a run's pizza count.
function computeEntry(mix: Mix, pizzas: number): MixPlanEntry {
  const components: MixComponentPlan[] = mix.components.map((c) => ({
    ingredient: c.ingredient,
    // perPizza is in ounces; batchSize/amountAlreadyMade are in pounds, so
    // convert to pounds here to keep the whole plan in one unit.
    lbs: (c.perPizza * pizzas) / OZ_PER_LB,
  }));
  const componentLbs = components.reduce((acc, c) => acc + c.lbs, 0);
  // 15% waste buffer covers spills, over-mixing, and hopper residue so the
  // manager always has a safe margin when deciding how much to make.
  const MIX_WASTE_FACTOR = 0.15;
  const wasteLbs = componentLbs * MIX_WASTE_FACTOR;
  // Flat +20 lb startup/hopper buffer on top of the waste-buffered total.
  const startupLbs = 20;
  const totalLbs = componentLbs + wasteLbs + startupLbs;
  const remainingLbs = Math.max(0, totalLbs - mix.amountAlreadyMade);
  const batches = mix.batchSize > 0 ? remainingLbs / mix.batchSize : 0;
  // True when the mix has components but none carry a perPizza amount yet —
  // the manager needs to open the Mixes editor and fill them in.
  const missingAmounts =
    mix.components.length > 0 && mix.components.every((c) => !(c.perPizza > 0));
  const entry: MixPlanEntry = {
    mixId: mix.id,
    name: mix.name,
    batchSize: mix.batchSize,
    daysEarly: mix.daysEarly,
    startupLbs,
    totalLbs,
    amountAlreadyMade: mix.amountAlreadyMade,
    remainingLbs,
    batches,
    components,
    missingAmounts,
  };
  if (mix.notes) entry.notes = mix.notes;
  return entry;
}

// Like computeEntry but accepts pre-computed per-component lbs totals (already
// summed across runs with per-run oz/pizza). Used for prep mixes where each run
// may use a different oz/pizza weight for the same ingredient.
function computeEntryFromComponentLbs(
  mix: Mix,
  perComponentLbs: number[],
  contributions?: MixContribution[],
): MixPlanEntry {
  const components: MixComponentPlan[] = mix.components.map((c, i) => ({
    ingredient: c.ingredient,
    lbs: perComponentLbs[i] ?? 0,
  }));
  const componentLbs = components.reduce((acc, comp) => acc + comp.lbs, 0);
  const MIX_WASTE_FACTOR = 0.15;
  const wasteLbs = componentLbs * MIX_WASTE_FACTOR;
  const startupLbs = 20;
  const totalLbs = componentLbs + wasteLbs + startupLbs;
  const remainingLbs = Math.max(0, totalLbs - mix.amountAlreadyMade);
  const batches = mix.batchSize > 0 ? remainingLbs / mix.batchSize : 0;
  // missingAmounts: mix has components but none contributed any lbs
  // (likely because the profile oz/pizza is 0 and no perPizza fallback).
  const missingAmounts =
    mix.components.length > 0 && perComponentLbs.every((l) => !(l > 0));
  const entry: MixPlanEntry = {
    mixId: mix.id,
    name: mix.name,
    batchSize: mix.batchSize,
    daysEarly: mix.daysEarly,
    startupLbs,
    totalLbs,
    amountAlreadyMade: mix.amountAlreadyMade,
    remainingLbs,
    batches,
    components,
    missingAmounts,
  };
  if (mix.notes) entry.notes = mix.notes;
  // Only attach contributions when there are 2+ runs — a single run adds no
  // diagnostic value and would just clutter the UI.
  if (contributions && contributions.length >= 2) entry.contributions = contributions;
  return entry;
}

// An aggregate of all scheduled runs that share a date + product (brand+flavor),
// with their pizza/case counts summed. Mixes are computed once against this
// aggregate so a day's "amount already made" is honored a single time even when a
// product is split across several runs.
interface ProductAggregate {
  brand: string;
  flavor: string;
  pizzas: number;
  cases: number;
}

// Build the mix plan for a chosen make-day (`today`): scheduled runs are first
// aggregated by date + product (brand+flavor, case-insensitive), summing their
// pizza/case counts. For each aggregated product, include any enabled mix whose
// product matches AND whose runs are within the mix's make-ahead window
// (0 <= daysUntil(run) <= mix.daysEarly). Runs in the past (daysUntil < 0) are
// skipped. Each matched mix's components are scaled by the aggregated pizza count,
// and "amount already made" is subtracted once per product (not once per run).
// Results are grouped by run date and sorted ascending by date.
export function buildMixPlan(args: {
  runs: MixScheduledRun[];
  mixes: Mix[];
  today: string;
}): MixPlanGroup[] {
  const { runs, today } = args;
  const enabledMixes = args.mixes.filter((m) => m.enabled);
  if (enabledMixes.length === 0) return [];

  // Separate brand/flavor mixes from prep mixes (ingredient-linked).
  const mixes = enabledMixes.filter((m) => !m.isPrep);
  const prepMixList = enabledMixes.filter((m) => !!m.isPrep);

  // Group brand/flavor mixes by product so each run can find all of its mixes.
  const byProduct = new Map<string, Mix[]>();
  for (const mix of mixes) {
    const key = productKey(mix.brand, mix.flavor);
    const list = byProduct.get(key);
    if (list) list.push(mix);
    else byProduct.set(key, [mix]);
  }

  // Aggregate runs by date -> product, summing pizzas/cases. Insertion order of
  // the inner map preserves first-seen product order within a date.
  const byDate = new Map<string, Map<string, ProductAggregate>>();
  for (const run of runs) {
    const du = daysUntil(run.date, today);
    if (!Number.isFinite(du) || du < 0) continue;
    const key = productKey(run.brand, run.flavor);
    if (!byProduct.has(key)) continue; // no mix for this product
    let products = byDate.get(run.date);
    if (!products) {
      products = new Map<string, ProductAggregate>();
      byDate.set(run.date, products);
    }
    const agg = products.get(key);
    if (agg) {
      agg.pizzas += run.pizzas;
      agg.cases += run.cases;
    } else {
      products.set(key, {
        brand: run.brand,
        flavor: run.flavor,
        pizzas: run.pizzas,
        cases: run.cases,
      });
    }
  }

  const groups: MixPlanGroup[] = [];
  for (const [date, products] of byDate) {
    const du = daysUntil(date, today);
    const planRuns: MixPlanRun[] = [];
    for (const [key, agg] of products) {
      const candidates = byProduct.get(key);
      if (!candidates || candidates.length === 0) continue;
      const matched: MixPlanEntry[] = [];
      for (const mix of candidates) {
        if (du > mix.daysEarly) continue; // not time to make it yet
        matched.push(computeEntry(mix, agg.pizzas));
      }
      if (matched.length === 0) continue;
      planRuns.push({
        brand: agg.brand,
        flavor: agg.flavor,
        pizzas: agg.pizzas,
        cases: agg.cases,
        mixes: matched,
      });
    }
    if (planRuns.length === 0) continue;
    groups.push({ date, daysUntil: du, runs: planRuns, prepMixes: [] });
  }

  // ── Ingredient matching helper ────────────────────────────────────────────
  // "Pineapple" should match "Pineapple - Drained", "Pineapple (Tidbits)", etc.
  // because spec imports and manual profiles often add qualifiers after the base
  // name. We consider two names equivalent when one is a word-boundary prefix of
  // the other (the next character after the shorter name must be a separator,
  // not a letter/digit, to avoid false positives like "Apple" matching "Applesauce").
  function ingredientMatches(a: string, b: string): boolean {
    const ak = a.trim().toLowerCase();
    const bk = b.trim().toLowerCase();
    if (ak === bk) return true;
    const [longer, shorter] = ak.length >= bk.length ? [ak, bk] : [bk, ak];
    if (longer.startsWith(shorter)) {
      const next = longer[shorter.length];
      return next === " " || next === "-" || next === "," || next === "(" || next === "/";
    }
    return false;
  }

  // Prep-mix pass: mixes with prepsIngredient match by ingredient name
  // across all runs on a date, regardless of brand/flavor.
  if (prepMixList.length > 0) {
    // Index all date-valid runs by date for fast ingredient lookup.
    const runsByDate = new Map<string, MixScheduledRun[]>();
    for (const run of runs) {
      const du = daysUntil(run.date, today);
      if (!Number.isFinite(du) || du < 0) continue;
      let list = runsByDate.get(run.date);
      if (!list) { list = []; runsByDate.set(run.date, list); }
      list.push(run);
    }
    // Fast group lookup so we can add to existing groups or create new ones.
    const groupByDate = new Map<string, MixPlanGroup>();
    for (const g of groups) groupByDate.set(g.date, g);

    for (const [date, dateRuns] of runsByDate) {
      const du = daysUntil(date, today);
      for (const mix of prepMixList) {
        if (du > mix.daysEarly) continue;
        // Match runs that use any of this mix's component ingredient names.
        const componentKeys = mix.components.map((comp) =>
          comp.ingredient.trim().toLowerCase(),
        );
        const matchingRuns = dateRuns.filter((r) =>
          (r.ingredients ?? []).some((i) =>
            componentKeys.some((ck) => ingredientMatches(i, ck)),
          ),
        );
        if (matchingRuns.length === 0) continue;
        // Compute per-component lbs using each run's profile oz/pizza, not the
        // mix card's generic perPizza. Different brands/flavors may use different
        // weights for the same ingredient. Falls back to mix.component.perPizza
        // if the run has no profile data for that ingredient.
        //
        // Also build per-run contribution totals so the UI can show a breakdown
        // like "Brand A (1200 pizzas): 12.5 lbs · Brand B (800 pizzas): 7.5 lbs".
        const contributions: MixContribution[] = [];
        const perComponentLbs = mix.components.map((comp) => {
          const key = comp.ingredient.trim().toLowerCase();
          return matchingRuns
            .filter((r) =>
              (r.ingredients ?? []).some(
                (i) => ingredientMatches(i, comp.ingredient),
              ),
            )
            .reduce((sum, r) => {
              let oz = comp.perPizza; // fallback: mix card value
              if (r.ingredientOzPerPizza) {
                // Try exact name match first, then case-insensitive.
                const exact = r.ingredientOzPerPizza[comp.ingredient];
                if (exact !== undefined) {
                  oz = exact;
                } else {
                  const ci = Object.entries(r.ingredientOzPerPizza).find(
                    ([k]) => ingredientMatches(k, comp.ingredient),
                  );
                  if (ci) oz = ci[1];
                }
              }
              return sum + (oz / OZ_PER_LB) * r.pizzas;
            }, 0);
        });
        // Build per-run contribution totals (sum across all components for each run).
        for (const r of matchingRuns) {
          let runTotalLbs = 0;
          for (const comp of mix.components) {
            const key = comp.ingredient.trim().toLowerCase();
            const hasIngredient = (r.ingredients ?? []).some(
              (i) => i.trim().toLowerCase() === key,
            );
            if (!hasIngredient) continue;
            let oz = comp.perPizza;
            if (r.ingredientOzPerPizza) {
              const exact = r.ingredientOzPerPizza[comp.ingredient];
              if (exact !== undefined) {
                oz = exact;
              } else {
                const ci = Object.entries(r.ingredientOzPerPizza).find(
                  ([k]) => k.trim().toLowerCase() === key,
                );
                if (ci) oz = ci[1];
              }
            }
            runTotalLbs += (oz / OZ_PER_LB) * r.pizzas;
          }
          if (runTotalLbs > 0) {
            contributions.push({
              brand: r.brand,
              flavor: r.flavor,
              pizzas: r.pizzas,
              totalLbs: runTotalLbs,
            });
          }
        }
        let group = groupByDate.get(date);
        if (!group) {
          group = { date, daysUntil: du, runs: [], prepMixes: [] };
          groupByDate.set(date, group);
          groups.push(group);
        }
        group.prepMixes.push(computeEntryFromComponentLbs(mix, perComponentLbs, contributions));
      }
    }
  }

  return groups
    .filter((g) => g.runs.length > 0 || g.prepMixes.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Mix list browsing (search + brand grouping for the settings UI) ─────────

/** Case-insensitive match of a search query against a mix's name/brand/flavor. */
export function mixMatchesQuery(mix: Mix, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    mix.name.toLowerCase().includes(q) ||
    mix.brand.toLowerCase().includes(q) ||
    mix.flavor.toLowerCase().includes(q)
  );
}

export interface MixBrandGroup {
  /** Trimmed brand name; "" for mixes with no brand (sorted last). */
  brand: string;
  mixes: Mix[];
}

/**
 * Group mixes by brand for a browsable settings list: brands sorted
 * alphabetically (case-insensitive), the no-brand group last, and mixes inside
 * each group sorted by name. Pure — used by BOTH web and mobile so the two
 * lists can't drift.
 */
export function groupMixesByBrand(mixes: ReadonlyArray<Mix>): MixBrandGroup[] {
  const byBrand = new Map<string, { brand: string; mixes: Mix[] }>();
  for (const mix of mixes) {
    const brand = mix.brand.trim();
    const key = brand.toLowerCase();
    const g = byBrand.get(key);
    if (g) g.mixes.push(mix);
    else byBrand.set(key, { brand, mixes: [mix] });
  }
  const groups = [...byBrand.values()];
  for (const g of groups) {
    g.mixes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }
  groups.sort((a, b) => {
    if (!a.brand && b.brand) return 1;
    if (a.brand && !b.brand) return -1;
    return a.brand.localeCompare(b.brand, undefined, { sensitivity: "base" });
  });
  return groups;
}

/**
 * Append accepted new ingredient rows to their matched existing mixes.
 * `acceptedAdditions` is the subset of detectNewMixComponents output the
 * manager approved in the review dialog. Matched by the same brand + loose
 * name key as applyMixPerPizza. Ingredients already present in the mix are
 * skipped (double-guard). Pure. Returns the next list plus how many mixes
 * had at least one component appended.
 */
export function applyNewMixComponents(
  existing: ReadonlyArray<Mix>,
  acceptedAdditions: ReadonlyArray<{
    mixName: string;
    brand: string;
    newComponents: ReadonlyArray<MixComponent>;
  }>,
): { next: Mix[]; applied: number } {
  if (!acceptedAdditions.length) return { next: [...existing], applied: 0 };
  const byKey = new Map<string, ReadonlyArray<MixComponent>>();
  for (const a of acceptedAdditions) {
    const nameKey = mixNameMatchKey(a.mixName);
    const brandKey = (a.brand ?? "").trim().toLowerCase();
    if (nameKey) byKey.set(`${brandKey}\0${nameKey}`, a.newComponents);
  }
  let applied = 0;
  const next = existing.map((m) => {
    const brandKey = (m.brand ?? "").trim().toLowerCase();
    const nameKey = mixNameMatchKey(m.name);
    const additions = byKey.get(`${brandKey}\0${nameKey}`);
    if (!additions || !additions.length) return m;
    const existingIngKeys = new Set(m.components.map((c) => c.ingredient.trim().toLowerCase()));
    const toAdd = additions.filter((c) => !existingIngKeys.has(c.ingredient.trim().toLowerCase()));
    if (!toAdd.length) return m;
    applied++;
    return { ...m, components: [...m.components, ...toAdd.map((c) => ({ ...c }))] };
  });
  return { next, applied };
}
