// Active-run calc tick policy: a read-only derivation that re-emits the
// server-computed calc for the CURRENT run while that run is active (started,
// not ended), so clients can skip per-second local recomputation while online.
// Idle days emit nothing new. Mirrors computeServerCalc's run selection
// (currentIndex). Kept DB-free so it is unit-testable without DATABASE_URL.
export const DEFAULT_LIVE_CALC_TICK_MS = 5_000;

export function shouldEmitLiveCalcTick(
  data: unknown,
  nowMs: number,
  lastTickMs: number,
  tickMs = DEFAULT_LIVE_CALC_TICK_MS,
): boolean {
  if (nowMs - lastTickMs < tickMs) return false;
  const payload = data as {
    dayState?: { runs?: Array<{ startedAt?: number; endedAt?: number }>; currentIndex?: number };
  } | null;
  const runs = payload?.dayState?.runs;
  if (!runs || runs.length === 0) return false;
  const currentIndex = payload?.dayState?.currentIndex ?? 0;
  const run = runs[currentIndex] ?? runs[0];
  return Boolean(run && typeof run.startedAt === "number" && run.endedAt == null);
}

/**
 * Build the SSE frame payload for an active-run calc tick, or null when no tick
 * should be emitted (idle day, ended run, or inside the interval window).
 * Pure and DB-free so it is unit-testable without DATABASE_URL.
 */
export function buildLiveCalcTickFrame(
  data: unknown,
  nowMs: number,
  lastCalcEmitMs: number,
  canonicalRevision: number,
  tickMs = DEFAULT_LIVE_CALC_TICK_MS,
): { frame: Record<string, unknown>; lastCalcEmitMs: number } | null {
  if (!shouldEmitLiveCalcTick(data, nowMs, lastCalcEmitMs, tickMs)) return null;
  return { frame: { calcTick: true, canonicalRevision }, lastCalcEmitMs: nowMs };
}


// Slice 2: extend the tick to any selected run with runValues — not just
// active (started, not ended) runs.  This lets the Setup tab consume
// server-authoritative calcs while the user is still configuring the profile.
// Same read-only, DB-free, no day-state-write guarantee as the active tick.

/**
 * True when the selected run has a `runValues` entry in the sync payload
 * (i.e. there is something to compute), regardless of started/ended state.
 * The interval gate (`tickMs`) still applies to avoid redundant frames.
 * Idle when: no runs, no runValues for the selected run, or inside the
 * interval window.
 */
export function shouldEmitSetupCalcTick(
  data: unknown,
  nowMs: number,
  lastTickMs: number,
  tickMs = DEFAULT_LIVE_CALC_TICK_MS,
): boolean {
  if (nowMs - lastTickMs < tickMs) return false;
  const payload = data as {
    dayState?: { runs?: Array<{ id?: string }>; currentIndex?: number };
    runValues?: Record<string, unknown>;
  } | null;
  const runs = payload?.dayState?.runs;
  if (!runs || runs.length === 0) return false;
  const currentIndex = payload?.dayState?.currentIndex ?? 0;
  const run = runs[currentIndex] ?? runs[0];
  if (!run?.id) return false;
  return payload?.runValues != null && typeof payload.runValues === "object" && payload.runValues[run.id] != null;
}

/**
 * Build the SSE frame payload for a setup-form calc tick.  Returns null
 * (idle) when no tick should be emitted.  Pure and DB-free.
 */
export function buildSetupCalcTickFrame(
  data: unknown,
  nowMs: number,
  lastCalcEmitMs: number,
  canonicalRevision: number,
  tickMs = DEFAULT_LIVE_CALC_TICK_MS,
): { frame: Record<string, unknown>; lastCalcEmitMs: number } | null {
  if (!shouldEmitSetupCalcTick(data, nowMs, lastCalcEmitMs, tickMs)) return null;
  return { frame: { calcTick: true, setupTick: true, canonicalRevision }, lastCalcEmitMs: nowMs };
}
