import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMasterDataBootstrap } from "../masterData";
import type { Ingredient } from "@workspace/ingredient-catalog";
import { useIdle } from "./useIdle";

// Factory-wide ingredient catalog, shared by every recipe surface and the
// Manage Lists ingredient pickers. Polls in the background so a rename/merge/
// delete a manager makes on one device shows up for the floor without a manual
// refresh. Open to everyone signed in (the GET endpoint is requireAuth, not
// manager-gated) because every app needs it to resolve recipe rows and build
// pickers.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useIngredients(): {
  items: Ingredient[];
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
    queryKey: ["ingredients"],
    queryFn: () => fetchMasterDataBootstrap().then((data) => data.ingredients),
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { items: data ?? [], isLoading };
}
