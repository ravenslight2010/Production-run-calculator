/**
 * usePrepPhase — shift prep phase tracker for the Dough and Sauce tabs.
 *
 * Covers the window between shift start and production start (e.g. 6–7 AM).
 * Staff press "Start Prep" once (covers both areas), then +1 Batch per completed
 * batch. When a production run is formally started, prep batches carry over into
 * batchesReady / sauceMade so the live run begins with the correct head start.
 *
 * State lives in DayState.prepPhase and syncs via /api/sync with LWW merge:
 *   - prepStartedAt: earliest non-null wins (once started, never un-started)
 *   - batch counts: MAX (counts only increment)
 *   - prepCarriedOver: sticky true (once carried, always carried)
 */

import type { DayState, PrepPhase } from "../types";
import { saveDayState } from "../storage";

export const FRESH_PREP_PHASE: PrepPhase = {
  prepStartedAt: null,
  prepBatchesDough: 0,
  prepBatchesSauce: 0,
  prepCarriedOver: false,
};

export function getPrepPhase(dayState: DayState): PrepPhase {
  return dayState.prepPhase ?? FRESH_PREP_PHASE;
}

/** Client-side merge of two prep phases — called on SSE receive. */
export function mergePrepPhaseClient(
  local: PrepPhase | undefined,
  remote: unknown,
): PrepPhase {
  const loc = local ?? FRESH_PREP_PHASE;
  if (!remote || typeof remote !== "object") return loc;
  const rem = remote as Record<string, unknown>;
  const toNum = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const locSt = loc.prepStartedAt;
  const remSt = typeof rem.prepStartedAt === "number" ? rem.prepStartedAt : null;
  const prepStartedAt =
    locSt !== null && remSt !== null
      ? Math.min(locSt, remSt)
      : locSt ?? remSt ?? null;
  return {
    prepStartedAt,
    prepBatchesDough: Math.max(loc.prepBatchesDough, toNum(rem.prepBatchesDough)),
    prepBatchesSauce: Math.max(loc.prepBatchesSauce, toNum(rem.prepBatchesSauce)),
    prepCarriedOver: !!(loc.prepCarriedOver || rem.prepCarriedOver),
  };
}

/**
 * Returns prep-phase derived values and action callbacks.
 *
 * @param dayState      Current day state (reactive)
 * @param dayStateRef   Stable ref to the latest day state (for closure safety)
 * @param setDayState   React state setter
 * @param schedulePush  Sync push scheduler
 * @param nowMs         Current clock time in ms (from useLiveRun's nowTime)
 * @param doughBatchSec Duration of one dough batch cycle in seconds
 * @param sauceBatchSec Duration of one sauce batch cycle in seconds
 */
export function usePrepPhase({
  dayState,
  dayStateRef,
  setDayState,
  schedulePush,
  nowMs,
  doughBatchSec,
  sauceBatchSec,
}: {
  dayState: DayState;
  dayStateRef: { readonly current: DayState | null } | { current: DayState };
  setDayState: React.Dispatch<React.SetStateAction<DayState>>;
  schedulePush: (ds: DayState, delay?: number) => void;
  nowMs: number;
  doughBatchSec: number;
  sauceBatchSec: number;
}) {
  const prep = getPrepPhase(dayState);
  const prepActive = prep.prepStartedAt !== null;
  const elapsedMs = prepActive ? Math.max(0, nowMs - prep.prepStartedAt!) : 0;
  const elapsedSec = elapsedMs / 1000;

  // Seconds remaining until next batch boundary
  const doughSecLeft =
    prepActive && doughBatchSec > 0
      ? doughBatchSec - (elapsedSec % doughBatchSec)
      : doughBatchSec;
  const sauceSecLeft =
    prepActive && sauceBatchSec > 0
      ? sauceBatchSec - (elapsedSec % sauceBatchSec)
      : sauceBatchSec;

  // Monotonically increasing batch number — increments once per full cycle.
  // Use this in a useEffect dependency to fire batch-due alerts.
  const doughBatchNum =
    prepActive && doughBatchSec > 0 ? Math.floor(elapsedSec / doughBatchSec) : 0;
  const sauceBatchNum =
    prepActive && sauceBatchSec > 0 ? Math.floor(elapsedSec / sauceBatchSec) : 0;

  function applyPrepPhaseUpdate(update: Partial<PrepPhase>) {
    const current = getPrepPhase(dayStateRef.current!);
    const nextPrepPhase: PrepPhase = { ...current, ...update };
    const newDs: DayState = { ...dayStateRef.current!, prepPhase: nextPrepPhase };
    saveDayState(newDs, { stampMeta: false });
    setDayState(newDs);
    schedulePush(newDs, 0);
  }

  function startPrep() {
    if (prepActive) return;
    applyPrepPhaseUpdate({ prepStartedAt: Date.now() });
  }

  function addPrepBatchDough() {
    const cur = getPrepPhase(dayStateRef.current!);
    applyPrepPhaseUpdate({ prepBatchesDough: cur.prepBatchesDough + 1 });
  }

  function addPrepBatchSauce() {
    const cur = getPrepPhase(dayStateRef.current!);
    applyPrepPhaseUpdate({ prepBatchesSauce: cur.prepBatchesSauce + 1 });
  }

  return {
    prep,
    prepActive,
    elapsedSec,
    doughSecLeft,
    sauceSecLeft,
    doughBatchNum,
    sauceBatchNum,
    startPrep,
    addPrepBatchDough,
    addPrepBatchSauce,
  };
}
