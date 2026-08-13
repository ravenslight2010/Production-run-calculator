// Factory shift timing hook — mobile.
//
// Provides the factory-wide shift start time and production start time, fetched
// from the server KV store. Open to all signed-in users for reading; saving is
// manager-only (enforced by the server).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchFactoryTimes,
  saveFactoryTime,
  SHIFT_START_TIME_KEY,
  PRODUCTION_START_TIME_KEY,
  DEFAULT_SHIFT_START_TIME,
  DEFAULT_PRODUCTION_START_TIME,
  type FactoryTimes,
} from "../context/factoryTimes";

export const FACTORY_TIMES_QUERY_KEY = ["factoryTimes"] as const;

export function useFactoryTimes(): {
  times: FactoryTimes;
  isLoading: boolean;
  saveShiftStart: (value: string) => void;
  saveProductionStart: (value: string) => void;
} {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: FACTORY_TIMES_QUERY_KEY,
    queryFn: fetchFactoryTimes,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const times: FactoryTimes = data ?? {
    shiftStartTime: DEFAULT_SHIFT_START_TIME,
    productionStartTime: DEFAULT_PRODUCTION_START_TIME,
  };

  const mutate = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      saveFactoryTime(key, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: FACTORY_TIMES_QUERY_KEY });
    },
  });

  return {
    times,
    isLoading,
    saveShiftStart: (value: string) =>
      mutate.mutate({ key: SHIFT_START_TIME_KEY, value }),
    saveProductionStart: (value: string) =>
      mutate.mutate({ key: PRODUCTION_START_TIME_KEY, value }),
  };
}
