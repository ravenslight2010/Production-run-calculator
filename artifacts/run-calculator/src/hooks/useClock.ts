import { useEffect, useState } from "react";

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
export function useClock(runStatus: RunStatus): Date {
  const [nowTime, setNowTime] = useState(() => new Date());

  useEffect(() => {
    const delay = (runStatus === "running" || runStatus === "paused") ? 1_000 : PENDING_CLOCK_MS;
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id) clearInterval(id);
      id = document.hidden ? null : setInterval(() => setNowTime(new Date()), delay);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (id) { clearInterval(id); id = null; }
      } else {
        setNowTime(new Date()); // snap clock forward immediately on tab focus
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [runStatus]);

  return nowTime;
}
