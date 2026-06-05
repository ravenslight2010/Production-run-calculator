import { useEffect, useState } from "react";

type RunStatus = "pending" | "running" | "paused" | "ended";

/**
 * Visibility-aware clock ticker.
 * - Ticks every 1 s while a run is live (running or paused).
 * - Slows to 10 s when no run is active.
 * - Pauses entirely when the tab is hidden to avoid waking the device.
 */
export function useClock(runStatus: RunStatus): Date {
  const [nowTime, setNowTime] = useState(() => new Date());

  useEffect(() => {
    const delay = (runStatus === "running" || runStatus === "paused") ? 1_000 : 10_000;
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
