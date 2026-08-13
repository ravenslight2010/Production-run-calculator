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

/**
 * Client-side merge of two prep phases — called on SSE receive.
 *
 * Normal (no handoff) merge rules:
 *   - prepStartedAt: earliest non-null wins
 *   - batch counts: MAX (counts only increment)
 *   - prepCarriedOver: sticky true (once carried, always carried)
 *
 * Handoff-aware rules (when prepHandoffFromRunId is set):
 *   A depletion handoff resets counts to zero with prepCarriedOver: false so
 *   the next run can carry new batches via startRun. A stale SSE echo from a
 *   peer that hasn't received the handoff yet would clobber the reset via MAX
 *   counts / sticky-OR. Guard against this:
 *
 *   - If LOCAL is in handoff (has a prepHandoffFromRunId) but REMOTE is not (or
 *     has a different one): remote is pre-handoff — its counts and carry-over
 *     are stale. Keep local's values and propagate the handoff ID.
 *
 *   - If REMOTE is in handoff but LOCAL is not: local is the stale peer.
 *     Adopt remote's post-handoff values entirely.
 *
 *   - If BOTH are in the same handoff: both are post-handoff. Apply MAX counts
 *     + sticky-OR (staff on two tablets both adding next-run batches).
 */
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

  const locHandoff = loc.prepHandoffFromRunId;
  const remHandoff = typeof rem.prepHandoffFromRunId === "string" ? rem.prepHandoffFromRunId : undefined;
  const sameHandoff = locHandoff !== undefined && locHandoff === remHandoff;

  let prepStartedAt: number | null;
  let prepBatchesDough: number;
  let prepBatchesSauce: number;
  let prepCarriedOver: boolean;
  let prepHandoffFromRunId: string | undefined;

  if (locHandoff && !sameHandoff && remHandoff) {
    // Both tablets have DIFFERENT handoff IDs (sequential runs: run A then run B).
    // Use prepStartedAt as the LWW ordering signal — the later timestamp is
    // the NEWER handoff generation and wins entirely (including its prepStartedAt
    // so the batch TickBar stays in sync with when that handoff started).
    const locTs = locSt ?? 0;
    const remTs = remSt ?? 0;
    if (remTs > locTs) {
      // Remote is the newer handoff — adopt its post-handoff state
      prepStartedAt = remSt;
      prepBatchesDough = toNum(rem.prepBatchesDough);
      prepBatchesSauce = toNum(rem.prepBatchesSauce);
      prepCarriedOver = !!(rem.prepCarriedOver);
      prepHandoffFromRunId = remHandoff;
    } else {
      // Local is the newer (or tied) handoff — keep it
      prepStartedAt = locSt;
      prepBatchesDough = loc.prepBatchesDough;
      prepBatchesSauce = loc.prepBatchesSauce;
      prepCarriedOver = loc.prepCarriedOver;
      prepHandoffFromRunId = locHandoff;
    }
  } else if (locHandoff && !sameHandoff && !remHandoff) {
    // Local is in handoff; remote has no handoff ID (stale pre-handoff echo) — keep local
    prepStartedAt = locSt;
    prepBatchesDough = loc.prepBatchesDough;
    prepBatchesSauce = loc.prepBatchesSauce;
    prepCarriedOver = loc.prepCarriedOver;
    prepHandoffFromRunId = locHandoff;
  } else if (!locHandoff && remHandoff) {
    // Remote is in handoff; local is the stale pre-handoff peer — adopt remote
    prepStartedAt = remSt;
    prepBatchesDough = toNum(rem.prepBatchesDough);
    prepBatchesSauce = toNum(rem.prepBatchesSauce);
    prepCarriedOver = !!(rem.prepCarriedOver);
    prepHandoffFromRunId = remHandoff;
  } else {
    // Both in same handoff, or neither: MIN start time (earliest prep wins),
    // MAX counts (increments only), sticky-OR carry-over.
    prepStartedAt =
      locSt !== null && remSt !== null
        ? Math.min(locSt, remSt)
        : locSt ?? remSt ?? null;
    prepBatchesDough = Math.max(loc.prepBatchesDough, toNum(rem.prepBatchesDough));
    prepBatchesSauce = Math.max(loc.prepBatchesSauce, toNum(rem.prepBatchesSauce));
    prepCarriedOver = !!(loc.prepCarriedOver || rem.prepCarriedOver);
    prepHandoffFromRunId = locHandoff ?? remHandoff;
  }

  return {
    prepStartedAt,
    prepBatchesDough,
    prepBatchesSauce,
    prepCarriedOver,
    ...(prepHandoffFromRunId !== undefined ? { prepHandoffFromRunId } : {}),
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
