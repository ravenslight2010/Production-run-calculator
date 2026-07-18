import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDieLineDefaults, toOverridesMap, type DieLineDefaultsEntry } from "../dieLineDefaultsServer";
import type { DieLineDefaultsOverrides } from "../dieDefaults";

export const DIE_LINE_DEFAULTS_QUERY_KEY = ["dieLineDefaults"] as const;

// Manager-set per-die line-setting overrides, shared by the run form / setup
// editor pre-fill and the Manage Lists → Die Defaults editor. Reading is open
// to everyone signed in (the GET endpoint is requireAuth, not manager-gated)
// because every device needs the values to pre-fill line settings. Fail-safe:
// on error the overrides map is just empty and the built-in defaults apply.
export function useDieLineDefaults(): {
  entries: DieLineDefaultsEntry[];
  overrides: DieLineDefaultsOverrides;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: DIE_LINE_DEFAULTS_QUERY_KEY,
    queryFn: fetchDieLineDefaults,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const entries = data ?? [];
  const overrides = useMemo(() => toOverridesMap(entries), [data]);
  return { entries, overrides, isLoading };
}
