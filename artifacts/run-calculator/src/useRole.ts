import { useQuery } from "@tanstack/react-query";
import { fetchMe, type Role, type StaffMember } from "./inventoryShared";

// Current signed-in user's role, fetched from the API (/me). The server creates
// the row on first sight, so this also bootstraps the first user as manager.
// While loading we return null so callers can decide what to render; we default
// to the more restrictive "operator" view rather than briefly flashing
// manager-only controls.
export function useMe(): {
  me: StaffMember | null;
  role: Role | null;
  isManager: boolean;
  // Main-ladder capability: supervisor OR manager. Gates the powers supervisors
  // share with managers (inventory-item CRUD, inventory settings, password-reset
  // approval). Distinct from the local PIN "supervisor mode" in home.tsx.
  isSupervisorOrAbove: boolean;
  // On the QC track (qc-operator or qc-manager).
  isQc: boolean;
  isQcManager: boolean;
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
    isSupervisorOrAbove: role === "supervisor" || role === "manager",
    isQc: role === "qc-operator" || role === "qc-manager",
    isQcManager: role === "qc-manager",
    isLoading,
  };
}
