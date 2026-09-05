import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Mix } from "@workspace/mixes";
import { mergeMixUpdates } from "../mixes";
import {
  MASTER_DATA_QUERY_KEY,
  updateMasterDataSlice,
} from "../masterData";

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

  // A cache observer may receive an older GET after the save response. Keep
  // the acknowledged value mounted until the query's item has caught up;
  // otherwise the plan can briefly (or permanently, for prep-only cards)
  // revert to amountAlreadyMade = 0.
  useEffect(() => {
    if (pendingUpdates.size === 0) return;
    const caughtUp = new Set(
      items
        .filter((item) => {
          const pending = pendingUpdates.get(item.id);
          return pending && item.amountAlreadyMade === pending.amountAlreadyMade;
        })
        .map((item) => item.id),
    );
    if (caughtUp.size === 0) return;
    setPendingUpdates((current) => {
      const next = new Map(current);
      for (const id of caughtUp) next.delete(id);
      return next;
    });
  }, [items, pendingUpdates]);

  const patchCache = useCallback((updates: Mix[]) => {
    updateMasterDataSlice(queryClient, "mixes", (current) =>
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
    void queryClient.cancelQueries({ queryKey: MASTER_DATA_QUERY_KEY });
  }, [patchCache, queryClient]);

  const acknowledgeSave = useCallback((optimisticMix: Mix, saved: Mix[]) => {
    const persisted = saved.find((item) => item.id === optimisticMix.id);
    if (!persisted) return;

    patchCache([persisted]);
    // Cancel a stale refetch that could otherwise land after the POST response
    // and undo the server-confirmed cache patch.
    void queryClient.cancelQueries({ queryKey: MASTER_DATA_QUERY_KEY });
    setPendingUpdates((current) => {
      const next = new Map(current);
      // Keep the overlay until the observer sees the acknowledged value.
      // This is important when a refetch started before the POST resolves.
      next.set(optimisticMix.id, persisted);
      return next;
    });
  }, [patchCache, queryClient]);

  return { mixPlanItems, saveOptimistically, acknowledgeSave };
}