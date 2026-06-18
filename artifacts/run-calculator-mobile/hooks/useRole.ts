import { useQuery } from "@tanstack/react-query";
import { fetchMe, type Role, type StaffMember } from "../context/inventoryShared";

// Current signed-in user's role, fetched from the API (/me). The server creates
// the row on first sight, so this also bootstraps the first user as manager.
// While loading we default to the more restrictive operator view rather than
// briefly flashing manager-only controls.
export function useMe(): {
  me: StaffMember | null;
  role: Role | null;
  isManager: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 60_000,
  });
  const role = data?.role ?? null;
  return {
    me: data ?? null,
    role,
    isManager: role === "manager",
    isLoading,
  };
}
