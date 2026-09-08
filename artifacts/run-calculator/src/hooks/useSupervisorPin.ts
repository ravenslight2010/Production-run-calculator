import { useQuery } from "@tanstack/react-query";
import { fetchSupervisorPin } from "../supervisorPinApi";

// Facility-wide supervisor PIN, shared by every signed-in user. The sync SSE
// stream invalidates this canonical query when another station changes it and
// refreshes it on every reconnect baseline, so no background poll is needed.
// Reading remains open to everyone signed in; changing it is manager-gated.
export function useSupervisorPin(): {
  pin: string | undefined;
  isSuccess: boolean;
} {
  const { data, isSuccess } = useQuery({
    queryKey: ["supervisorPin"],
    queryFn: fetchSupervisorPin,
    staleTime: 30_000,
    refetchInterval: false,
  });
  return { pin: data, isSuccess };
}
