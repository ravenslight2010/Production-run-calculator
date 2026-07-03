// Shared freezer-pull model for the run calculator (web + mobile parity).
//
// Some ingredients (e.g. premix items) must be pulled out of the freezer a few
// days BEFORE the run that uses them so they can thaw/temper in time. Managers
// tag those ingredients factory-wide, each with its own "pull N days early"
// value (default 3). The warehouse tab then shows a "Pull Out Freezer for
// [date]" card once an upcoming scheduled run is within an item's days-early
// window AND that run's recipe actually uses the item.
//
// This module is PURE so both apps compute the same plan. The freezer-pull
// config is stored factory-wide on the server (NOT in the per-day sync
// payload) and edited by managers only; this module only models the config and
// builds the plan from already-resolved per-run ingredient rows. Each app
// resolves a scheduled run -> its recipe need rows using its own existing
// profile/need-row code, then feeds {name, quantity, unit} rows in here. The
// match key is the need-row label, the same join key the staging checklist
// uses, so web and mobile line up exactly.

export const DEFAULT_DAYS_EARLY = 3;

// A single manager-tagged freezer-pull ingredient. Flat shape so it serializes
// cleanly to the API/DB and is easy to edit field-by-field in the UI.
export interface FreezerPullItem {
  id: string;
  // Optional persistence scope (live vs sandbox); carried through opaquely.
  scope?: string;
  // The ingredient name, matched case-insensitively against a run's need-row
  // labels (e.g. a pepperoni type, a cheese/app mix name, "Dough", "Sauce").
  ingredient: string;
  // How many days before the run this item must be pulled from the freezer.
  daysEarly: number;
  // Disabled items are kept (so toggling is easy) but never produce a notice.
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

// Coerce a raw API/DB record into a clean FreezerPullItem, or null if it has no
// usable ingredient name. daysEarly defaults to 3 and is clamped to >= 0;
// enabled defaults to true.
export function normalizeFreezerPullItem(input: unknown): FreezerPullItem | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const ingredient =
    typeof raw.ingredient === "string" ? raw.ingredient.trim() : "";
  if (!ingredient) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id : ingredient.toLowerCase();
  const daysEarly = Math.max(0, coerceInt(raw.daysEarly, DEFAULT_DAYS_EARLY));
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false;
  const item: FreezerPullItem = { id, ingredient, daysEarly, enabled };
  if (typeof raw.scope === "string" && raw.scope) item.scope = raw.scope;
  return item;
}

// A requested freezer-pull setting (e.g. picked out of a premix sheet's
// "Pull N days early" note): tag this ingredient with this lead time.
export interface FreezerPullRequest {
  ingredient: string;
  daysEarly: number;
}

/**
 * Turn requested settings into the minimal list of items to POST (the server
 * upserts item-by-item). Matching an EXISTING item (by ingredient,
 * case-insensitive) keeps its id/scope and updates daysEarly (+ re-enables it);
 * unmatched requests become new items using the default id convention
 * (lowercased ingredient). Requests that change nothing are dropped, as are
 * blank ingredients and non-positive daysEarly. Duplicate requests collapse
 * onto the LARGEST daysEarly (the safest lead time wins). Pure.
 */
export function buildFreezerPullUpserts(
  existing: ReadonlyArray<FreezerPullItem>,
  requests: ReadonlyArray<FreezerPullRequest>,
): FreezerPullItem[] {
  const byIngredient = new Map<string, FreezerPullItem>();
  for (const item of existing) {
    byIngredient.set(item.ingredient.toLowerCase(), item);
  }

  // Collapse duplicate requests (case-insensitive) onto the largest daysEarly.
  const wanted = new Map<string, FreezerPullRequest>();
  for (const req of requests) {
    const ingredient = req.ingredient.trim();
    const daysEarly = Math.trunc(req.daysEarly);
    if (!ingredient || !Number.isFinite(daysEarly) || daysEarly <= 0) continue;
    const key = ingredient.toLowerCase();
    const prev = wanted.get(key);
    if (!prev || daysEarly > prev.daysEarly) {
      wanted.set(key, { ingredient, daysEarly });
    }
  }

  const out: FreezerPullItem[] = [];
  for (const [key, req] of wanted) {
    const current = byIngredient.get(key);
    if (current) {
      if (current.daysEarly === req.daysEarly && current.enabled) continue; // already set
      out.push({ ...current, daysEarly: req.daysEarly, enabled: true });
    } else {
      out.push({
        id: key,
        ingredient: req.ingredient,
        daysEarly: req.daysEarly,
        enabled: true,
      });
    }
  }
  return out;
}

