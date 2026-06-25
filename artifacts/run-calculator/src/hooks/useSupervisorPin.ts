import { useQuery } from "@tanstack/react-query";
import { fetchSupervisorPin } from "../supervisorPinApi";

// Facility-wide supervisor PIN, shared by every signed-in user. Polls in the
// background so a PIN changed on one device propagates to the others. Open to
// everyone signed in (the local compare that gates supervisor actions needs it);
// changing it is manager-gated server-side.
export function useSupervisorPin(): {
  pin: string | undefined;
  isSuccess: boolean;
} {
  const { data, isSuccess } = useQuery({
    queryKey: ["supervisorPin"],
    queryFn: fetchSupervisorPin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { pin: data, isSuccess };
}
