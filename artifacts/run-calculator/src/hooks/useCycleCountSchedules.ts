import { useQuery } from "@tanstack/react-query";
import { fetchCycleCountSchedules } from "../cycleCount";
import type { CycleCountSchedule } from "@workspace/cycle-count";

// Factory-wide cycle-count schedules, shared by the warehouse "Time to Count"
// card and the manager management UI. Polls in the background so a schedule a
// manager adds (or a section a coworker marks counted) on one device shows up on
// the floor without a manual refresh. Open to everyone signed in (the GET
// endpoint is requireAuth, not manager-gated) because every app needs the
// schedules to build the due list.
export function useCycleCountSchedules(): {
  schedules: CycleCountSchedule[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["cycleCountSchedules"],
    queryFn: fetchCycleCountSchedules,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { schedules: data ?? [], isLoading };
}
