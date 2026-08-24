import { useCallback, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Mix } from "@workspace/mixes";
import { mergeMixUpdates } from "../mixes";

const MIXES_QUERY_KEY = ["mixes"] as const;

/**
 * Keeps Mix Plan's one-record saves visible while the shared mix query is
 * refreshed. A slow POST can overlap a background GET that still contains the
 * old amount; the overlay is only cleared after the POST acknowledges the
 * same mix, so the plan cannot briefly fall back to the old value.
 */
export function useOptimisticMixUpdates(items: Mix[], queryClient: QueryClient) {
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, Mix>>(() => new Map());

  const mixPlanItems = useMemo(
    () => items.map((item) => pendingUpdates.get(item.id) ?? item),
    [items, pendingUpdates],
  );

  const patchCache = useCallback((updates: Mix[]) => {
    queryClient.setQueryData<Mix[]>(MIXES_QUERY_KEY, (current) =>
      mergeMixUpdates(current, updates),
    );
  }, [queryClient]);

  const saveOptimistically = useCallback((nextMix: Mix) => {
    setPendingUpdates((current) => {
      const next = new Map(current);
      next.set(nextMix.id, nextMix);
      return next;
    });
    patchCache([nextMix]);
    // Ignore a GET that started before this optimistic write. The overlay also
    // protects the Mix Plan if another refetch starts while the POST is slow.
    void queryClient.cancelQueries({ queryKey: MIXES_QUERY_KEY });
  }, [patchCache, queryClient]);

  const acknowledgeSave = useCallback((optimisticMix: Mix, saved: Mix[]) => {
    const persisted = saved.find((item) => item.id === optimisticMix.id);
    if (!persisted) return;

    patchCache([persisted]);
    // Cancel a stale refetch that could otherwise land after the POST response
    // and undo the server-confirmed cache patch.
    void queryClient.cancelQueries({ queryKey: MIXES_QUERY_KEY });
    setPendingUpdates((current) => {
      const next = new Map(current);
      next.delete(optimisticMix.id);
      return next;
    });
  }, [patchCache, queryClient]);

  return { mixPlanItems, saveOptimistically, acknowledgeSave };
}