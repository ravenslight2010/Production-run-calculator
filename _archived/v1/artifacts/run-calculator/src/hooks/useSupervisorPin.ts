import { useQuery } from "@tanstack/react-query";
import { fetchSupervisorPin } from "../supervisorPinApi";
import type { SupervisorPinStatus } from "../supervisorPinApi";
import { useAuth } from "../useAuth";

// Nonsecret facility gate status. The sync SSE
// stream invalidates this canonical query when another station changes it and
// refreshes it on every reconnect baseline, so no background poll is needed.
// Reading remains open to everyone signed in; changing it is manager-gated.
export function useSupervisorPin(): {
  pin: SupervisorPinStatus | undefined;
  isSuccess: boolean;
} {
  const { me } = useAuth();
  const { data, isSuccess } = useQuery({
    queryKey: ["supervisorPin", me?.userId, me?.sandbox],
    queryFn: fetchSupervisorPin,
    staleTime: 30_000,
    refetchInterval: false,
  });
  return { pin: data, isSuccess };
}
