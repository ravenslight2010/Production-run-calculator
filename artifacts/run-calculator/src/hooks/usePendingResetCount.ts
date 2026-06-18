import { useQuery } from "@tanstack/react-query";
import { fetchPasswordResetRequests } from "../inventoryShared";
import { useMe } from "../useRole";

// Number of pending password reset requests awaiting a manager. Polls in the
// background (independent of the Staff & Roles card) so managers see a nav badge
// the moment a locked-out staff member asks for help. Gated to managers because
// the endpoint is manager-only; operators never fire the request. Shares the
// ["passwordResetRequests"] cache key with the card, so approving a request
// there clears the badge here too.
export function usePendingResetCount(): number {
  const { isManager } = useMe();
  const { data } = useQuery({
    queryKey: ["passwordResetRequests"],
    queryFn: fetchPasswordResetRequests,
    enabled: isManager,
    refetchInterval: 20_000,
  });
  return isManager ? (data ?? []).length : 0;
}
