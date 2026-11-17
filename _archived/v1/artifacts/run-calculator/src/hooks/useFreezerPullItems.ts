import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchFreezerPullItems } from "../freezerPull";
import type { FreezerPullItem } from "@workspace/freezer-pull";
import { useIdle } from "./useIdle";
import { recordDeferredStartup } from "../performanceDiagnostics";

// Factory-wide freezer-pull items, shared by the warehouse "Pull Out Freezer"
// notices and the manager management UI. Polls in the background so an item a
// manager adds on one device shows up on the floor without a manual refresh.
// Open to everyone signed in (the GET endpoint is requireAuth, not manager-gated)
// because every app needs the items to build the pull plan.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useFreezerPullItems(enabled = true): {
  items: FreezerPullItem[];
  isLoading: boolean;
} {
  const isIdle = useIdle();
  useEffect(() => {
    if (!enabled) recordDeferredStartup("freezer-pull-items");
  }, [enabled]);

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useQuery({
    queryKey: ["freezerPullItems"],
    queryFn: fetchFreezerPullItems,
    enabled,
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { items: data ?? [], isLoading: enabled && isLoading };
}
