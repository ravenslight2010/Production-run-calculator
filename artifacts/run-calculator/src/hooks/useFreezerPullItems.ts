import { useQuery } from "@tanstack/react-query";
import { fetchFreezerPullItems } from "../freezerPull";
import type { FreezerPullItem } from "@workspace/freezer-pull";

// Factory-wide freezer-pull items, shared by the warehouse "Pull Out Freezer"
// notices and the manager management UI. Polls in the background so an item a
// manager adds on one device shows up on the floor without a manual refresh.
// Open to everyone signed in (the GET endpoint is requireAuth, not
// manager-gated) because every app needs the items to build the pull plan.
export function useFreezerPullItems(): {
  items: FreezerPullItem[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["freezerPullItems"],
    queryFn: fetchFreezerPullItems,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { items: data ?? [], isLoading };
}
