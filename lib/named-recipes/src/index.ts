// Shared "named recipe" model for the run calculator (web + mobile parity).
//
// A "named recipe" is a simple, factory-wide recipe organized purely by NAME
// plus a list of ingredient components (each an ingredient and its POUNDS). It
// backs the Dough and Sauce sections, promoting the old on-device Dough/Sauce
// preset lists to server master-data that works like Mixes and Cheese Recipes:
// managers define them once, they are shared across every signed-in device, and
// the run form's Dough / Sauce cards pick one (hydrating their rows from the
// chosen recipe) instead of each device keeping its own preset map.
//
// Like Mixes and Cheese Recipes, a named recipe can carry an OPTIONAL
// brand/flavor tag ("who it goes to"): a single customer (brand) plus the
// product flavors it is used on. Empty flavors with a brand means "all
// varieties" of that brand (mirroring the Cheese Recipes convention); no brand
// means the recipe is shared/untagged. The tags are DISPLAY-ONLY — run-form
// Dough/Sauce pickers keep listing every enabled recipe — and the rows still
// match the per-run `doughRecipe` / `frontlineRecipe` RecipeRow shape so
// hydration is a straight copy.
//
// This module is PURE so both apps agree on what a well-formed recipe is and how
// the list is browsed. Definitions are stored factory-wide on the server (NOT in
// the per-day sync payload) and edited by managers only; the apps keep only thin
// platform glue (fetch/save/delete) plus the run-side hydration.

import { buildNearDupNameMatcher, looseNameKey } from "@workspace/name-match";

// One component of a named recipe: an ingredient and how many POUNDS of it the
// recipe uses. Matches the per-run RecipeRow shape ({ ingredient, lbs }).
export interface NamedRecipeComponent {
  ingredient: string;
  lbs: number;
}

// A single manager-defined named recipe. Flat shape (plus a components array) so
// it serializes cleanly to the API/DB and is easy to edit field-by-field in the
// UI, mirroring the Mix / Cheese Recipe models minus the brand/flavor fields.
export interface NamedRecipe {
  id: string;
  // Optional persistence scope (live vs sandbox); carried through opaquely.
  scope?: string;
  // Display name of the recipe (e.g. "12in NY Dough", "Marinara Sauce").
  name: string;
  // Free-form notes.
  notes: string;
  // The ingredients that make up the recipe, each in pounds.
  components: NamedRecipeComponent[];
  // Disabled recipes are kept (so toggling is easy) but hidden from run pickers.
  enabled: boolean;
  // Optional "who it goes to" tag: the customer (brand) this recipe is made
  // for. Empty string = shared/untagged. Display-only (never filters pickers).
  brand: string;
  // Product flavors of `brand` this recipe is used on. Empty with a brand set
  // means "all varieties" (same convention as Cheese Recipes).
  flavors: string[];
  // DOUGH only: target weight of one doughball in OUNCES (the spec sheet's
  // "target ball weight"). 0/absent = unknown. Sauce recipes never set it.
  // Stored on the pool so picking a dough recipe can fill the run form's
  // Target Doughball Weight — without it every pool-hydrated dough run sat at
  // 0 oz and the batch-yield math silently died.
  doughballWeightOz?: number;
  // DOUGH only: how many doughballs fit on one tray. 0/absent = unknown.
  // Stored on the pool (like doughballWeightOz) so picking a dough recipe —
  // or a pool-hydrated import/heal — can fill the run form's Doughballs Per
  // Tray; the spec sheet states it per RECIPE, so it must travel with the
  // recipe, not just the profiles an import happened to touch.
  doughballsPerTray?: number;
  // DOUGH only: the per-VARIANT doughball weights / per-tray counts this one
  // family recipe covers. A spec import collapses variant names ("11\" CRB",
  // "CRB Heavy Plus") onto ONE family recipe (one recipe per dough family) —
  // this list keeps every variant's numbers instead of losing all but one.
  // label = the variant's original sheet name. Additive: re-imports merge by
  // label (ci), never dropping variants. Empty/absent = no variants known.
  doughballVariants?: DoughballVariant[];
}

/** One dough family variant's doughball numbers (label = original sheet name). */
export interface DoughballVariant {
  label: string;
  /** Target doughball weight in oz; 0/absent = unknown. */
  weightOz?: number;
  /** Doughballs per tray; 0/absent = unknown. */
  perTray?: number;
  /**
   * Brand+flavor pairs this variant explicitly applies to. When set, variant
   * matching prefers this variant over a die-type match for the listed combos.
   * An empty `flavor` string means "any flavor of this brand". Populated
   * automatically on spec import (each profile's brand+flavor → linked
   * variant) and editable by managers in the dough recipe editor.
   */
  customers?: Array<{ brand: string; flavor: string }>;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

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

function coerceStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Coerce a raw value into a clean component, or null if it has no usable
// ingredient name. lbs defaults to 0 and is clamped to >= 0.
export function normalizeNamedRecipeComponent(
  input: unknown,
): NamedRecipeComponent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const ingredient = coerceStr(raw.ingredient);
  if (!ingredient) return null;
  const lbs = Math.max(0, coerceNum(raw.lbs, 0));
  return { ingredient, lbs };
}

// Coerce a raw flavors value into a clean, ci-deduped list of non-blank names.
// Tolerates absent/malformed input (older records have no flavors field).
export function normalizeNamedRecipeFlavors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const f = coerceStr(raw);
    if (!f) continue;
    const ci = f.toLowerCase();
    if (seen.has(ci)) continue;
    seen.add(ci);
    out.push(f);
  }
  return out;
}

// Coerce a raw API/DB record into a clean NamedRecipe, or null if it has no
// usable name. Numeric component pounds are clamped to >= 0; enabled defaults to
// true; malformed components are dropped. brand/flavors default to untagged
// (older records predate the tags) — flavors are only kept when a brand is set,
// since a flavor tag is meaningless without knowing whose flavor it is.
export function normalizeNamedRecipe(input: unknown): NamedRecipe | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = coerceStr(raw.name);
  if (!name) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id : name.toLowerCase();
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false;
  const components = Array.isArray(raw.components)
    ? raw.components
        .map(normalizeNamedRecipeComponent)
        .filter((c): c is NamedRecipeComponent => c !== null)
    : [];
  const brand = coerceStr(raw.brand);
  const recipe: NamedRecipe = {
    id,
    name,
    notes: coerceStr(raw.notes),
    components,
    enabled,
    brand,
    flavors: brand ? normalizeNamedRecipeFlavors(raw.flavors) : [],
  };
  const ballOz = coerceNum(raw.doughballWeightOz, 0);
  if (ballOz > 0) recipe.doughballWeightOz = ballOz;
  const perTray = Math.round(coerceNum(raw.doughballsPerTray, 0));
  if (perTray > 0) recipe.doughballsPerTray = perTray;
  const variants = normalizeDoughballVariants(raw.doughballVariants, name);
  if (variants.length > 0) recipe.doughballVariants = variants;
  if (typeof raw.scope === "string" && raw.scope) recipe.scope = raw.scope;
  return recipe;
}

// Generic dough words that add no identity to a variant label ("Corner Booth
// CRB Dough" is the same variant as "Corner Booth" on the CRB Dough recipe).
const GENERIC_DOUGH_LABEL_TOKENS = new Set([
  "dough",
  "doughs",
  "recipe",
  "recipes",
]);

function variantLabelTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Equivalence key for a doughball variant LABEL on a given family recipe:
 * lowercase tokens with the recipe's own family-name tokens and generic dough
 * words stripped from the TAIL only (never the middle — "Lowe's CRB Heavier"
 * keeps its distinctive tokens). "Corner Booth CRB Dough" ≡ "Corner Booth" on
 * the "CRB Dough" recipe. Conservative: at least one token always survives, so
 * a label that IS the family name never folds onto an unrelated one. Pure.
 */
