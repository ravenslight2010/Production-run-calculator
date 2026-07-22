import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMixes } from "../mixes";
import type { Mix } from "@workspace/mixes";
import { useIdle } from "./useIdle";

// Factory-wide mixes, shared by the Mixes make-day plan and the manager
// management UI. Polls in the background so a mix a manager adds on one device
// shows up for the floor without a manual refresh. Open to everyone signed in
// (the GET endpoint is requireAuth, not manager-gated) because every app needs
// the mixes to build the plan.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useMixes(): {
  items: Mix[];
  isLoading: boolean;
} {
  const isIdle = useIdle();

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useQuery({
    queryKey: ["mixes"],
    queryFn: fetchMixes,
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { items: data ?? [], isLoading };
}
