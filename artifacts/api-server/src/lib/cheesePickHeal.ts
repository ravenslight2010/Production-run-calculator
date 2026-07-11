// Pure logic for the one-time "cheese-import-poison-cleanup-v1" data heal
// (see ./dataHeals.ts for the runner that applies it to the database).
//
// Background: an early bulk spec-sheet import (many customers' workbooks at
// once) taught the importer a set of WRONG learned matches — cheese blends from
// one customer were "corrected" onto a different customer's blend (e.g.
// "Lucia's Spinach Cheese Mix" → "Lowe's Spinach Cheese Mix"), plus a
// brand-crossing flavor alias ("BBQ Chicken" → "RED HOT CHICKEN" under Lucia's
// Craft). Later imports auto-applied those matches, which (a) kept re-poisoning
// new imports and (b) left scheduled runs pointing at ANOTHER customer's cheese
// blend — or at an orphan name that isn't in the cheese pool at all, so the run
// card shows a blend the factory would make wrong, or nothing.
//
// The heal has two halves:
//   1. DELETE the poisoned learned rows (handled in dataHeals.ts using the
//      pair lists exported here).
//   2. CLEAR the wrong cheese picks from current/future scheduled runs in the
//      daily_sync day-state blobs (the pure payload transform below), bumping
//      each cleared run's edit stamp so the protective sync merge accepts the
//      clear instead of "healing" the bad pick back in.
//
// Everything is matched case-insensitively, mirroring how the alias tables and
// the cheese pool are matched throughout the app.

const ci = (s: unknown): string => (typeof s === "string" ? s.trim().toLowerCase() : "");

// ---------------------------------------------------------------------------
// 1) Poisoned learned matches to delete.
// ---------------------------------------------------------------------------
// Each pair is [externalName, canonicalName], compared case-insensitively.
// These rows exist (identically) in spec_import_aliases (kind "appType") and
// ai_corrections (domain "item"). Every pair either points one customer's
// cheese blend at a DIFFERENT customer's blend, or at an orphan generic name
// that does not exist in the factory's cheese pool — both re-poison future
// imports. Correct same-product rows (spelling/format fixes, ingredient
// naming) are deliberately NOT listed and survive the heal.
export const POISONED_CHEESE_ALIAS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Cross-customer: one customer's blend "matched" onto another customer's.
  ["aldo's cheese mix", "red hot cheese mix"],
  ["smd four cheese mix", "red hot cheese mix"],
  ["smd pep cheese mix", "red hot cheese mix"],
  ["smd bbq chicken cheese mix", "bbq chicken cheese mix"],
  ["corner booth bbq chicken cheese mix", "bbq chicken cheese mix"],
  ["basha's pepperoni cheese mix", "lowe's pepperoni cheese mix"],
  ["basha's pepperoni/romano cheese mix", "lowe's pepperoni/romano cheese mix"],
  ["lucia's spinach cheese mix", "lowe's spinach cheese mix"],
  ["lucia's standard cheese mix", "lowe's spinach cheese mix"],
  ["lucia's pepperoni cheese mix", "lowe's pepperoni cheese mix"],
  ["lucia's pinsa pepperoni cheese mix", "lowe's pepperoni cheese mix"],
  ["lucia's pinsa pepperoni/romano cheese mix", "lowe's pepperoni/romano cheese mix"],
  ["lowe's california cheese mix", "lowe's pepperoni cheese mix"],
  ["lowe's club cheese mix", "lowe's spinach cheese mix"],
  ["lowe's spinach mushroom cheese mix", "lowe's spinach cheese mix"],
  ["lowe's/hannaford 5cheese mix", "lowe's spinach cheese mix"],
  // Orphan canonical: the "corrected" name isn't in the cheese pool at all
  // (the pool keeps customer-prefixed names), so the pick resolves to nothing.
  ["cheese burger cheese mix", "cheeseburger cheese mix"],
  ["margherita cheese mix", "pinsa margherita cheese mix"],
  ["4hands club mix", "chicken bacon club cheese mix"],
  ["4hands red hot chicken mix", "red hot chicken mix"],
  ["craft cheeseburger mix", "bacon cheeseburger mix"],
  ["lowe's cheeseburger mix", "bacon cheeseburger mix"],
] as const;

// The one poisoned brand-crossing FLAVOR match: Lucia's Craft "BBQ Chicken"
// was "corrected" to "RED HOT CHICKEN" (a different pizza). Lives in
// import_aliases (type "flavor", brand_context "Lucia's Craft") and mirrored
// contextlessly in ai_corrections (domain "flavor").
export const POISONED_FLAVOR_PAIR: readonly [string, string] = [
  "bbq chicken",
  "red hot chicken",
] as const;

// The audited brand context of the poisoned flavor alias. The import_aliases
// delete is scoped to this context so a same-named mapping under any OTHER
// brand (legitimate elsewhere) would survive.
export const POISONED_FLAVOR_BRAND_CONTEXT = "lucia's craft";

