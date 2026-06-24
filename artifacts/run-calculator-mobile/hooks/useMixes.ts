import { useQuery } from "@tanstack/react-query";
import type { Mix } from "@workspace/mixes";
import { fetchMixes } from "../context/mixes";

// Factory-wide mixes, shared by the Mixes make-day plan and the manager
// management UI. Mirrors the web hook (replit.md parity). Open to everyone
// signed in (the GET endpoint is requireAuth, not manager-gated) because every
// app needs the mixes to build the plan.
export function useMixes(): {
  items: Mix[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["mixes"],
    queryFn: fetchMixes,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { items: data ?? [], isLoading };
}