export function doughballVariantLabelKey(
  label: string,
  recipeName = "",
): string {
  const tokens = variantLabelTokens(label);
  if (tokens.length === 0) return label.trim().toLowerCase();
  const strippable = new Set(GENERIC_DOUGH_LABEL_TOKENS);
  for (const t of variantLabelTokens(recipeName)) strippable.add(t);
  let end = tokens.length;
  while (end > 1 && strippable.has(tokens[end - 1])) end--;
  return tokens.slice(0, end).join(" ");
}

// Two variant entries may only FOLD (suffix-equivalent labels) when their
// numbers don't contradict each other. The doughball WEIGHT is the variant's
// identity number: two set weights that differ mean two genuinely different
// variants — never folded. Per-tray is a detail a re-import may legitimately
// update, so it only blocks a fold in `strict` mode (the one-time data heal,
// which must be conservative because it has no "this is a re-import" signal).
function doughballVariantValuesCompatible(
  a: DoughballVariant,
  b: DoughballVariant,
  opts?: { strict?: boolean },
): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.005;
  if (
    a.weightOz !== undefined &&
    b.weightOz !== undefined &&
    !near(a.weightOz, b.weightOz)
  ) {
    return false;
  }
  if (
    opts?.strict &&
    a.perTray !== undefined &&
    b.perTray !== undefined &&
    a.perTray !== b.perTray
  ) {
    return false;
  }
  return true;
}

// Of two suffix-equivalent labels, keep the base (shorter) spelling — the one
// without the family name tacked on. Ties keep the existing label.
function pickBaseVariantLabel(existing: string, incoming: string): string {
  return incoming.length < existing.length ? incoming : existing;
}

/**
 * Coerce a raw doughball variants value into a clean list: blank labels and
 * variants with neither a positive weight nor per-tray are dropped; duplicate
 * labels (ci) collapse onto the first occurrence (its set fields win, later
 * duplicates only fill gaps). When the owning recipe's NAME is supplied,
 * labels that are suffix-equivalent (identical after stripping the family
 * name / generic dough words from the tail, e.g. "Corner Booth CRB Dough" vs
 * "Corner Booth") also collapse — but ONLY when their numbers don't
 * contradict; the base (shorter) label is kept. Pure.
 */
/** Union two customers arrays by brand+flavor key (ci). Returns null when there is nothing to add. */
function unionVariantCustomers(
  base: ReadonlyArray<{ brand: string; flavor: string }> | undefined,
  incoming: ReadonlyArray<{ brand: string; flavor: string }> | undefined,
): Array<{ brand: string; flavor: string }> | null {
  if (!incoming || incoming.length === 0) return null;
  const existing = base ?? [];
  const additions = incoming.filter(
    (c) =>
      !existing.some(
        (e) =>
          e.brand.trim().toLowerCase() === c.brand.trim().toLowerCase() &&
          e.flavor.trim().toLowerCase() === c.flavor.trim().toLowerCase(),
      ),
  );
  if (additions.length === 0) return null;
  return [...existing, ...additions];
}

