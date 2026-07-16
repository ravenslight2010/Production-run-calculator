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
  const matchExisting = buildNearDupNameMatcher(existing.map((m) => m.name));
  const haveNames = new Set(existing.map((m) => mixNameMatchKey(m.name)));
  const merged: Mix[] = [...existing];
  let added = 0;
  for (const c of candidates) {
    const key = mixNameMatchKey(c.name);
    if (!key || haveNames.has(key) || matchExisting(c.name) !== null) continue;
    haveNames.add(key);
    merged.push(c);
    added++;
  }
  return { merged, added };
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

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

// A scheduled run resolved to its product + pizza/case counts (each app computes
// pizzas/cases from the run's profile recipe before calling in).
export interface MixScheduledRun {
  date: string; // YYYY-MM-DD
  brand: string;
  flavor: string;
  pizzas: number;
  cases: number;
}

// One component of a mix, scaled to the run's pizza count.
export interface MixComponentPlan {
  ingredient: string;
  lbs: number; // perPizza-ounces × pizzas ÷ 16
}

// A matched mix for a specific run, fully computed.
export interface MixPlanEntry {
  mixId: string;
  name: string;
  batchSize: number;
  daysEarly: number;
  notes?: string;
  // Sum of all component pounds (= total pounds of finished mix needed).
  totalLbs: number;
  amountAlreadyMade: number;
  // max(0, totalLbs - amountAlreadyMade).
  remainingLbs: number;
  // remainingLbs / batchSize (fractional; 0 when batchSize <= 0).
  batches: number;
  components: MixComponentPlan[];
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
  const totalLbs = components.reduce((acc, c) => acc + c.lbs, 0);
  const remainingLbs = Math.max(0, totalLbs - mix.amountAlreadyMade);
  const batches = mix.batchSize > 0 ? remainingLbs / mix.batchSize : 0;
  const entry: MixPlanEntry = {
    mixId: mix.id,
    name: mix.name,
    batchSize: mix.batchSize,
    daysEarly: mix.daysEarly,
    totalLbs,
    amountAlreadyMade: mix.amountAlreadyMade,
    remainingLbs,
    batches,
    components,
  };
  if (mix.notes) entry.notes = mix.notes;
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
  const mixes = args.mixes.filter((m) => m.enabled);
  if (mixes.length === 0) return [];

  // Group enabled mixes by product so each run can find all of its mixes.
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
    groups.push({ date, daysUntil: du, runs: planRuns });
  }

  return groups.sort((a, b) => a.date.localeCompare(b.date));
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