// ---------------------------------------------------------------------------
// 2) Wrong cheese picks to clear from day-state runs.
// ---------------------------------------------------------------------------
// These are the OUTPUT names the poisoned matches produced. Any run whose
// applicator cheese pick (app1..app4CheeseRecipeName) is one of these was
// poisoned — audited against production: every scheduled run carrying one of
// these names belongs to a DIFFERENT customer than the name says (or the name
// is a pool orphan), except "BBQ Chicken Cheese Mix" which is legitimate on
// Price Chopper runs only (it is Price Chopper's own blend).
export const ALWAYS_CLEAR_PICKS: ReadonlySet<string> = new Set([
  "red hot cheese mix",
  "lowe's spinach cheese mix",
  "lowe's pepperoni cheese mix",
  "lowe's pepperoni/romano cheese mix",
  "cheeseburger cheese mix",
]);

export const CONDITIONAL_CLEAR_PICK = "bbq chicken cheese mix";
export const CONDITIONAL_CLEAR_KEEP_BRAND = "price chopper";

const APP_SLOTS = [1, 2, 3, 4] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Should this cheese pick be cleared for a run of the given brand? */
export function shouldClearCheesePick(pickName: unknown, runBrand: unknown): boolean {
  const name = ci(pickName);
  if (!name) return false;
  if (ALWAYS_CLEAR_PICKS.has(name)) return true;
  if (name === CONDITIONAL_CLEAR_PICK) return ci(runBrand) !== CONDITIONAL_CLEAR_KEEP_BRAND;
  return false;
}

export type CheesePickHealResult = {
  /** The healed payload (the SAME object when nothing changed). */
  data: unknown;
  changed: boolean;
  /** Number of applicator picks cleared. */
  clearedPicks: number;
};

/**
 * Clear poisoned cheese picks from one daily_sync `data` payload.
 *
 * For every run value whose app{1-4}CheeseRecipeName matches the poison list
 * (brand-aware for the BBQ pick), the pick name is blanked AND its hydrated
 * rows (app{N}CheeseRecipe) are emptied — the Cheese card is pick-only, so a
 * blank name with stale rows would still display (and consume) the wrong
 * blend. Each cleared run's runValuesUpdatedAt stamp is bumped to `now` so the
 * protective sync merge (protectRunValues) accepts the clear as the newest
 * edit instead of restoring the poisoned value from a peer.
 *
 * Pure and non-mutating: returns the original object untouched when no pick
 * matches. Unknown/malformed payload shapes are returned unchanged.
 */
export function healCheesePicksInPayload(data: unknown, now: number): CheesePickHealResult {
  if (!isPlainObject(data)) return { data, changed: false, clearedPicks: 0 };
  const runValues = data.runValues;
  if (!isPlainObject(runValues)) return { data, changed: false, clearedPicks: 0 };

  // Brand lookup: run id → brand, from dayState.runs.
  const brandById = new Map<string, unknown>();
  const dayState = data.dayState;
  if (isPlainObject(dayState) && Array.isArray(dayState.runs)) {
    for (const r of dayState.runs) {
      if (isPlainObject(r) && typeof r.id === "string" && r.id) {
        brandById.set(r.id, r.brand);
      }
    }
  }

  let clearedPicks = 0;
  const healedRunIds: string[] = [];
  const nextRunValues: Record<string, unknown> = { ...runValues };

  for (const [runId, value] of Object.entries(runValues)) {
    if (!isPlainObject(value)) continue;
    const brand = brandById.get(runId);
    let runChanged = false;
    const nextValue: Record<string, unknown> = { ...value };
    for (const n of APP_SLOTS) {
      const nameKey = `app${n}CheeseRecipeName`;
      if (!shouldClearCheesePick(nextValue[nameKey], brand)) continue;
      nextValue[nameKey] = "";
      // Blank the hydrated rows too — they are a read-only copy of the (wrong)
      // pool recipe and would otherwise keep showing/consuming it.
      const rowsKey = `app${n}CheeseRecipe`;
      if (rowsKey in nextValue) nextValue[rowsKey] = [];
      clearedPicks += 1;
      runChanged = true;
    }
    if (runChanged) {
      nextRunValues[runId] = nextValue;
      healedRunIds.push(runId);
    }
  }

  if (healedRunIds.length === 0) return { data, changed: false, clearedPicks: 0 };

  const prevStamps = isPlainObject(data.runValuesUpdatedAt) ? data.runValuesUpdatedAt : {};
  const nextStamps: Record<string, unknown> = { ...prevStamps };
  for (const id of healedRunIds) {
    // Monotonic bump: strictly newer than BOTH the stored stamp and `now`.
    // protectRunValues is strict-LWW on this stamp — if a stored stamp were
    // ever ahead of the server clock (client clock skew), writing plain `now`
    // would move it BACKWARD and a stale client still holding the poisoned
    // value with the old higher stamp could re-win and resurrect it.
    const prev = nextStamps[id];
    const prevNum = typeof prev === "number" && Number.isFinite(prev) ? prev : 0;
    nextStamps[id] = Math.max(prevNum, now) + 1;
  }

  return {
    data: { ...data, runValues: nextRunValues, runValuesUpdatedAt: nextStamps },
    changed: true,
    clearedPicks,
  };
}