/** Normalize a raw `customers` value from a DB/API record. */
function normalizeVariantCustomers(
  raw: unknown,
): Array<{ brand: string; flavor: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ brand: string; flavor: string }> = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const cr = c as Record<string, unknown>;
    const brand = coerceStr(cr.brand);
    if (!brand) continue;
    const flavor = coerceStr(cr.flavor);
    const key = `${brand.toLowerCase()}\0${flavor.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ brand, flavor });
  }
  return out;
}

export function normalizeDoughballVariants(
  input: unknown,
  recipeName = "",
): DoughballVariant[] {
  if (!Array.isArray(input)) return [];
  const out: DoughballVariant[] = [];
  const byKey = new Map<string, number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const label = coerceStr(rec.label);
    if (!label) continue;
    const weightOz = coerceNum(rec.weightOz, 0);
    const perTray = Math.round(coerceNum(rec.perTray, 0));
    const customers = normalizeVariantCustomers(rec.customers);
    const v: DoughballVariant = { label };
    if (weightOz > 0) v.weightOz = weightOz;
    if (perTray > 0) v.perTray = perTray;
    if (v.weightOz === undefined && v.perTray === undefined) continue;
    if (customers.length > 0) v.customers = customers;
    const key = doughballVariantLabelKey(label, recipeName);
    const at = byKey.get(key);
    if (at === undefined) {
      byKey.set(key, out.length);
      out.push(v);
      continue;
    }
    const keep = out[at];
    const exactLabel = keep.label.toLowerCase() === v.label.toLowerCase();
    if (!exactLabel && !doughballVariantValuesCompatible(keep, v)) {
      // Suffix-equivalent labels with contradicting numbers: genuinely
      // different variants — keep both (first keeps the key slot).
      out.push(v);
      continue;
    }
    const merged: DoughballVariant = {
      ...keep,
      label: exactLabel ? keep.label : pickBaseVariantLabel(keep.label, v.label),
      ...(keep.weightOz === undefined && v.weightOz !== undefined ? { weightOz: v.weightOz } : {}),
      ...(keep.perTray === undefined && v.perTray !== undefined ? { perTray: v.perTray } : {}),
    };
    const unitedCustomers = unionVariantCustomers(keep.customers, v.customers);
    if (unitedCustomers) merged.customers = unitedCustomers;
    out[at] = merged;
  }
  return out;
}

/**
 * One-time collapse of a recipe's variant list for the data heal: entries
 * whose labels are suffix-equivalent under doughballVariantLabelKey fold onto
 * one entry keeping the base (shorter) label, with the LATER entry's set
 * fields winning (a later import stated the current numbers — in the observed
 * production duplicates the values are identical anyway). Entries whose
 * numbers contradict are never folded. Returns the collapsed list, or null
 * when nothing changed. Pure.
 */
export function collapseDoughballVariantSuffixDuplicates(
  variants: ReadonlyArray<DoughballVariant> | undefined,
  recipeName: string,
): DoughballVariant[] | null {
  const list = normalizeDoughballVariants(variants as unknown);
  const out: DoughballVariant[] = [];
  const byKey = new Map<string, number>();
  let folded = false;
  for (const v of list) {
    const key = doughballVariantLabelKey(v.label, recipeName);
    const at = byKey.get(key);
    if (at === undefined) {
      byKey.set(key, out.length);
      out.push({ ...v });
      continue;
    }
    const keep = out[at];
    if (!doughballVariantValuesCompatible(keep, v, { strict: true })) {
      out.push({ ...v });
      continue;
    }
    out[at] = {
      label: pickBaseVariantLabel(keep.label, v.label),
      ...(keep.weightOz !== undefined || v.weightOz !== undefined
        ? { weightOz: v.weightOz ?? keep.weightOz }
        : {}),
      ...(keep.perTray !== undefined || v.perTray !== undefined
        ? { perTray: v.perTray ?? keep.perTray }
        : {}),
    };
    folded = true;
  }
  return folded ? out : null;
}

/**
 * Merge (or replace) learned variants onto EXISTING pool dough recipes by
 * recipe NAME (ci).
 *
 * Additive mode (default): new labels append, an existing label's UNSET fields
 * are filled and set fields are updated to the incoming value. Variants NOT in
 * the incoming list are kept.
 *
 * Replace mode (`options.replace = true`): for every recipe that appears in
 * `variantsByName`, its entire `doughballVariants` list is replaced by the
 * incoming normalized list. Recipes absent from the map are left untouched.
 * Use this for spec re-imports so a renamed variant ("Bashas Ultra Thin" →
 * "Craft Bashas Ultra Thin") replaces the old entry instead of appending to it.
 *
 * Returns ONLY the recipes that changed. Pure.
 */
export function mergeNamedRecipeDoughballVariants(
  recipes: ReadonlyArray<NamedRecipe>,
  variantsByName: ReadonlyMap<string, ReadonlyArray<DoughballVariant>>,
  options?: { replace?: boolean },
): NamedRecipe[] {
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const incoming = normalizeDoughballVariants(
      variantsByName.get(r.name.trim().toLowerCase()) as unknown,
      r.name,
    );
    if (incoming.length === 0) continue;

    // Replace mode: swap the entire list for this recipe so a renamed variant
    // (e.g. "Bashas Ultra Thin" → "Craft Bashas Ultra Thin") removes the old
    // entry instead of leaving both in the pool alongside the new one.
    // IMPORTANT: union existing per-variant customers into the incoming list —
    // if the import produced no parsed customers (e.g. the workbook section
    // changed format), replacing wholesale would wipe customers that were
    // populated by a previous import or by the manager editor.
    if (options?.replace) {
      const before = normalizeDoughballVariants(r.doughballVariants, r.name);
      const existingByKey = new Map<string, DoughballVariant>(
        before.map((v) => [doughballVariantLabelKey(v.label, r.name), v]),
      );
      const enriched = incoming.map((v) => {
        const prev = existingByKey.get(doughballVariantLabelKey(v.label, r.name));
        if (!prev?.customers?.length) return v;
        // Carry over existing customers not already present in the incoming list.
        // unionVariantCustomers only works when the second arg (incoming) is
        // non-empty; handle the common case (incoming has no customers) directly.
        const vCustomers = v.customers ?? [];
        const toAdd = prev.customers.filter(
          (e) =>
            !vCustomers.some(
              (c) =>
                c.brand.trim().toLowerCase() === e.brand.trim().toLowerCase() &&
                c.flavor.trim().toLowerCase() === e.flavor.trim().toLowerCase(),
            ),
        );
        if (toAdd.length === 0) return v;
        return { ...v, customers: [...vCustomers, ...toAdd] };
      });
      if (JSON.stringify(before) !== JSON.stringify(enriched)) {
        changed.push({ ...r, doughballVariants: enriched });
      }
      continue;
    }

    const merged = [...normalizeDoughballVariants(r.doughballVariants, r.name)];
    // Keyed by the suffix-equivalence key so a re-import whose label carries
    // the family dough name tacked on ("Corner Booth CRB Dough") UPDATES the
    // existing base-label variant ("Corner Booth") instead of appending a
    // duplicate.
    const byKey = new Map<string, number>(
      merged.map((v, i) => [doughballVariantLabelKey(v.label, r.name), i]),
    );
    let touched = false;
    for (const v of incoming) {
      const key = doughballVariantLabelKey(v.label, r.name);
      const at = byKey.get(key);
      if (at === undefined) {
        byKey.set(key, merged.length);
        merged.push(v);
        touched = true;
        continue;
      }
      const keep = merged[at];
      const exactLabel = keep.label.toLowerCase() === v.label.toLowerCase();
      if (!exactLabel && !doughballVariantValuesCompatible(keep, v)) {
        // Suffix-equivalent labels but contradicting numbers: genuinely
        // different variants — append instead of clobbering.
        merged.push(v);
        touched = true;
        continue;
      }
      const next: DoughballVariant = {
        ...keep,
        label: exactLabel
          ? keep.label
          : pickBaseVariantLabel(keep.label, v.label),
        ...(v.weightOz !== undefined ? { weightOz: v.weightOz } : {}),
        ...(v.perTray !== undefined ? { perTray: v.perTray } : {}),
      };
      const unitedCustomers = unionVariantCustomers(keep.customers, v.customers);
      if (unitedCustomers) next.customers = unitedCustomers;
      if (
        next.label !== keep.label ||
        next.weightOz !== keep.weightOz ||
        next.perTray !== keep.perTray ||
        next.customers !== keep.customers
      ) {
        merged[at] = next;
        touched = true;
      }
    }
    if (touched) changed.push({ ...r, doughballVariants: merged });
  }
  return changed;
}

/**
 * Pick the dough family variant that best matches a product, for auto-filling
 * a blank run form. Deterministic and conservative:
 * 1. exactly ONE variant → that variant;
 * 2. a variant whose `customers` list includes this brand+flavor → that variant
 *    (most explicit match; a blank flavor on a customer entry means "any flavor
 *    of this brand");
 * 3. the die size's leading number (e.g. `11` from `11 inch`) appears as the
 *    size number in EXACTLY ONE variant label ("11\" CRB") → that variant;
 * 4. otherwise null — the caller should offer a manual pick.
 */
export function matchDoughballVariant(
  variants: ReadonlyArray<DoughballVariant> | undefined,
  opts: { dieType?: string; brand?: string; flavor?: string },
): DoughballVariant | null {
  const list = normalizeDoughballVariants(variants as unknown);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  // Priority: explicit brand+flavor customer pairing.
  const b = (opts.brand ?? "").trim().toLowerCase();
  // Qualifier tier implied by the profile's die type — used to distinguish
  // size-tier catch-alls (e.g. "Lowe's 7 Inch") from base-tier ones.
  const profileQual = doughVariantQualifierKey(opts.dieType ?? "");
  if (b) {
    const f = (opts.flavor ?? "").trim().toLowerCase();
    // 1a: Specific brand+flavor entry always beats a catch-all (flavor === "")
    // — prevents array order from deciding when a brand has two variants, one
    // with specific flavor assignments and one with a catch-all fallback.
    if (f) {
      const specificHit = list.find((v) =>
        (v.customers ?? []).some(
          (c) =>
            c.brand.trim().toLowerCase() === b &&
            c.flavor.trim().toLowerCase() === f,
        ),
      );
      if (specificHit) return specificHit;
    }
    // 1b: Brand + catch-all (empty flavor) fallback.
    //
    // When the sole catch-all sits on a die-SIZE tier (e.g. "seveninch") that
    // does NOT match the profile's die-type context, it means the catch-all
    // covers "all flavors of the 7-inch product", not "all orders for this
    // brand". In that case, prefer a base-tier variant that already carries
    // any assignment for this brand — avoiding "Lowe's 7 Inch" being returned
    // for a plain Lowe's profile with no 7-inch die context.
    const catchAllList = list.filter((v) =>
      (v.customers ?? []).some((c) => c.brand.trim().toLowerCase() === b && c.flavor.trim() === ""),
    );
    let catchAllHit: DoughballVariant | undefined;
    if (catchAllList.length === 1) {
      const solo = catchAllList[0];
      const vQual = doughVariantQualifierKey(solo.label);
      if (DOUGH_SIZE_QUALIFIERS.has(vQual) && vQual !== profileQual) {
        // Size-tier catch-all doesn't match profile context — prefer a base
        // variant that has ANY assignment for this brand (specific or catch-all),
        // UNLESS the profile's specific flavor is not listed in the base tier's
        // customers for this brand. If the flavor is absent from the base tier
        // (meaning it wasn't explicitly mapped there) but the size-tier has a
        // catch-all for this brand, the flavor is more likely a size-tier product.
        const baseWithBrand = list.find(
          (v) =>
            doughVariantQualifierKey(v.label) === "" &&
            (v.customers ?? []).some((c) => c.brand.trim().toLowerCase() === b),
        );
        if (!baseWithBrand) {
          catchAllHit = solo;
        } else {
          const f = (opts.flavor ?? "").trim().toLowerCase();
          const baseHasThisFlavor =
            !f ||
            (baseWithBrand.customers ?? []).some(
              (c) =>
                c.brand.trim().toLowerCase() === b &&
                c.flavor.trim().toLowerCase() === f,
            );
          // If the profile has a specific flavor that IS in the base tier →
          // this is a base-tier product → prefer base.
          // If the flavor is absent from the base tier (or no flavor) →
          // prefer the size-tier catch-all (it covers all flavors of this
          // size-tier product, including ones not explicitly enumerated).
          catchAllHit = baseHasThisFlavor ? baseWithBrand : solo;
        }
      } else {
        catchAllHit = solo;
      }
    } else if (catchAllList.length > 1) {
      // Multiple catch-alls: prefer the tier that matches the profile's die
      // type, then prefer the base tier as a safe default.
      catchAllHit =
        catchAllList.find((v) => doughVariantQualifierKey(v.label) === profileQual) ??
        catchAllList.find((v) => doughVariantQualifierKey(v.label) === "") ??
        catchAllList[0];
    }
    if (catchAllHit) return catchAllHit;

    // 1.5: Initials catch-all — handles brand abbreviations such as
    // "Show Me Dough" (profile) matching a customer entry stored as "SMD"
    // (from a workbook row like "SMD CRB: All").
    // Only applied to catch-all (flavor = "") entries to minimise false
    // positives. Requires ≥ 2 initials and the initials must differ from the
    // full brand name (i.e. the brand is multi-word, not already abbreviated).
    const profileInitials = b
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0] ?? "")
      .join("");
    if (profileInitials.length >= 2 && profileInitials !== b) {
      const initialsHit = list.find((v) =>
        (v.customers ?? []).some(
          (c) =>
            c.flavor.trim() === "" &&
            c.brand.trim().toLowerCase() === profileInitials,
        ),
      );
      if (initialsHit) return initialsHit;
    }
  }
  // Fallback: die-type number match.
  const dieNum = (() => {
    const m = /(\d+(?:\.\d+)?)/.exec(opts.dieType ?? "");
    return m ? m[1] : "";
  })();
  if (!dieNum) return null;
  const hits = list.filter((v) => {
    const nums: string[] = v.label.match(/\d+(?:\.\d+)?/g) ?? [];
    return nums.includes(dieNum);
  });
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------------------
// Customer-section parsing for dough mixing procedure sheets
// ---------------------------------------------------------------------------

/**
 * Qualifier keywords in priority order: more-specific before more-general so
 * "heavy plus" never incorrectly matches as plain "heavy".
 *
 * "seveninch" is a synthetic sentinel (never appears in raw text) produced by
 * doughVariantQualifierKey when it sees "7\"" / "7''" / "7 inch" patterns in a
 * label before the digit-stripping step. It identifies the 7-inch die-size tier
 * and is kept distinct from recipe-weight qualifiers so that a 7-inch catch-all
 * customer entry does not shadow base-tier variants for profiles that carry no
 * 7-inch die context.
 */
const DOUGH_VARIANT_QUALIFIERS = [
  "seveninch",
  "ultra thin",
  "heavy plus",
  "heavier",
  "heavy",
  "thick",
  "light",
] as const;

/**
 * Qualifiers that represent a die SIZE rather than a recipe weight. When the
 * only catch-all customer entry for a brand sits on one of these tiers but the
 * run profile has no matching die-type context, matchDoughballVariant falls
 * back to a base-tier variant rather than returning the size-tier one.
 */
const DOUGH_SIZE_QUALIFIERS = new Set<string>(["seveninch"]);

/**
 * Normalize a label (variant label OR customer-section LHS) to the canonical
 * qualifier key that identifies its variant tier. Returns "" for base variants
 * (no qualifier keyword present).
 *
 * 7-inch die-size designations ("7\"" / "7''" / "7 inch") are normalised to the
 * synthetic sentinel "seveninch" BEFORE the digit-stripping step so that the
 * numeric character "7" is not lost by /[^a-z\s]/g.
 */
function doughVariantQualifierKey(label: string): string {
  let norm = label.toLowerCase().replace(/\bcrb\b/g, " ");
  // Normalise 7-inch die-size patterns to the sentinel "seveninch" BEFORE the
  // step that strips digits / punctuation. Two cases:
  //   1. "7 inch" / "7inches"  → word-boundary on both sides.
  //   2. "7\"" / "7''" etc.   → "7" followed by any non-word/non-space
  //      punctuation that is NOT immediately trailed by a digit (excludes
  //      decimal weights like "7.6").
  norm = norm.replace(/\b7\s*inch(?:es)?\b/gi, " seveninch ");
  norm = norm.replace(/\b7\s*[^\w\s]+(?!\d)/g, " seveninch ");
  norm = norm
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const q of DOUGH_VARIANT_QUALIFIERS) {
    if (norm.includes(q)) return q;
  }
  return "";
}

/** Strip qualifier keywords and "crb" from a label to extract the bare brand name. */
function doughVariantStripQualifier(lhs: string): string {
  let s = lhs.replace(/\bcrb\b/gi, " ");
  for (const q of DOUGH_VARIANT_QUALIFIERS) {
    const re = new RegExp(`\\b${q.replace(/\s+/g, "\\s+")}\\b`, "gi");
    s = s.replace(re, " ");
  }
  // Strip 7-inch die-size indicators using the same two-step approach as
  // doughVariantQualifierKey so that all quote styles (straight, curly) and
  // "7 inch" are handled uniformly without leaving trailing quote chars.
  s = s.replace(/\b7\s*inch(?:es)?\b/gi, " ");
  s = s.replace(/\b7\s*[^\w\s]+(?!\d)/g, " ");
  return s.replace(/\s+/g, " ").replace(/[,.:;]+$/, "").trim();
}

/** A parsed brand→flavor entry from a dough mixing procedure sheet header. */
export interface DoughCustomerAssignment {
  /** Brand name with qualifier keywords stripped (e.g. "Lucia's Craft"). */
  brand: string;
  /**
   * Canonical qualifier key for variant matching. One of the
   * DOUGH_VARIANT_QUALIFIERS values, or "" for base (no-qualifier) variants.
   */
  qualifierKey: string;
  /**
   * Specific product flavors of this brand that use the variant. An empty
   * string means "all flavors" (parsed from the workbook's "All" entry).
   */
  flavors: string[];
}

/** One entry from the doughball yield table in a dough mixing procedure. */
export interface DoughVariantTableEntry {
  label: string;
  weightOz: number;
  perTray?: number;
}

/**
 * Parse the doughball yield/variant table from a dough mixing procedure sheet.
 * The table is identified by a header row that contains an "OZ" column and a
 * "TRAY" column (in that order); subsequent rows supply the label, oz, and
 * per-tray count for each doughball variant. Pure — no side effects.
 *
 * Example table (rows 31-34 of a Brand+Corky's mixing workbook):
 *   | | OZ. | LBS. | YIELD | PER TRAY |
 *   | BRAND 7" DOUGH    | 6.2  | … | 24 |
 *   | BRAND 12" DOUGH   | 14.2 | … | 16 |
 *   | CORKY'S 7" DOUGH  | 5    | … | 24 |
 */
export function parseDoughVariantTable(rows: string[][]): DoughVariantTableEntry[] {
  // Find the header row: a row with an "OZ" cell and a later "TRAY" cell.
  let ozCol = -1;
  let trayCol = -1;
  let labelCol = -1;
  let headerIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let foundOz = -1;
    let foundTray = -1;
    for (let j = 0; j < row.length; j++) {
      const cell = row[j]!.trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
      if (cell === "OZ") foundOz = j;
      else if (/\bTRAY\b/.test(cell)) foundTray = j;
    }
    if (foundOz >= 0 && foundTray > foundOz) {
      ozCol = foundOz;
      trayCol = foundTray;
      // Label is in the column immediately to the left of the OZ column.
      labelCol = Math.max(0, ozCol - 1);
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) return [];

  const result: DoughVariantTableEntry[] = [];
  let blankStreak = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.every((c) => !c.trim())) {
      if (++blankStreak >= 2) break;
      continue;
    }
    blankStreak = 0;

    // Scan leftward from labelCol: some workbooks place the label one column
    // further left than expected (e.g. label in col 0 with a blank col 1 gap
    // when ozCol=2), while others indent it one column to the right of col 0.
    let label = "";
    for (let lc = labelCol; lc >= 0; lc--) {
      // Normalize embedded newlines (literal \n / \r in cell text produced by
      // multi-line Excel cells) to spaces so the label is a single clean line
      // (e.g. "LOWE'S, HANNAFORD, LUCIA CRAFT, \nNOB HILL CRAFT Thick (Argus)"
      // → "LOWE'S, HANNAFORD, LUCIA CRAFT, NOB HILL CRAFT Thick (Argus)").
      const candidate = (row[lc] ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      if (candidate) { label = candidate; break; }
    }
    if (!label) continue;

    const oz = parseFloat((row[ozCol] ?? "").trim());
    if (!(oz > 0)) continue; // not a valid data row

    const tray = parseInt((row[trayCol] ?? "").trim(), 10);

    result.push({
      label,
      weightOz: oz,
      ...(tray > 0 ? { perTray: tray } : {}),
    });
  }

  return result;
}

/**
 * Parse the customer-assignment section at the top of a dough mixing procedure
 * sheet. Each row has the form "{Brand [qualifier]}: {flavor1, flavor2, …}"
 * where "All" means any flavor of that brand. Scans the entire sheet — the
 * section may appear before OR after the ingredient/yield tables. Rows
 * without a colon, with a numeric LHS, or containing "lbs"/"oz" in the LHS
 * are skipped. Pure — no side effects.
 */
export function parseDoughCustomerSection(rows: string[][]): DoughCustomerAssignment[] {
  const result: DoughCustomerAssignment[] = [];
  for (const row of rows) {
    // Scan across all columns for the first cell that contains a colon —
    // the customer-assignment section may live in column 0, an indented
    // column, or in a right-hand column alongside the yield table, depending
    // on the workbook revision. Non-customer cells (OZ, LBS, numbers, etc.)
    // are filtered out by the guards below.
    let cell = "";
    for (const c of row) {
      const candidate = (c == null ? "" : String(c)).trim();
      if (candidate && candidate.includes(":")) { cell = candidate; break; }
    }
    if (!cell) continue;
    // Skip obvious header tokens (LBS, OZ, Yield, etc.)
    if (/^\s*(?:lbs?|oz|yield|per\s+tray)\s*$/i.test(cell)) continue;
    const colonIdx = cell.indexOf(":");
    if (colonIdx <= 0 || colonIdx >= cell.length - 1) continue;
    const lhs = cell.slice(0, colonIdx).trim();
    const rhs = cell.slice(colonIdx + 1).trim();
    if (!lhs || !rhs) continue;
    // Skip rows whose LHS starts with a plain number (formula/percentage rows
    // like "100% Bread Flour: 45") but NOT brand names that start with a digit
    // followed immediately by a letter (e.g. "4Hand's CRB Heavy").
    if (/^\d[^a-zA-Z]/i.test(lhs) || /\blbs?\b|\boz\b/i.test(lhs)) continue;
    // Parse flavors (comma-separated; "All" → catch-all = empty string)
    const flavors = rhs
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (f.toLowerCase() === "all" ? "" : f));
    if (flavors.length === 0) continue;
    const qualifierKey = doughVariantQualifierKey(lhs);
    const strippedBrand = doughVariantStripQualifier(lhs);
    if (!strippedBrand) continue;
    // Split "&"-joined multi-brand entries into individual assignments so each
    // brand name can be matched against variant labels independently.
    // E.g. "Lowe's & Lucia's Craft CRB Heavy Plus" → "Lowe's" + "Lucia's Craft"
    const brandParts = strippedBrand.split(/\s*&\s*/).map((b) => b.trim()).filter(Boolean);
    for (const brand of brandParts) {
      result.push({ brand, qualifierKey, flavors });
    }
    // Also push the FULL pre-split compound brand so matchDoughballVariant can
    // find the variant by the exact full brand name. The "&" split above handles
    // genuine two-brand entries ("Lowe's & Lucia's Craft"), but can also produce
    // phantom parts for single brands that contain "&" in their name
    // (e.g. "Lucia's New & Improved" → parts "Lucia's New" + "Improved").
    // Storing the original ensures matchDoughballVariant's customer-name lookup
    // succeeds when the profile brand is the full compound string.
    if (brandParts.length > 1) {
      result.push({ brand: strippedBrand, qualifierKey, flavors });
    }
  }
  return result;
}

/**
 * Find which parsed customer assignments apply to a given variant label, given
 * the full pool of all variants for this recipe family.
 *
 * Matching rules (qualifier must agree, then brand):
 * 1. Base-qualifier (key=""): brand name must appear in the variant label.
 * 2. Non-base qualifier — strict: brand name appears in the variant label.
 * 3. Non-base qualifier — fallback: brand has NO dedicated variant for this
 *    qualifier in the pool (e.g. "Lucia's Craft Ultra Thin" shares "Basha's
 *    Ultra Thin" because there's no "Lucia's Craft" ultra-thin variant label).
 */
function assignmentsForVariant(
  variantLabel: string,
  assignments: DoughCustomerAssignment[],
  allVariants: ReadonlyArray<DoughballVariant>,
): DoughCustomerAssignment[] {
  const vLabelLow = variantLabel.toLowerCase();
  const vQualKey = doughVariantQualifierKey(variantLabel);

  // Pre-compute once: is the base-qualifier portion of the pool "branded"?
  // A pool is branded when at least one base-qualifier variant's label contains
  // a base assignment's brand (e.g. a "Hannaford" or "Costco" variant). When
  // the pool is NOT branded — all base variants have generic labels like
  // "Brand Dough 14.2 oz" — every base assignment should apply to every base
  // variant (the generic catch-all fallback).
  let basePoolIsBranded: boolean | undefined;
  function checkBasePoolBranded(): boolean {
    if (basePoolIsBranded !== undefined) return basePoolIsBranded;
    const baseAssignmentBrands = assignments
      .filter((a2) => a2.qualifierKey === "")
      .map((a2) => a2.brand.toLowerCase());
    basePoolIsBranded = allVariants.some((v) => {
      if (doughVariantQualifierKey(v.label) !== "") return false;
      const vl = v.label.toLowerCase();
      return baseAssignmentBrands.some((b) => vl.includes(b));
    });
    return basePoolIsBranded;
  }

  return assignments.filter((a) => {
    if (a.qualifierKey !== vQualKey) return false;
    const brandLow = a.brand.toLowerCase();

    // Step 1: strict — brand name appears verbatim in the variant label.
    if (vLabelLow.includes(brandLow)) return true;

    if (a.qualifierKey === "") {
      // Base-qualifier fallback: if the pool has NO branded base variant (all
      // labels are generic, like "Brand Dough 14.2 oz"), treat every base
      // variant as a catch-all and assign every base entry to it.
      return !checkBasePoolBranded();
    }

    // Non-base fallback: brand has no label with this qualifier in the full
    // variant pool (shared variant — brand uses another brand's named variant,
    // e.g. "Lucia's Craft Ultra Thin" shares "Basha's Ultra Thin").
    const brandHasDedicated = allVariants.some(
      (v) =>
        doughVariantQualifierKey(v.label) === a.qualifierKey &&
        v.label.toLowerCase().includes(brandLow),
    );
    return !brandHasDedicated;
  });
}

/**
 * Apply parsed customer assignments to a doughball variant list, returning a
 * new list with `customers` populated where assignments match. Pure.
 *
 * Pass `allVariants` when the full set of variants for the recipe family is
 * known — it enables the shared-variant fallback (rule 3 above). Omit to skip
 * that fallback (safe when every variant has a brand-specific label entry).
 */
export function applyDoughCustomerAssignmentsToVariants(
  variants: DoughballVariant[],
  assignments: DoughCustomerAssignment[],
  allVariants?: ReadonlyArray<DoughballVariant>,
): DoughballVariant[] {
  if (assignments.length === 0) return variants;
  const pool = allVariants ?? variants;
  let changed = false;
  const result = variants.map((variant) => {
    const matching = assignmentsForVariant(variant.label, assignments, pool);
    if (matching.length === 0) return variant;
    const newCustomers = matching.flatMap((a) =>
      a.flavors.map((f) => ({ brand: a.brand, flavor: f })),
    );
    const united = unionVariantCustomers(variant.customers, newCustomers);
    if (!united) return variant;
    changed = true;
    return { ...variant, customers: united };
  });
  return changed ? result : variants;
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
 * Backfill a merge TARGET dough/sauce recipe from the recipes being merged
 * away, BEFORE the sources are deleted from the server pool. Blank-fill-only:
 * real data on the target is never clobbered — sources only fill gaps.
 * Component rows are matched by loose ingredient name (lbs filled only where
 * the target has none; source-only rows appended); notes fill only when blank;
 * brand (+ flavors) are adopted only when the target has NO brand (a branded
 * recipe's empty flavors list means "all varieties" and is left alone);
 * doughballWeightOz / doughballsPerTray fill only when unset; doughball
 * variants merge additively by label (target's variants win). Sources fold in
 * order. Returns the enriched recipe, or null when nothing changed. Pure.
 */
export function backfillNamedRecipeFromMergedSources(
  target: NamedRecipe,
  sources: ReadonlyArray<NamedRecipe>,
): NamedRecipe | null {
  let changed = false;
  const next: NamedRecipe = {
    ...target,
    components: target.components.map((c) => ({ ...c })),
    flavors: [...target.flavors],
    doughballVariants: target.doughballVariants
      ? target.doughballVariants.map((v) => ({ ...v }))
      : undefined,
  };
  for (const src of sources) {
    if (!next.notes.trim() && src.notes.trim()) {
      next.notes = src.notes;
      changed = true;
    }
    if (!next.brand.trim() && src.brand.trim()) {
      next.brand = src.brand;
      if (next.flavors.length === 0 && src.flavors.length > 0) {
        next.flavors = [...src.flavors];
      }
      changed = true;
    }
    if (!((next.doughballWeightOz ?? 0) > 0) && (src.doughballWeightOz ?? 0) > 0) {
      next.doughballWeightOz = src.doughballWeightOz;
      changed = true;
    }
    if (!((next.doughballsPerTray ?? 0) > 0) && (src.doughballsPerTray ?? 0) > 0) {
      next.doughballsPerTray = src.doughballsPerTray;
      changed = true;
    }
    if ((src.doughballVariants ?? []).length > 0) {
      // Suffix-equivalence keys ("Corner Booth CRB Dough" ≡ "Corner Booth")
      // so a merged-away source can't re-append a suffixed twin of a variant
      // the target already carries — but contradicting numbers mean a
      // genuinely different variant, which must survive the union.
      const have = new Map<string, DoughballVariant>(
        (next.doughballVariants ?? []).map((v) => [
          doughballVariantLabelKey(v.label, target.name),
          v,
        ]),
      );
      for (const v of src.doughballVariants ?? []) {
        if (!v.label.trim()) continue;
        const key = doughballVariantLabelKey(v.label, target.name);
        const existing = have.get(key);
        if (
          existing &&
          doughballVariantValuesCompatible(existing, v, { strict: true })
        ) {
          continue;
        }
        if (!existing) have.set(key, v);
        next.doughballVariants = [...(next.doughballVariants ?? []), { ...v }];
        changed = true;
      }
    }
    const byKey = new Map<string, NamedRecipeComponent>();
    for (const c of next.components) {
      const key = looseMergeIngredientKey(c.ingredient);
      if (key && !byKey.has(key)) byKey.set(key, c);
    }
    for (const sc of src.components) {
      const key = looseMergeIngredientKey(sc.ingredient);
      if (!key) continue;
      const tc = byKey.get(key);
      if (!tc) {
        const added: NamedRecipeComponent = { ingredient: sc.ingredient, lbs: sc.lbs };
        next.components.push(added);
        byKey.set(key, added);
        changed = true;
        continue;
      }
      if (!(tc.lbs > 0) && sc.lbs > 0) {
        tc.lbs = sc.lbs;
        changed = true;
      }
    }
  }
  if (!changed) return null;
  if (!next.doughballVariants || next.doughballVariants.length === 0) {
    delete next.doughballVariants;
  }
  return next;
}

// Normalize a list, dropping malformed entries and collapsing duplicate ids onto
// the last-seen entry.
export function normalizeNamedRecipes(input: unknown): NamedRecipe[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, NamedRecipe>();
  for (const raw of input) {
    const recipe = normalizeNamedRecipe(raw);
    if (!recipe) continue;
    byId.set(recipe.id, recipe);
  }
  return Array.from(byId.values());
}

// Total pounds of the recipe (sum of component pounds).
export function namedRecipeTotalLbs(recipe: NamedRecipe): number {
  return recipe.components.reduce((acc, c) => acc + c.lbs, 0);
}

/** Case-insensitive match of a search query against name/ingredients. */
export function namedRecipeMatchesQuery(
  recipe: NamedRecipe,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    recipe.name.toLowerCase().includes(q) ||
    recipe.components.some((c) => c.ingredient.toLowerCase().includes(q))
  );
}

/**
 * Sort recipes by name (case-insensitive) for a browsable settings list. Pure —
 * used by BOTH web and mobile so the two lists can't drift.
 */
export function sortNamedRecipesByName(
  recipes: ReadonlyArray<NamedRecipe>,
): NamedRecipe[] {
  return [...recipes].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Re-point named-recipe (dough/sauce) COMPONENT ingredient names when an
 * ingredient is merged in the Merge tool. Named recipes are server-backed
 * master-data (their own tables, NOT part of day-state sync), so an ingredient
 * merge — which only rewrites local lists/presets/runs — leaves the server
 * recipes naming the merged-away ingredient, and it resurfaces when a run
 * hydrates its rows from the pool. Rewrites each matching component's
 * `ingredient` to the target; rows are NOT combined (a recipe that named two
 * now-merged ingredients keeps both rows so its total weight is preserved
 * exactly, mirroring mergeRecipeRows). Returns ONLY the recipes that changed
 * (so the caller can upsert just those), matched case-insensitively.
 */
export function repointNamedRecipeIngredients(
  recipes: ReadonlyArray<NamedRecipe>,
  sources: ReadonlyArray<string>,
  target: string,
): NamedRecipe[] {
  const tgt = target.trim();
  if (!tgt) return [];
  const srcSet = new Set(
    sources
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== tgt.toLowerCase()),
  );
  if (srcSet.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    if (!r.components.some((c) => srcSet.has(c.ingredient.trim().toLowerCase())))
      continue;
    changed.push({
      ...r,
      components: r.components.map((c) =>
        srcSet.has(c.ingredient.trim().toLowerCase())
          ? { ...c, ingredient: tgt }
          : c,
      ),
    });
  }
  return changed;
}

/**
 * Build a well-formed NamedRecipe from a name + component rows using a
 * deterministic, name-slug id (prefixed so dough and sauce ids never collide,
 * and so re-importing/re-migrating the same name targets the same recipe instead
 * of duplicating it). enabled is true so run pickers see it right away. Returns
 * null for a blank name. Pure — shared by web + mobile.
 */
export function namedRecipeFromDraft(draft: {
  name: string;
  components: ReadonlyArray<{ ingredient: string; lbs: number }>;
  idPrefix: string;
  notes?: string;
  brand?: string;
  flavors?: ReadonlyArray<string>;
  doughballWeightOz?: number;
  doughballsPerTray?: number;
}): NamedRecipe | null {
  const name = draft.name.trim();
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = draft.idPrefix.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return normalizeNamedRecipe({
    id: slug ? `${prefix}:${slug}` : `${prefix}:${name.toLowerCase()}`,
    name,
    notes: draft.notes ?? "",
    components: draft.components,
    enabled: true,
    brand: draft.brand ?? "",
    flavors: draft.flavors ?? [],
    doughballWeightOz: draft.doughballWeightOz,
    doughballsPerTray: draft.doughballsPerTray,
  });
}

// ---------------------------------------------------------------------------
// Brand/flavor tag fill (spec-import backfill)
// ---------------------------------------------------------------------------

/** "Who it goes to" tag learned for one recipe name during a spec import. */
export interface NamedRecipeTag {
  brand: string;
  /** Empty = all varieties of `brand` (whole-brand / catch-all recipe). */
  flavors: string[];
}

/**
 * Additively fill brand/flavor tags onto EXISTING pool recipes from what a spec
 * import just learned, without ever fighting a manager's explicit tags:
 * - untagged recipe (no brand) + learned tag → adopt the learned brand/flavors
 * - same brand (case-insensitive) → union the learned flavors in; a recipe
 *   already tagged "all varieties" (brand set, no flavors) stays all-varieties
 * - different brand already set → left untouched (the manager's tag wins)
 * Matching is by recipe NAME (case-insensitive). Returns ONLY the recipes that
 * changed so the caller can save just those. Pure — shared web/mobile.
 */
export function fillNamedRecipeTags(
  recipes: ReadonlyArray<NamedRecipe>,
  tagsByName: ReadonlyMap<string, NamedRecipeTag> | Record<string, NamedRecipeTag>,
): NamedRecipe[] {
  const tags = new Map<string, NamedRecipeTag>();
  const entries =
    tagsByName instanceof Map
      ? tagsByName.entries()
      : Object.entries(tagsByName);
  for (const [name, tag] of entries) {
    const key = (name ?? "").trim().toLowerCase();
    const brand = (tag?.brand ?? "").trim();
    if (!key || !brand) continue;
    tags.set(key, {
      brand,
      flavors: normalizeNamedRecipeFlavors(tag.flavors),
    });
  }
  if (tags.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const tag = tags.get(r.name.trim().toLowerCase());
    if (!tag) continue;
    if (!r.brand) {
      changed.push({ ...r, brand: tag.brand, flavors: [...tag.flavors] });
      continue;
    }
    if (r.brand.trim().toLowerCase() !== tag.brand.toLowerCase()) continue;
    // Same brand: union flavors — but "all varieties" (empty flavors) stays.
    if (r.flavors.length === 0) continue;
    if (tag.flavors.length === 0) {
      // Import says whole-brand; widen to all varieties.
      changed.push({ ...r, flavors: [] });
      continue;
    }
    const have = new Set(r.flavors.map((f) => f.toLowerCase()));
    const extra = tag.flavors.filter((f) => !have.has(f.toLowerCase()));
    if (extra.length === 0) continue;
    changed.push({ ...r, flavors: [...r.flavors, ...extra] });
  }
  return changed;
}

/**
 * Backfill doughball weights onto EXISTING pool dough recipes from what a spec
 * import just learned, without ever fighting a manager's explicit value: only
 * recipes whose weight is unset/0 adopt the learned weight. Matching is by
 * recipe NAME (case-insensitive). Returns ONLY the recipes that changed so the
 * caller can save just those. Pure — mirrors fillNamedRecipeTags.
 */
export function fillNamedRecipeDoughballWeights(
  recipes: ReadonlyArray<NamedRecipe>,
  weightsByName: ReadonlyMap<string, number> | Record<string, number>,
): NamedRecipe[] {
  const weights = new Map<string, number>();
  const entries =
    weightsByName instanceof Map
      ? weightsByName.entries()
      : Object.entries(weightsByName);
  for (const [name, oz] of entries) {
    const key = (name ?? "").trim().toLowerCase();
    if (!key || !Number.isFinite(oz) || oz <= 0) continue;
    weights.set(key, oz);
  }
  if (weights.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const oz = weights.get(r.name.trim().toLowerCase());
    if (oz === undefined) continue;
    if ((r.doughballWeightOz ?? 0) > 0) continue;
    changed.push({ ...r, doughballWeightOz: oz });
  }
  return changed;
}

/**
 * Backfill doughballs-per-tray onto EXISTING pool dough recipes from what a
 * spec import just learned, without ever fighting a manager's explicit value:
 * only recipes whose per-tray count is unset/0 adopt the learned count.
 * Matching is by recipe NAME (case-insensitive). Returns ONLY the recipes that
 * changed so the caller can save just those. Pure — mirrors
 * fillNamedRecipeDoughballWeights.
 */
export function fillNamedRecipeDoughballsPerTray(
  recipes: ReadonlyArray<NamedRecipe>,
  traysByName: ReadonlyMap<string, number> | Record<string, number>,
): NamedRecipe[] {
  const trays = new Map<string, number>();
  const entries =
    traysByName instanceof Map
      ? traysByName.entries()
      : Object.entries(traysByName);
  for (const [name, count] of entries) {
    const key = (name ?? "").trim().toLowerCase();
    const n = Math.round(count);
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    trays.set(key, n);
  }
  if (trays.size === 0) return [];
  const changed: NamedRecipe[] = [];
  for (const r of recipes) {
    const n = trays.get(r.name.trim().toLowerCase());
    if (n === undefined) continue;
    if ((r.doughballsPerTray ?? 0) > 0) continue;
    changed.push({ ...r, doughballsPerTray: n });
  }
  return changed;
}

// ---------------------------------------------------------------------------
// One-time local→server name consolidation planning
// ---------------------------------------------------------------------------

/**
 * The consolidation decision for one master-data pool: which device-local
 * recipe names should be PUSHED to the server pool (they become canonical
 * entries), which are near-duplicate VARIANTS of an existing (or newly pushed)
 * name and should be merged into it, and which already exist on the server
 * verbatim (nothing to push — just clean up the local list).
 */
export interface NameConsolidationPlan {
  /** Local-only names to add to the server pool, in canonical-first order. */
  additions: string[];
  /** Variant local name → the canonical name it should be merged into. */
  renames: Record<string, string>;
  /** Local names already in the server pool (case-insensitive exact match). */
  alreadyPresent: string[];
}

/**
 * Plan how a device-local recipe-name list folds into its server master-data
 * pool so run-form pickers and Manage Lists converge on ONE canonical entry per
 * recipe. Matching uses the shared near-dup layers (word order / single typo,
 * ambiguity + digit guards; the extra-word layer stays OFF — "Garlic Alfredo"
 * must NOT fold into "Alfredo Sauce"), with kind-generic filler tokens (e.g.
 * "sauce", "recipe") stripped from the key so "Mystic", "Mystic Recipe" and
 * "mystic sauce" all resolve to the same recipe.
 *
 * Two passes: (1) each local name is matched against the server pool — an exact
 * case-insensitive hit is reported as already-present, a near-dup hit becomes a
 * rename onto the server spelling; (2) the remaining local-only names are
 * deduped among THEMSELVES — `preferAsCanonical` (e.g. "has saved recipe rows")
 * then shorter-name/alphabetical order picks the canonical spelling, and the
 * other variants become renames onto it. Pure.
 */
export function planNameConsolidation(opts: {
  localNames: ReadonlyArray<string>;
  serverNames: ReadonlyArray<string>;
  /**
   * Kind-generic filler tokens stripped (lowercased) from the match key, on
   * top of the shared generic fillers looseNameKey already removes. If
   * stripping would empty the key, the unstripped key is kept ("Sauce" stays
   * "sauce", it does not match everything).
   */
  genericTokens?: ReadonlyArray<string>;
  /** Prefer this name as the canonical spelling when deduping local names. */
  preferAsCanonical?: (name: string) => boolean;
}): NameConsolidationPlan {
  const generic = new Set(
    (opts.genericTokens ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const keyOf = (name: string): string => {
    const base = looseNameKey(name);
    if (!base) return base;
    const tokens = base.split(" ");
    const kept = tokens.filter((t) => !generic.has(t));
    return (kept.length ? kept : tokens).join(" ");
  };

  // Server pool, first spelling wins per case-insensitive name.
  const serverByCi = new Map<string, string>();
  for (const raw of opts.serverNames) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const ci = name.toLowerCase();
    if (!serverByCi.has(ci)) serverByCi.set(ci, name);
  }

  // Clean + ci-dedupe the local list (first spelling wins).
  const locals: string[] = [];
  const seenLocal = new Set<string>();
  for (const raw of opts.localNames) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const ci = name.toLowerCase();
    if (seenLocal.has(ci)) continue;
    seenLocal.add(ci);
    locals.push(name);
  }

  const alreadyPresent: string[] = [];
  const renames: Record<string, string> = {};
  const rest: string[] = [];
  const matchServer = buildNearDupNameMatcher([...serverByCi.values()], {
    keyOf,
  });
  for (const name of locals) {
    const exact = serverByCi.get(name.toLowerCase());
    if (exact) {
      alreadyPresent.push(name);
      continue;
    }
    const hit = matchServer(name);
    if (hit && hit.toLowerCase() !== name.toLowerCase()) {
      renames[name] = hit;
      continue;
    }
    rest.push(name);
  }

  // Dedupe the remaining local-only names among themselves. Canonical
  // preference: caller's predicate (e.g. has saved rows), then the shorter
  // spelling, then alphabetical. The matcher is rebuilt per accepted addition —
  // fine here because this is a ONE-TIME migration over small pools (≤ ~100
  // names), not a per-keystroke scan.
  const prefer = opts.preferAsCanonical ?? (() => false);
  rest.sort(
    (a, b) =>
      Number(prefer(b)) - Number(prefer(a)) ||
      a.length - b.length ||
      a.localeCompare(b),
  );
  const additions: string[] = [];
  for (const name of rest) {
    const hit =
      additions.length > 0
        ? buildNearDupNameMatcher(additions, { keyOf })(name)
        : null;
    if (hit && hit.toLowerCase() !== name.toLowerCase()) {
      renames[name] = hit;
    } else {
      additions.push(name);
    }
  }

  return { additions, renames, alreadyPresent };
}

/**
 * Add recipes to the existing pool, skipping any whose NAME already exists
 * (case-insensitive) OR whose id already exists. This is the "match, don't
 * clobber" rule used by the one-time local→server migration and by spec-import:
 * a recipe of the same name already on the server is left untouched, while a
 * genuinely new one is appended. Pure. Returns the merged list plus how many
 * were actually added.
 */
export function addNamedRecipesIfAbsentByName(
  existing: ReadonlyArray<NamedRecipe>,
  candidates: ReadonlyArray<NamedRecipe>,
): { merged: NamedRecipe[]; added: number } {
  // Near-dup layers (loose key, word order, single typo — each with ambiguity
  // + digit guards) so an import whose name only drifts in labeling links to
  // the recipe the factory already keeps instead of forking a parallel entry.
  // The extra-word layer stays OFF: "Spicy Sauce" is not "Sauce".
  const matchExisting = buildNearDupNameMatcher(existing.map((r) => r.name));
  const haveNames = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const haveIds = new Set(existing.map((r) => r.id));
  const merged: NamedRecipe[] = [...existing];
  let added = 0;
  for (const c of candidates) {
    const nameKey = c.name.trim().toLowerCase();
    if (
      !nameKey ||
      haveNames.has(nameKey) ||
      haveIds.has(c.id) ||
      matchExisting(c.name) !== null
    ) {
      continue;
    }
    haveNames.add(nameKey);
    haveIds.add(c.id);
    merged.push(c);
    added++;
  }
  return { merged, added };
}

/**
 * Upsert named recipes by name: update existing recipes' components and numeric
 * doughball fields from the candidate when a name match is found (exact or
 * near-dup), and append genuinely new ones.
 *
 * Preservation rules for matched existing recipes:
 * - `components`: replaced wholesale when the candidate has any rows (empty
 *   candidate list = "not stated by the file", so existing rows survive).
 * - `doughballsPerTray`: updated when candidate provides a non-zero value.
 * - `doughballWeightOz`: updated when candidate provides a non-zero value;
 *   a manager-typed weight is preserved when the candidate omits it or has 0.
 * - All other fields (`notes`, `brand`, `flavors`, `enabled`, `scope`,
 *   `doughballVariants`) are preserved from the existing recipe.
 *
 * Pure. Returns the merged list plus how many were added vs. updated.
 */
export function upsertNamedRecipesByName(
  existing: ReadonlyArray<NamedRecipe>,
  candidates: ReadonlyArray<NamedRecipe>,
): { merged: NamedRecipe[]; added: number; updated: number } {
  const matchExisting = buildNearDupNameMatcher(existing.map((r) => r.name));
  const nameKeyOf = (name: string): string => (name ?? "").trim().toLowerCase();
  const byNameKey = new Map<string, NamedRecipe>();
  for (const r of existing) {
    const k = nameKeyOf(r.name);
    if (k && !byNameKey.has(k)) byNameKey.set(k, r);
  }
  const haveNames = new Set(existing.map((r) => nameKeyOf(r.name)));
  const haveIds = new Set(existing.map((r) => r.id));

  const merged: NamedRecipe[] = [...existing];
  let added = 0;
  let updated = 0;

  for (const c of candidates) {
    const nameKey = nameKeyOf(c.name);
    if (!nameKey) continue;

    // Find existing match: exact name key first, then id, then near-dup.
    let existingRecipe: NamedRecipe | undefined = byNameKey.get(nameKey);
    if (!existingRecipe && haveIds.has(c.id)) {
      existingRecipe = existing.find((r) => r.id === c.id);
    }
    if (!existingRecipe) {
      const nearDupName = matchExisting(c.name);
      if (nearDupName) existingRecipe = byNameKey.get(nameKeyOf(nearDupName));
    }

    if (existingRecipe) {
      // UPDATE existing: replace components when candidate has rows, update
      // numeric doughball fields when candidate provides non-zero values.
      const idx = merged.findIndex((r) => r.id === existingRecipe!.id);
      if (idx < 0) continue;
      const updatedRecipe: NamedRecipe = {
        ...existingRecipe,
        ...(c.components.length > 0 ? { components: c.components } : {}),
        ...(c.doughballsPerTray != null && c.doughballsPerTray > 0
          ? { doughballsPerTray: c.doughballsPerTray }
          : {}),
        ...(c.doughballWeightOz != null && c.doughballWeightOz > 0
          ? { doughballWeightOz: c.doughballWeightOz }
          : {}),
      };
      const changed =
        JSON.stringify(updatedRecipe.components) !==
          JSON.stringify(existingRecipe.components) ||
        (updatedRecipe.doughballsPerTray ?? 0) !==
          (existingRecipe.doughballsPerTray ?? 0) ||
        (updatedRecipe.doughballWeightOz ?? 0) !==
          (existingRecipe.doughballWeightOz ?? 0);
      if (changed) {
        merged[idx] = updatedRecipe;
        updated++;
      }
      continue;
    }

    // ADD: genuinely new recipe — not found by any match.
    haveNames.add(nameKey);
    haveIds.add(c.id);
    byNameKey.set(nameKey, c);
    merged.push(c);
    added++;
  }

  return { merged, added, updated };
}

export { SPEC_STATIC_CUSTOMER_ASSIGNMENTS } from "./spec-customer-assignments.js";
