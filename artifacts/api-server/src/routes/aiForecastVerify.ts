import { and, eq } from "drizzle-orm";
import { db, dailySyncTable } from "@workspace/db";
import type { Scope } from "../lib/requestScope";
import type { ForecastInput } from "./aiForecast";

// Server-side reconciliation for POST /ai/forecast's client-submitted
// `history` (recent FINISHED production, grouped by day).
//
// Threat: /ai/forecast requires `use-ai-tools`, but any account holding that
// capability (e.g. a qc-operator, not just a manager) can submit fully
// fabricated `history` — the route only bound-checks its shape/size, never
// checks it against what actually happened. The model is instructed to
// ground its plan in that history and echo brand/flavor names "EXACTLY as
// they appear", so fabricated history flows straight through into the
// forecast, which is then persisted verbatim into the shared, cross-user-
// trusted facility_knowledge pool (`domain: "forecast", key: "plan:<date>"`).
// Every OTHER AI feature (ask-the-day, recipe-assistant, …) reads that pool
// back as trusted fact, so this is a durable poisoning path — a bad actor
// with just `use-ai-tools` (not `manage-*`) could plant fictional demand
// patterns that mislead every manager and the forecaster itself.
//
// Fix: before persisting a forecast, reconcile the submitted `history` against
// the AUTHORITATIVE finished-run data already stored server-side in
// `daily_sync` (the same table every client's day-state is synced through).
// A history day is trusted only when every product it claims, and roughly the
// case volume it claims, actually appears in that day's stored, FINISHED
// (`endedAt` set) runs. If ANY submitted day fails to reconcile — including a
// day the server has no record of at all — the whole request's history is
// untrusted and the forecast is still returned to the caller (advisory, no
// functional loss) but is NOT written back to shared memory.

// Case-count tolerance: client-side aggregation may round or total slightly
// differently than the stored casesNeeded, but a claim wildly above what was
// actually produced is a fabrication signal, not rounding noise.
const CASE_TOLERANCE_RATIO = 1.5;

function productKey(brand: string, flavor: string): string {
  return `${brand.trim().toLowerCase()}|||${flavor.trim().toLowerCase()}`;
}

// Load the actual FINISHED runs for one scope+date from the authoritative
// daily_sync row, aggregated by product (brand/flavor) -> total cases. Returns
// null when there is no stored row for that date at all (nothing to reconcile
// against, so the day can't be trusted) or on any read failure (fail closed —
// an unverifiable day never gets to plant shared "fact").
async function loadActualFinishedRuns(
  scope: Scope,
  date: string,
): Promise<Map<string, number> | null> {
  try {
    const [row] = await db
      .select()
      .from(dailySyncTable)
      .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)));
    if (!row) return null;
    const data = row.data as any;
    const runs: Array<Record<string, unknown>> = Array.isArray(data?.dayState?.runs)
      ? data.dayState.runs
      : [];
    const runValues: Record<string, any> = data?.runValues ?? {};
    const actual = new Map<string, number>();
    for (const run of runs) {
      if (!run || typeof run !== "object") continue;
      // Only finished runs are "production history" — an in-progress or
      // never-started run hasn't actually happened yet.
      if (!run.endedAt) continue;
      const brand = typeof run.brand === "string" ? run.brand : "";
      const flavor = typeof run.flavor === "string" ? run.flavor : "";
      if (!brand && !flavor) continue;
      const id = typeof run.id === "string" ? run.id : "";
      const cases = Number(runValues[id]?.casesNeeded ?? 0);
      const key = productKey(brand, flavor);
      actual.set(key, (actual.get(key) ?? 0) + (Number.isFinite(cases) ? cases : 0));
    }
    return actual;
  } catch {
    return null;
  }
}

type ForecastVerifyLogger = { warn: (obj: unknown, msg?: string) => void };

// Aggregate a submitted day's runs by product (brand/flavor) -> total claimed
// cases. This MUST happen before comparing against the actual per-product
// total: comparing run-by-run instead would let an attacker split one
// inflated claim across several runs for the SAME product, each individually
// under tolerance while the product's total is wildly fabricated.
function aggregateClaimedDay(runs: ForecastInput["history"][number]["runs"]): Map<string, number> {
  const claimed = new Map<string, number>();
  for (const run of runs) {
    const key = productKey(run.brand, run.flavor);
    const cases = Number.isFinite(run.cases) ? run.cases : 0;
    claimed.set(key, (claimed.get(key) ?? 0) + cases);
  }
  return claimed;
}

// True only when EVERY day in the submitted history reconciles against the
// server's own stored finished-run data for that scope+date:
//   - every claimed product actually has a matching finished run that day,
//   - the AGGREGATE claimed volume per product is within CASE_TOLERANCE_RATIO
//     of the actual total in EITHER direction (catches both inflation, incl.
//     split across multiple runs for the same product, and deflation), and
//   - no ACTUAL product that ran that day is silently omitted from the claim
//     (an attacker can't selectively drop real production to skew what a
//     partial, cherry-picked day teaches the forecaster).
// Empty (no-runs) days trivially pass — they assert nothing about that date.
// Fails closed on any missing day or read error.
export async function verifyForecastHistory(
  history: ForecastInput["history"],
  scope: Scope,
  log: ForecastVerifyLogger,
): Promise<boolean> {
  for (const day of history) {
    if (!day.runs.length) continue;
    const actual = await loadActualFinishedRuns(scope, day.date);
    if (!actual) {
      log.warn(
        { date: day.date },
        "ai-forecast: submitted history day has no matching server record; skipping facility-memory write-back",
      );
      return false;
    }
    const claimed = aggregateClaimedDay(day.runs);

    for (const [key, claimedCases] of claimed) {
      const actualCases = actual.get(key);
      if (actualCases === undefined) {
        log.warn(
          { date: day.date, key },
          "ai-forecast: submitted history claims a product with no matching finished run; skipping facility-memory write-back",
        );
        return false;
      }
      const upper = actualCases * CASE_TOLERANCE_RATIO + 1;
      const lower = Math.max(0, actualCases / CASE_TOLERANCE_RATIO - 1);
      if (claimedCases > upper || claimedCases < lower) {
        log.warn(
          { date: day.date, key, claimedCases, actualCases },
          "ai-forecast: submitted history case total diverges too far from the server record; skipping facility-memory write-back",
        );
        return false;
      }
    }

    for (const key of actual.keys()) {
      if (!claimed.has(key)) {
        log.warn(
          { date: day.date, key },
          "ai-forecast: submitted history omits a real finished product for a claimed day; skipping facility-memory write-back",
        );
        return false;
      }
    }
  }
  return true;
}
