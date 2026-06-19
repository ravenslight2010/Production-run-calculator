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
    trays: number | null;
    batches: number | null;
  } | null;
  autoSuppressUntilRef: React.MutableRefObject<number>;
  lastAutoMinBucketRef: React.MutableRefObject<number>;
}

/**
 * Tracks expected progress automatically every 5-minute bucket while running.
 *
 * Skids/cases: absolute calculation from run start (using total elapsed time).
 * Trays/batches: incremental decrement per bucket — subtracts consumption for
 * the actual duration since the last bucket fired. This is self-correcting:
 * it survives page reloads and handles mid-run replenishments correctly without
 * needing a starting-value snapshot.
 */
export function useAutoTrack({
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
    if (Date.now() < autoSuppressUntilRef.current) return;

    const bucket = Math.floor(nowTime.getTime() / (5 * 60 * 1000));
    if (bucket === lastAutoMinBucketRef.current) return;

    // How long since the last bucket fired (capped to 10 min to avoid huge jumps).
    const nowMs = nowTime.getTime();
    const prevMs = lastBucketTimeMsRef.current;
    const bucketDurationMin = prevMs > 0
      ? Math.min(10, (nowMs - prevMs) / 60000)
      : 5; // first bucket — assume 5-min duration

    lastAutoMinBucketRef.current = bucket;
    lastBucketTimeMsRef.current = nowMs;

    // Skids / cases: absolute calculation based on total elapsed time.
    form.setValue("skidsCompleted", autoTrackSuggestion.skids, { shouldDirty: true });
    form.setValue("casesOnCurrentSkid", autoTrackSuggestion.casesOnSkid, { shouldDirty: true });

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

  // Reset lastBucketTimeMsRef when the run stops so the next run starts fresh.
  useEffect(() => {
    if (runStatus === "pending" || runStatus === "ended") {
      lastBucketTimeMsRef.current = 0;
      lastAutoMinBucketRef.current = -1;
    }
  }, [runStatus]);

  return {
    autoTrackProgress,
    setAutoTrackProgress,
    autoTrackSuggestion,
    autoSuppressUntilRef,
    lastAutoMinBucketRef,
  };
}
