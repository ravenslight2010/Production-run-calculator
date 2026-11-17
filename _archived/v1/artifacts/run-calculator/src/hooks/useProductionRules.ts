import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchProductionRules } from "../productionRules";
import type { ProductionRule } from "@workspace/production-rules";
import { useIdle } from "./useIdle";

// Factory-wide production rules, shared by the run-config evaluation (warn/block)
// and the manager management UI. Polls in the background so a rule a manager adds
// on one device shows up on the floor without a manual refresh. Open to everyone
// signed in (the GET endpoint is requireAuth, not manager-gated) because both
// operators and managers need rules evaluated against their runs.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useProductionRules(): {
  rules: ProductionRule[];
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
    queryKey: ["productionRules"],
    queryFn: fetchProductionRules,
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { rules: data ?? [], isLoading };
}
