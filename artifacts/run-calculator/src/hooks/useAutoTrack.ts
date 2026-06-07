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
 * Returns the suggestion (for display) and refs that callers use to suppress
 * auto-tracking after a manual override.
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
    const expectedCases = Math.floor((elapsedMinAfterTunnel * calc.ppm) / v.pizzasPerCase);

    return {
      skids: Math.min(maxSkids, Math.floor(expectedCases / v.casesPerSkid)),
      casesOnSkid: Math.min(v.casesPerSkid, expectedCases % v.casesPerSkid),
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
    lastAutoMinBucketRef.current = bucket;
    form.setValue("skidsCompleted", autoTrackSuggestion.skids, { shouldDirty: true });
    form.setValue("casesOnCurrentSkid", autoTrackSuggestion.casesOnSkid, { shouldDirty: true });
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
