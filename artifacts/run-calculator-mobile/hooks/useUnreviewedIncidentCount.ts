import { useQuery } from "@tanstack/react-query";
import { fetchUnreviewedIncidentCount } from "@/context/inventoryShared";
import { useMe } from "@/hooks/useRole";

// Number of reported issues / crashes a manager hasn't reviewed yet. Polls in
// the background so managers see a nav badge soon after staff report a problem.
// Gated to the review-incidents capability because the endpoint is too; users
// without it never fire the request. Shares the ["unreviewedIncidentCount"]
// cache key so reviewing an incident elsewhere clears the badge here too.
// Mirrors the web hook.
export function useUnreviewedIncidentCount(): number {
  const { hasCapability } = useMe();
  const canReview = hasCapability("review-incidents");
  const { data } = useQuery({
    queryKey: ["unreviewedIncidentCount"],
    queryFn: fetchUnreviewedIncidentCount,
    enabled: canReview,
    refetchInterval: 20_000,
  });
  return canReview ? (data?.count ?? 0) : 0;
}
