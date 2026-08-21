import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchActionableIncidentCount } from "../inventoryShared";
import { useMe } from "../useRole";
import { useIdle } from "./useIdle";

// Number of reported issues / crashes a manager hasn't reviewed yet. Polls in
// the background so managers see a nav badge soon after staff report a problem.
// Gated to the review-incidents capability because the endpoint is too; users
// without it never fire the request. Shares the ["unreviewedIncidentCount"]
// cache key so reviewing an incident elsewhere clears the badge here too.
//
// Idle throttling: steps from 20 s down to 2 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all badge queries simultaneously.
export function useUnreviewedIncidentCount(): number {
  const { hasCapability } = useMe();
  const canReview = hasCapability("review-incidents");
  const isIdle = useIdle();

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data } = useQuery({
    queryKey: ["unreviewedIncidentCount"],
    queryFn: fetchActionableIncidentCount,
    enabled: canReview,
    refetchInterval: pollingReady ? (isIdle ? 120_000 : 20_000) : false,
  });
  return canReview ? (data?.count ?? 0) : 0;
}
