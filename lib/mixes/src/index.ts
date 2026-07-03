// Shared "mixes" model for the run calculator (web + mobile parity).
//
// A "mix" is a pre-blended recipe (a veggie/topping mix, a cheese mix, a dough
// mix, a sauce mix, …) that the floor makes ahead of time for a given product.
// Each mix names the product it belongs to (brand + flavor, so it can be matched
// against scheduled runs), a batch size (lbs per batch), an optional "make N days
// early" value, optional notes, an optional "amount already made", and a list of
// components — each an ingredient with a "per pizza" weight in pounds.
//
// Given a chosen make-day and that day's resolved scheduled runs (product +
// pizzas), this module computes, per run/product, how many batches to make, the
// total pounds needed, and a "Pull For Mix" breakdown of pounds per component
// (pounds = perPizza × that day's pizzas). It honors the "amount already made"
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

// Mixes are made same-day by default; a manager can opt a mix into being made
// ahead by giving it a positive "make N days early" value.
export const DEFAULT_DAYS_EARLY = 0;

// One component of a mix: an ingredient and how many pounds of it go into a
// single pizza's worth of the finished mix.
export interface MixComponent {
  ingredient: string;
  perPizza: number;
}

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
  return { ingredient, perPizza };
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
  lbs: number; // perPizza × pizzas
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
    lbs: c.perPizza * pizzas,
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
