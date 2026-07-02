import { useEffect, useMemo, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { type FormValues } from "../types";

type RunStatus = "pending" | "running" | "paused" | "ended";

interface AutoTrackCalc {
  ppm: number;
  perTray: number;
  perBatch: number;
}

interface AutoTrackValues {
  casesPerSkid: number;
  pizzasPerCase: number;
  casesNeeded: number;
  freezerTime: number;
  traysOnLine: number;
  batchesReady: number;
}

interface AutoTrackParams {
  runId: string;
  runStatus: RunStatus;
  nowTime: Date;
  elapsedBatchSec: number;
  calc: AutoTrackCalc;
  v: AutoTrackValues;
  form: UseFormReturn<FormValues>;
  /** Refresh interval in minutes between auto-track writes (default 5). */
  intervalMin?: number;
}

interface AutoTrackResult {
  autoTrackProgress: boolean;
  setAutoTrackProgress: React.Dispatch<React.SetStateAction<boolean>>;
  autoTrackSuggestion: {
    skids: number;
    casesOnSkid: number;
    expectedCases: number;
    expectedCasesRaw: number;
    trays: number | null;
    batches: number | null;
  } | null;
  autoSuppressUntilRef: React.MutableRefObject<number>;
  lastAutoMinBucketRef: React.MutableRefObject<number>;
}

/**
 * Tracks expected progress automatically once per refresh-interval bucket
 * (configurable via `intervalMin`, default 5 minutes) while running.
 *
 * Skids/cases: applied INCREMENTALLY — each bucket adds the production since the
 * last bucket on top of the current (possibly manually-entered) value. This means
 * a manual correction by the operator becomes the new baseline and auto-track
 * continues forward from it instead of overwriting it with its own absolute
 * estimate. (The previous absolute approach reverted manual entries the moment the
 * suppression window expired.) On the first bucket after a (re)start/switch the
 * absolute count is seeded only when there is no existing progress, so reloads and
 * run switches never double-count saved progress.
 *
 * Trays/batches: incremental decrement per bucket — subtracts consumption for the
 * actual duration since the last bucket fired.
 */
export function useAutoTrack({
  runId,
  runStatus,
  nowTime,
  elapsedBatchSec,
  calc,
  v,
  form,
  intervalMin,
}: AutoTrackParams): AutoTrackResult {
  // Sanitize: a bad/missing setting falls back to the historical 5-minute cadence.
  const bucketMin = Math.max(1, Math.min(60, Math.floor(Number(intervalMin)) || 5));
  const [autoTrackProgress, setAutoTrackProgress] = useState(true);
  const autoSuppressUntilRef = useRef<number>(0);
  const lastAutoMinBucketRef = useRef<number>(-1);
  // Wall-clock timestamp (ms) when the last bucket write happened.
  // Used to compute actual duration for incremental tray/batch decrement.
  const lastBucketTimeMsRef = useRef<number>(0);
  // expectedCases value at the last bucket — the baseline the incremental
  // skids/cases delta is measured from. -1 = "not baselined yet" (first bucket
  // after a mount/reset).
  const lastExpectedCasesRef = useRef<number>(-1);
  // Fractional tray/batch consumption carried between buckets so sub-unit
  // depletion per bucket accumulates instead of being lost to Math.floor (which
  // would freeze slow-depleting dough — especially batches — at its start value).
  const traysRemainderRef = useRef<number>(0);
  const batchesRemainderRef = useRef<number>(0);

  const autoTrackSuggestion = useMemo(() => {
    const ok =
      (runStatus === "running" || runStatus === "paused") &&
      calc.ppm > 0 &&
      v.casesPerSkid > 0 &&
      v.pizzasPerCase > 0;
    if (!ok) return null;

    const maxSkids = Math.floor(v.casesNeeded / v.casesPerSkid);
    const elapsedMin = elapsedBatchSec / 60;
    const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(v.freezerTime));
    // Clamp to the run's total need so skids/cases freeze at their final state
    // once production is complete instead of cycling past it (modulo wrap).
    const expectedCasesRaw = Math.floor((elapsedMinAfterTunnel * calc.ppm) / v.pizzasPerCase);
    const expectedCases = v.casesNeeded > 0 ? Math.min(v.casesNeeded, expectedCasesRaw) : expectedCasesRaw;

    return {
      skids: Math.min(maxSkids, Math.floor(expectedCases / v.casesPerSkid)),
      casesOnSkid: Math.min(v.casesPerSkid, expectedCases % v.casesPerSkid),
      expectedCases,
      // Unclamped time-based total — drives the INCREMENTAL delta below so that a
      // downward manual correction (e.g. after the estimate ran ahead and hit the
      // casesNeeded clamp) can still climb again. The clamp lives only on what is
      // displayed/written, not on the delta source.
      expectedCasesRaw,
      // Tray/batch suggestions are handled incrementally in the write effect;
      // returning null here means the UI falls back to the calc-based suggestion.
      trays: null,
      batches: null,
    };
  }, [
    runStatus,
    calc.ppm,
    calc.perTray,
    calc.perBatch,
    v.casesPerSkid,
    v.pizzasPerCase,
    v.casesNeeded,
    v.freezerTime,
    elapsedBatchSec,
  ]);

  // Baseline resets are declared BEFORE the bucket-write effect below on purpose:
  // React runs effects in declaration order, so on mount (and on runId/toggle
  // changes) the refs are reset FIRST and the write effect then fires exactly once
  // with clean baselines. With the old order (write first, resets after), the
  // mount pass wrote a bucket, the resets then wiped the bookkeeping (losing the
  // fractional tray/batch remainder carry) and re-armed the SAME bucket to fire
  // again on the next tick — double-decrementing trays and freezing slow-depleting
  // batches whose per-bucket consumption is < 1 unit.

  // Reset bucket bookkeeping when the run stops so the next run starts fresh.
  useEffect(() => {
    if (runStatus === "pending" || runStatus === "ended") {
      lastBucketTimeMsRef.current = 0;
      lastAutoMinBucketRef.current = -1;
      lastExpectedCasesRef.current = -1;
      traysRemainderRef.current = 0;
      batchesRemainderRef.current = 0;
    }
  }, [runStatus]);

  // Re-baseline when the active run changes (switching runs / first mount) so the
  // incremental delta is never computed against another run's numbers, and a run
  // we switch or reload into is not double-counted.
  useEffect(() => {
    lastBucketTimeMsRef.current = 0;
    lastAutoMinBucketRef.current = -1;
    lastExpectedCasesRef.current = -1;
    traysRemainderRef.current = 0;
    batchesRemainderRef.current = 0;
  }, [runId]);

  // Re-baseline when auto-track is toggled on so the first bucket after re-enabling
  // continues from the current value instead of adding all the production that
  // accumulated while it was off.
  useEffect(() => {
    lastBucketTimeMsRef.current = 0;
    lastAutoMinBucketRef.current = -1;
    lastExpectedCasesRef.current = -1;
    traysRemainderRef.current = 0;
    batchesRemainderRef.current = 0;
  }, [autoTrackProgress]);

  // Re-baseline when the refresh interval setting changes so the bucket index
  // (which is derived from the interval) can't collide with a stale marker.
  useEffect(() => {
    lastBucketTimeMsRef.current = 0;
    lastAutoMinBucketRef.current = -1;
    lastExpectedCasesRef.current = -1;
    traysRemainderRef.current = 0;
    batchesRemainderRef.current = 0;
  }, [bucketMin]);

  // Apply expected values once per refresh-interval bucket while running.
  useEffect(() => {
    if (!autoTrackProgress || runStatus !== "running" || !autoTrackSuggestion) return;

    const bucket = Math.floor(nowTime.getTime() / (bucketMin * 60 * 1000));
    if (bucket === lastAutoMinBucketRef.current) return;

    // How long since the last bucket fired (capped to 2 intervals to avoid huge jumps).
    const nowMs = nowTime.getTime();
    const prevMs = lastBucketTimeMsRef.current;
    const bucketDurationMin = prevMs > 0
      ? Math.min(bucketMin * 2, (nowMs - prevMs) / 60000)
      : bucketMin; // first bucket — assume one full interval

    const expectedCases = autoTrackSuggestion.expectedCases;
    // Baseline the incremental delta off the UNCLAMPED total so the count keeps
    // advancing even after the time-based estimate saturates at casesNeeded (e.g.
    // the estimate ran ahead, the operator corrected the count down, then hit
    // "Resume now"). Using the clamped value here would pin the delta at 0 and the
    // count would never climb again.
    const expectedRaw = autoTrackSuggestion.expectedCasesRaw;
    const prevExpected = lastExpectedCasesRef.current;

    // Always advance the bucket bookkeeping — even while suppressed — so the
    // suppression window expiring never causes a catch-up jump that wipes the
    // operator's manual edit.
    lastAutoMinBucketRef.current = bucket;
    lastBucketTimeMsRef.current = nowMs;
    lastExpectedCasesRef.current = expectedRaw;

    // While the manual-edit suppression window is open, keep baselines current but
    // do not write — the operator is taking over.
    if (Date.now() < autoSuppressUntilRef.current) return;

    // Skids / cases.
    const cps = v.casesPerSkid;
    const curTotal =
      (Number(form.getValues("skidsCompleted")) || 0) * cps +
      (Number(form.getValues("casesOnCurrentSkid")) || 0);
    if (prevExpected < 0) {
      // First bucket after a (re)start/switch: seed the absolute count only when
      // there is no progress yet. If progress already exists (reload / switching
      // into a run that's already going / a prior manual entry), just baseline so
      // we don't double-count.
      if (curTotal === 0 && expectedCases > 0) {
        const seedTotal = v.casesNeeded > 0 ? Math.min(v.casesNeeded, expectedCases) : expectedCases;
        form.setValue("skidsCompleted", Math.floor(seedTotal / cps), { shouldDirty: true });
        form.setValue("casesOnCurrentSkid", seedTotal % cps, { shouldDirty: true });
      }
    } else {
      // Add the production since the last bucket on top of the current value, so a
      // manual correction is preserved and tracking continues forward from it.
      const deltaCases = Math.max(0, expectedRaw - prevExpected);
      if (deltaCases > 0) {
        const target = curTotal + deltaCases;
        // Never pull a value down below what the operator already has on the floor.
        const newTotal = v.casesNeeded > 0 ? Math.min(target, Math.max(curTotal, v.casesNeeded)) : target;
        if (newTotal !== curTotal) {
          form.setValue("skidsCompleted", Math.floor(newTotal / cps), { shouldDirty: true });
          form.setValue("casesOnCurrentSkid", newTotal % cps, { shouldDirty: true });
        }
      }
    }

    // Trays / batches: incremental decrement for this bucket's duration.
    // Works after page reloads and naturally handles mid-run replenishments.
    // Stop once all the dough the run needs has been fed onto the line — dough
    // enters at the front (no tunnel offset), so feeding finishes when the
    // front-of-line case count reaches casesNeeded. Without this, auto-track
    // keeps depleting (and re-suggesting) dough after the run already has
    // everything it needs.
    const elapsedMin = elapsedBatchSec / 60;
    const doughFeedComplete =
      v.casesNeeded > 0 &&
      calc.ppm > 0 &&
      v.pizzasPerCase > 0 &&
      Math.floor((elapsedMin * calc.ppm) / v.pizzasPerCase) >= v.casesNeeded;
    if (!doughFeedComplete && calc.perTray > 0 && calc.ppm > 0) {
      const traysExact = (bucketDurationMin * calc.ppm) / calc.perTray + traysRemainderRef.current;
      const traysConsumed = Math.floor(traysExact);
      traysRemainderRef.current = traysExact - traysConsumed;
      if (traysConsumed > 0) {
        form.setValue("traysOnLine", Math.max(0, v.traysOnLine - traysConsumed), { shouldDirty: true });
      }
    }
    if (!doughFeedComplete && calc.perBatch > 0 && calc.ppm > 0) {
      const batchesExact = (bucketDurationMin * calc.ppm) / calc.perBatch + batchesRemainderRef.current;
      const batchesConsumed = Math.floor(batchesExact);
      batchesRemainderRef.current = batchesExact - batchesConsumed;
      if (batchesConsumed > 0) {
        form.setValue("batchesReady", Math.max(0, v.batchesReady - batchesConsumed), { shouldDirty: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTime]);

  return {
    autoTrackProgress,
    setAutoTrackProgress,
    autoTrackSuggestion,
    autoSuppressUntilRef,
    lastAutoMinBucketRef,
  };
}
