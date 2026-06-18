import { useQuery } from "@tanstack/react-query";
import { fetchUnreviewedIncidentCount } from "@/context/inventoryShared";
import { useMe } from "@/hooks/useRole";

// Number of reported issues / crashes a manager hasn't reviewed yet. Polls in
// the background so managers see a nav badge soon after staff report a problem.
// Gated to managers because the endpoint is manager-only; operators never fire
// the request. Shares the ["unreviewedIncidentCount"] cache key so reviewing an
// incident elsewhere clears the badge here too. Mirrors the web hook.
export function useUnreviewedIncidentCount(): number {
  const { isManager } = useMe();
  const { data } = useQuery({
    queryKey: ["unreviewedIncidentCount"],
    queryFn: fetchUnreviewedIncidentCount,
    enabled: isManager,
    refetchInterval: 20_000,
  });
  return isManager ? (data?.count ?? 0) : 0;
}