// Normalize a list, dropping malformed entries and collapsing duplicate
// ingredient names (case-insensitive) onto the last-seen entry.
export function normalizeFreezerPullItems(input: unknown): FreezerPullItem[] {
  if (!Array.isArray(input)) return [];
  const byName = new Map<string, FreezerPullItem>();
  for (const raw of input) {
    const item = normalizeFreezerPullItem(raw);
    if (!item) continue;
    byName.set(item.ingredient.toLowerCase(), item);
  }
  return Array.from(byName.values());
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

// One resolved need row for a scheduled run (already computed by each app from
// the run's profile recipe). `name` is matched against freezer-pull items.
// `quantity` is the already-formatted display value (e.g. "12.5") taken verbatim
// from each app's need-row list, so the freezer card shows exactly the same
// numbers as the rest of the warehouse tab; the lib never does math on it.
export interface FreezerRunIngredient {
  name: string;
  quantity: string;
  unit: string;
}

// A scheduled run with its resolved ingredient need rows.
export interface FreezerScheduledRun {
  date: string; // YYYY-MM-DD
  brand: string;
  flavor: string;
  ingredients: FreezerRunIngredient[];
}

// A matched freezer-pull item for a specific run.
export interface FreezerPullEntry {
  name: string;
  quantity: string;
  unit: string;
  daysEarly: number;
}

export interface FreezerPullRun {
  brand: string;
  flavor: string;
  items: FreezerPullEntry[];
}

// A "Pull Out Freezer for [date]" card: all runs on `date` that have at least
// one item due to be pulled now.
export interface FreezerPullGroup {
  date: string;
  daysUntil: number;
  runs: FreezerPullRun[];
}

// Whole-days between today and a run date (both YYYY-MM-DD). Parsed as UTC so
// the result is calendar-day based and free of timezone/DST drift.
export function daysUntil(runDate: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${runDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

// Build the freezer-pull plan: for each scheduled run, include any freezer-pull
// item whose ingredient appears in that run's need rows (case-insensitive label
// match) AND whose run is within the item's pull window
// (0 <= daysUntil(run) <= item.daysEarly). Runs in the past (daysUntil < 0) are
// skipped. Results are grouped by run date and sorted ascending by date.
export function buildFreezerPullPlan(args: {
  runs: FreezerScheduledRun[];
  freezerItems: FreezerPullItem[];
  today: string;
}): FreezerPullGroup[] {
  const { runs, today } = args;
  const items = args.freezerItems.filter((i) => i.enabled);
  if (items.length === 0) return [];
  // Lookup by lowercased ingredient name -> daysEarly.
  const byName = new Map<string, number>();
  for (const item of items) byName.set(item.ingredient.toLowerCase(), item.daysEarly);

  const groups = new Map<string, FreezerPullGroup>();
  for (const run of runs) {
    const du = daysUntil(run.date, today);
    if (!Number.isFinite(du) || du < 0) continue;
    const matched: FreezerPullEntry[] = [];
    const seen = new Set<string>();
    for (const ing of run.ingredients) {
      const key = ing.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      const daysEarly = byName.get(key);
      if (daysEarly === undefined) continue;
      if (du > daysEarly) continue; // not time to pull yet
      seen.add(key);
      matched.push({
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        daysEarly,
      });
    }
    if (matched.length === 0) continue;
    let group = groups.get(run.date);
    if (!group) {
      group = { date: run.date, daysUntil: du, runs: [] };
      groups.set(run.date, group);
    }
    group.runs.push({ brand: run.brand, flavor: run.flavor, items: matched });
  }

  return Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
}
