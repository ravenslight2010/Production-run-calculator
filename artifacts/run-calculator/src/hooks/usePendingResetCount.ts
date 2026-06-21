import { useQuery } from "@tanstack/react-query";
import { fetchPasswordResetRequests } from "../inventoryShared";
import { useMe } from "../useRole";

// Number of pending password reset requests awaiting approval. Polls in the
// background (independent of the Staff & Roles card) so approvers see a nav badge
// the moment a locked-out staff member asks for help. Gated to the
// approve-password-resets capability because the endpoint is too; users without
// it never fire the request. Shares the ["passwordResetRequests"] cache key with
// the card, so approving a request there clears the badge here too.
export function usePendingResetCount(): number {
  const { hasCapability } = useMe();
  const canApprove = hasCapability("approve-password-resets");
  const { data } = useQuery({
    queryKey: ["passwordResetRequests"],
    queryFn: fetchPasswordResetRequests,
    enabled: canApprove,
    refetchInterval: 20_000,
  });
  return canApprove ? (data ?? []).length : 0;
}
