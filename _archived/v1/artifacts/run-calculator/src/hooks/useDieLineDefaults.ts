import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDieLineDefaults, toOverridesMap, type DieLineDefaultsEntry } from "../dieLineDefaultsServer";
import type { DieLineDefaultsOverrides } from "../dieDefaults";
import { useIdle } from "./useIdle";

export const DIE_LINE_DEFAULTS_QUERY_KEY = ["dieLineDefaults"] as const;

// Manager-set per-die line-setting overrides, shared by the run form / setup
// editor pre-fill and the Manage Lists → Die Defaults editor. Reading is open
// to everyone signed in (the GET endpoint is requireAuth, not manager-gated)
// because every device needs the values to pre-fill line settings. Fail-safe:
// on error the overrides map is just empty and the built-in defaults apply.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useDieLineDefaults(): {
  entries: DieLineDefaultsEntry[];
  overrides: DieLineDefaultsOverrides;
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
    queryKey: DIE_LINE_DEFAULTS_QUERY_KEY,
    queryFn: fetchDieLineDefaults,
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  const entries = data ?? [];
  const overrides = useMemo(() => toOverridesMap(entries), [data]);
  return { entries, overrides, isLoading };
}
