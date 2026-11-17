import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCycleCountSchedules } from "../cycleCount";
import type { CycleCountSchedule } from "@workspace/cycle-count";
import { useIdle } from "./useIdle";
import { recordDeferredStartup } from "../performanceDiagnostics";

// Factory-wide cycle-count schedules, shared by the warehouse "Time to Count"
// card and the manager management UI. Polls in the background so a schedule a
// manager adds (or a section a coworker marks counted) on one device shows up on
// the floor without a manual refresh. Open to everyone signed in (the GET
// endpoint is requireAuth, not manager-gated) because every app needs the
// schedules to build the due list.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useCycleCountSchedules(enabled = true): {
  schedules: CycleCountSchedule[];
  isLoading: boolean;
} {
  const isIdle = useIdle();
  useEffect(() => {
    if (!enabled) recordDeferredStartup("cycle-count-schedules");
  }, [enabled]);

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useQuery({
    queryKey: ["cycleCountSchedules"],
    queryFn: fetchCycleCountSchedules,
    enabled,
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { schedules: data ?? [], isLoading: enabled && isLoading };
}
