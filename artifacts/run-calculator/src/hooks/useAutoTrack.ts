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
}

interface AutoTrackResult {
  autoTrackProgress: boolean;
  setAutoTrackProgress: React.Dispatch<React.SetStateAction<boolean>>;
  autoTrackSuggestion: {
    skids: number;
    casesOnSkid: number;
    expectedCases: number;
    trays: number | null;
    batches: number | null;
  } | null;
  autoSuppressUntilRef: React.MutableRefObject<number>;
  lastAutoMinBucketRef: React.MutableRefObject<number>;
}

/**
 * Tracks expected progress automatically every 5-minute bucket while running.
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
}: AutoTrackParams): AutoTrackResult {
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

  // Apply expected values once per 5-minute bucket while running.
  useEffect(() => {
    if (!autoTrackProgress || runStatus !== "running" || !autoTrackSuggestion) return;

    const bucket = Math.floor(nowTime.getTime() / (5 * 60 * 1000));
    if (bucket === lastAutoMinBucketRef.current) return;

    // How long since the last bucket fired (capped to 10 min to avoid huge jumps).
    const nowMs = nowTime.getTime();
    const prevMs = lastBucketTimeMsRef.current;
    const bucketDurationMin = prevMs > 0
      ? Math.min(10, (nowMs - prevMs) / 60000)
      : 5; // first bucket — assume 5-min duration

    const expectedCases = autoTrackSuggestion.expectedCases;
    const prevExpected = lastExpectedCasesRef.current;

    // Always advance the bucket bookkeeping — even while suppressed — so the
    // suppression window expiring never causes a catch-up jump that wipes the
    // operator's manual edit.
    lastAutoMinBucketRef.current = bucket;
    lastBucketTimeMsRef.current = nowMs;
    lastExpectedCasesRef.current = expectedCases;

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
      const deltaCases = Math.max(0, expectedCases - prevExpected);
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
      const traysConsumed = Math.floor((bucketDurationMin * calc.ppm) / calc.perTray);
      if (traysConsumed > 0) {
        form.setValue("traysOnLine", Math.max(0, v.traysOnLine - traysConsumed), { shouldDirty: true });
      }
    }
    if (!doughFeedComplete && calc.perBatch > 0 && calc.ppm > 0) {
      const batchesConsumed = Math.floor((bucketDurationMin * calc.ppm) / calc.perBatch);
      if (batchesConsumed > 0) {
        form.setValue("batchesReady", Math.max(0, v.batchesReady - batchesConsumed), { shouldDirty: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTime]);

  // Reset bucket bookkeeping when the run stops so the next run starts fresh.
  useEffect(() => {
    if (runStatus === "pending" || runStatus === "ended") {
      lastBucketTimeMsRef.current = 0;
      lastAutoMinBucketRef.current = -1;
      lastExpectedCasesRef.current = -1;
    }
  }, [runStatus]);

  // Re-baseline when the active run changes (switching runs / first mount) so the
  // incremental delta is never computed against another run's numbers, and a run
  // we switch or reload into is not double-counted.
  useEffect(() => {
    lastBucketTimeMsRef.current = 0;
    lastAutoMinBucketRef.current = -1;
    lastExpectedCasesRef.current = -1;
  }, [runId]);

  // Re-baseline when auto-track is toggled on so the first bucket after re-enabling
  // continues from the current value instead of adding all the production that
  // accumulated while it was off.
  useEffect(() => {
    lastBucketTimeMsRef.current = 0;
    lastAutoMinBucketRef.current = -1;
    lastExpectedCasesRef.current = -1;
  }, [autoTrackProgress]);

  return {
    autoTrackProgress,
    setAutoTrackProgress,
    autoTrackSuggestion,
    autoSuppressUntilRef,
    lastAutoMinBucketRef,
  };
}
