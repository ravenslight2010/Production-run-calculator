import type { FormValues, RunMeta } from "./types";
import { DEFAULT_PEP_TYPES } from "./types";
import { computeSummaryStats as computeSummaryStatsShared } from "@workspace/inventory-math";
import { withSubstitutions } from "./substitutionState";

// Pure helper (no per-app injection) re-exported so web call sites keep the
// single `../utils` import boundary; the formula lives in @workspace/inventory-math.
export { computeCheesePull, computeCheesePerPizzaOz } from "@workspace/inventory-math";

/**
 * Pure helper for resumeRun's startedAt-advancing formula.
 *
 * When a run is resumed the clock never went backwards — it was just paused.
 * We shift `startedAt` forward by the pause duration so that
 * `nowTime - newStartedAt` reflects only the time the run was actually
 * running (not the time it was paused).
 *
 * Guarantee: the returned value is always ≥ `startedAt`, and
 *   `now - returnValue` is always ≥ 0 for valid inputs
 *   (i.e. pausedAt ≥ startedAt and now ≥ pausedAt).
 *
 * @param startedAt  Original run start timestamp (ms since epoch)
 * @param pausedAt   Timestamp when the run was paused (ms since epoch)
 * @param now        Current timestamp (ms since epoch)
 */
export function computeResumedStartedAt(
  startedAt: number,
  pausedAt: number,
  now: number,
): number {
  const pauseDuration = Math.max(0, now - pausedAt);
  return startedAt + pauseDuration;
}

/**
 * Pure state transformation for resumeRun.
 *
 * Takes a run that is currently paused (pausedAt must be set) and returns a
 * new run object with:
 *   - startedAt advanced by computeResumedStartedAt
 *   - pausedAt cleared (set to undefined)
 *   - the active pause stoppage closed with endedAt = now
 *
 * Mirrors exactly what the resumeRun closure in home.tsx does to the run
 * object, so this function can be unit-tested independently of the component.
 *
 * Returns null if the run has no pausedAt (guard matches resumeRun's guard).
 */
export function applyResumeToRun(
  run: RunMeta,
  now: number,
): RunMeta | null {
  if (!run.pausedAt) return null;
  const newStartedAt = computeResumedStartedAt(run.startedAt!, run.pausedAt, now);
  // Legacy paused runs have no identity field. Pick only one matching, latest
  // open pause instead of accidentally closing duplicate same-millisecond rows.
  const activePauseId = run.pausedStoppageId ??
    (run.stoppages ?? [])
      .filter(s => s.type === "pause" && !s.endedAt && s.startedAt === run.pausedAt)
      .sort((a, b) => b.id.localeCompare(a.id))[0]?.id;
  const updatedStoppages = (run.stoppages ?? []).map(s =>
    s.id === activePauseId
      ? { ...s, endedAt: now }
      : s,
  );
  return {
    ...run,
    startedAt: newStartedAt,
    pausedAt: undefined,
    pausedStoppageId: undefined,
    stoppages: updatedStoppages,
  };
}

export function fmtElapsed(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtTime(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtNum(n: number, dec = 2): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toFixed(dec);
}

export function fmtComma(n: number, dec = 0): string {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

// Duration in whole minutes → "2 hr 5 min" / "45 min" (never a bare 3-digit
// minute count). Rounds to the nearest minute.
export function fmtMins(min: number): string {
  const num = Number(min);
  if (!isFinite(num) || num < 0) return "—";
  const total = Math.round(num);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

// Countdown from precomputed minute/second parts. Keeps the MM:SS feel under
// an hour and rolls into H:MM:SS beyond it (so "75:00" never appears).
export function fmtCountdownParts(mm: number, ss: number): string {
  if (mm >= 60) {
    const h = Math.floor(mm / 60);
    return `${h}:${String(mm % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// `dayState.resetAt` doubles as the server-side daily-reset SESSION BOUNDARY: any
// auth token issued before today's row's resetAt is force-signed-out, and
// protectRunValues treats a strictly-forward resetAt as a "true daily reset"
// (adopt the incoming runs WHOLESALE). Only a real midnight rollover may advance
// it.
//
// A schedule/import write into a FUTURE day may stamp `now` to get that
// wholesale-override behaviour on that future row — harmless, because the server
// only reads TODAY's row for the boundary. But stamping `now` onto TODAY's live
// row would fence every session (an early "daily reset" — everyone bounced to
// login) AND wholesale-wipe the live day. So when the write target is today we
// must NEVER advance the boundary: preserve the existing value (from the fetched
// server row, else the live day) and default to 0.
export function writeDayResetAt(
  targetDate: string,
  today: string,
  existingResetAt: number | undefined,
  liveResetAt: number | undefined,
  now: number,
): number {
  if (targetDate === today) return existingResetAt ?? liveResetAt ?? 0;
  return now;
}

export function runLabel(r: RunMeta): string {
  if (r.brand && r.flavor) return `${r.brand} – ${r.flavor}`;
  if (r.brand) return r.brand;
  if (r.flavor) return r.flavor;
  return "Unnamed Run";
}

// Thin wrapper over the shared inventory-math engine so web call sites keep the
// single-arg signature; the formulas live in @workspace/inventory-math (shared
// with mobile). DEFAULT_PEP_TYPES is injected because it is owned per-app.
export function computeSummaryStats(vals: FormValues) {
  return computeSummaryStatsShared(withSubstitutions(vals), DEFAULT_PEP_TYPES);
}

export function sauceBarrelBreakdown(
  sauceBatches: number,
  effBarrelLbs: number,
): { batchesPerBarrel: number; totalBarrels: number } | null {
  if (effBarrelLbs <= 0 || effBarrelLbs >= 450 || sauceBatches <= 0) return null;
  const batchesPerBarrel = Math.floor(450 / effBarrelLbs);
  if (batchesPerBarrel < 2) return null;
  const totalBarrels = Math.ceil(sauceBatches / batchesPerBarrel);
  return { batchesPerBarrel, totalBarrels };
}
