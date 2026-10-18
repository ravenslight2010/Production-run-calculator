import { useEffect, useState } from "react";
import { useVisibilityAwareInterval } from "./useVisibilityAwareInterval";

type RunStatus = "pending" | "running" | "paused" | "ended";

/**
 * Clock interval (ms) used when no run is active (pending / ended).
 * Tests that verify the pending-clock cadence must import this constant and
 * derive their timer advances from it (e.g. PENDING_CLOCK_MS + 1_000) so
 * that changing the cadence here automatically keeps the guard meaningful.
 */
export const PENDING_CLOCK_MS = 10_000;

/**
 * Visibility-aware clock ticker.
 * - Ticks every 1 s while a run is live (running or paused).
 * - Slows to PENDING_CLOCK_MS when no run is active.
 * - Pauses entirely when the tab is hidden to avoid waking the device.
 */
export function useClock(runStatus: RunStatus, wakeAcknowledgement = 0): Date {
  const [nowTime, setNowTime] = useState(() => new Date());
  const delay = (runStatus === "running" || runStatus === "paused") ? 1_000 : PENDING_CLOCK_MS;

  useEffect(() => {
    if (wakeAcknowledgement > 0) setNowTime(new Date());
  }, [wakeAcknowledgement]);

  useVisibilityAwareInterval(() => setNowTime(new Date()), delay, true, runStatus);

  return nowTime;
}
