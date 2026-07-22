import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPasswordResetRequests } from "../inventoryShared";
import { useMe } from "../useRole";
import { useIdle } from "./useIdle";

// Number of pending password reset requests awaiting approval. Polls in the
// background (independent of the Staff & Roles card) so approvers see a nav badge
// the moment a locked-out staff member asks for help. Gated to the
// approve-password-resets capability because the endpoint is too; users without
// it never fire the request. Shares the ["passwordResetRequests"] cache key with
// the card, so approving a request there clears the badge here too.
//
// Idle throttling: steps from 20 s down to 2 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all badge queries simultaneously.
export function usePendingResetCount(): number {
  const { hasCapability } = useMe();
  const canApprove = hasCapability("approve-password-resets");
  const isIdle = useIdle();

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data } = useQuery({
    queryKey: ["passwordResetRequests"],
    queryFn: fetchPasswordResetRequests,
    enabled: canApprove,
    refetchInterval: pollingReady ? (isIdle ? 120_000 : 20_000) : false,
  });
  return canApprove ? (data ?? []).length : 0;
}
