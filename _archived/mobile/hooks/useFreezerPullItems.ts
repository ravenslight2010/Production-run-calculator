import { useQuery } from "@tanstack/react-query";
import type { FreezerPullItem } from "@workspace/freezer-pull";
import { fetchFreezerPullItems } from "../context/freezerPull";

// Factory-wide freezer-pull items, shared by the warehouse "Pull Out Freezer"
// notices and the manager management UI. Mirrors the web hook (replit.md
// parity). Open to everyone signed in (the GET endpoint is requireAuth, not
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
