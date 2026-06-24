// Shared, pure detection of scheduled runs whose saved brand/flavor profile is
// missing entirely or carries no real recipe data.
//
// The reorder/transfer demand projections resolve each upcoming scheduled run to
// its saved brand+flavor profile. When that profile is absent (or has no recipe
// rows), the run's material demand silently falls back to a blank default form —
// under- or over-stating what's actually needed. This module finds those runs so
// managers can be warned and set the profile up.
//
// Both the web app (artifacts/run-calculator) and the mobile app
// (artifacts/run-calculator-mobile) call this so the warning can't drift
// (replit.md parity rule). Only the profile resolver (localStorage vs the synced
// brandProfiles map) stays per-app; the "has real data" definition and the
// dedup/ordering live here.

export type ProfileLike = Record<string, unknown> | null | undefined;

// Recipe-row arrays whose presence means the profile drives real ingredient
// demand. These are the ONLY signal that counts: the reorder/transfer demand
// projections are computed from recipe rows, so a profile with only labels
// (applicator/pepperoni/die types, recipe names) but no rows still falls back to
// default demand — exactly the case managers need warned about.
const RECIPE_ARRAY_FIELDS = [
  "doughRecipe",
  "frontlineRecipe",
  "app1CheeseRecipe",
  "app2CheeseRecipe",
  "app3CheeseRecipe",
  "app4CheeseRecipe",
] as const;

/**
 * True when a saved brand/flavor profile object carries real recipe ROWS that
 * drive ingredient demand (vs. a blank/label-only form). Deliberately stricter
 * than a generic "profile has any data" check: profiles with applicator/die
 * types or recipe names but no recipe rows still produce default demand, so they
 * are treated as incomplete and must be flagged. A `null`/`undefined` profile
 * (none saved) is never "real".
 */
export function profileHasRecipeData(profile: ProfileLike): boolean {
  if (!profile) return false;
  const arr = (x: unknown) => Array.isArray(x) && x.length > 0;
  for (const k of RECIPE_ARRAY_FIELDS) {
    if (arr(profile[k])) return true;
  }
  return false;
}

// One scheduled run reference. Dates are the production day the run is planned
// for; callers pass only the UPCOMING (today-or-later) runs.
export type ScheduledRunRef = {
  date: string;
  brand: string;
  flavor: string;
  casesNeeded?: number;
};

// Why a scheduled run's profile can't drive trustworthy demand.
// - "missing": no profile saved for that brand+flavor at all.
// - "incomplete": a profile exists but has no real recipe data.
export type ScheduledRecipeReason = "missing" | "incomplete";

export type ScheduledRecipeIssue = {
  brand: string;
  flavor: string;
  reason: ScheduledRecipeReason;
  // Distinct upcoming production dates affected (ascending).
  dates: string[];
  // Total cases scheduled across those dates (rough demand at risk).
  totalCases: number;
};

/**
 * Given the upcoming scheduled runs and a profile resolver, return the distinct
 * brand+flavor combinations whose saved profile is missing or has no real recipe
 * data. One entry per brand+flavor (repeats across days collapse together),
 * "missing" sorted before "incomplete", then alphabetical by brand/flavor. Pure.
 *
 * The resolver must return the RAW stored profile object (not merged with a
 * default form) or `null`/`undefined` when nothing is saved, so the two reasons
 * can be told apart.
 */
export function findScheduledRecipeIssues(
  scheduledRuns: ReadonlyArray<ScheduledRunRef>,
  resolveProfile: (brand: string, flavor: string) => ProfileLike,
): ScheduledRecipeIssue[] {
  const byKey = new Map<string, ScheduledRecipeIssue>();
  for (const run of scheduledRuns) {
    const brand = (run.brand ?? "").trim();
    if (!brand) continue;
    const flavor = (run.flavor ?? "").trim();
    const profile = resolveProfile(brand, flavor);
    const reason: ScheduledRecipeReason | null =
      profile == null ? "missing" : profileHasRecipeData(profile) ? null : "incomplete";
    if (reason === null) continue;
    const key = `${brand}\u0000${flavor}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { brand, flavor, reason, dates: [], totalCases: 0 };
      byKey.set(key, entry);
    }
    // A combo resolving "missing" on any day wins over "incomplete".
    if (reason === "missing") entry.reason = "missing";
    if (run.date && !entry.dates.includes(run.date)) entry.dates.push(run.date);
    entry.totalCases += Number(run.casesNeeded) || 0;
  }
  const out = [...byKey.values()];
  for (const e of out) e.dates.sort();
  out.sort(
    (a, b) =>
      (a.reason === b.reason ? 0 : a.reason === "missing" ? -1 : 1) ||
      a.brand.localeCompare(b.brand) ||
      a.flavor.localeCompare(b.flavor),
  );
  return out;
}
