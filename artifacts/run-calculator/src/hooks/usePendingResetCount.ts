import { useQuery } from "@tanstack/react-query";
import { fetchPasswordResetRequests } from "../inventoryShared";
import { useMe } from "../useRole";

// Number of pending password reset requests awaiting approval. Polls in the
// background (independent of the Staff & Roles card) so approvers see a nav badge
// the moment a locked-out staff member asks for help. Gated to supervisor-or-
// above because the endpoint is too; operators never fire the request. Shares the
// ["passwordResetRequests"] cache key with the card, so approving a request
// there clears the badge here too.
export function usePendingResetCount(): number {
  const { isSupervisorOrAbove } = useMe();
  const { data } = useQuery({
    queryKey: ["passwordResetRequests"],
    queryFn: fetchPasswordResetRequests,
    enabled: isSupervisorOrAbove,
    refetchInterval: 20_000,
  });
  return isSupervisorOrAbove ? (data ?? []).length : 0;
}
