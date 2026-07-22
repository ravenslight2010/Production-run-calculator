import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRunTemplates } from "../runTemplatesApi";
import type { RunTemplate } from "../types";
import { useIdle } from "./useIdle";

// Facility-wide saved run templates, shared by every signed-in user. Polls in
// the background so a template saved on one device shows up on another without a
// manual refresh. Open to everyone signed in (the GET endpoint is requireAuth,
// not manager-gated) — templates are a shared convenience.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useRunTemplates(): {
  templates: RunTemplate[];
  isLoading: boolean;
  isSuccess: boolean;
} {
  const isIdle = useIdle();

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isSuccess } = useQuery({
    queryKey: ["runTemplates"],
    queryFn: fetchRunTemplates,
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { templates: data ?? [], isLoading, isSuccess };
}
