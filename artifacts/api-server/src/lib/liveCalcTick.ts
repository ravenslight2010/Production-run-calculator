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
