import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSupervisorPin } from "../supervisorPinApi";
import { useIdle } from "./useIdle";

// Facility-wide supervisor PIN, shared by every signed-in user. Polls in the
// background so a PIN changed on one device propagates to the others. Open to
// everyone signed in (the local compare that gates supervisor actions needs it);
// changing it is manager-gated server-side.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useSupervisorPin(): {
  pin: string | undefined;
  isSuccess: boolean;
} {
  const isIdle = useIdle();

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isSuccess } = useQuery({
    queryKey: ["supervisorPin"],
    queryFn: fetchSupervisorPin,
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { pin: data, isSuccess };
}
