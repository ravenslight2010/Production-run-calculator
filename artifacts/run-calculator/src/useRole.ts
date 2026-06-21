import { useQuery } from "@tanstack/react-query";
import {
  fetchMe,
  type Capability,
  type Role,
  type StaffMember,
} from "./inventoryShared";

// Current signed-in user's identity, role, and capabilities, fetched from /me.
// The server creates the row on first sight, so this also bootstraps the first
// user as manager. While loading we return no capabilities so callers default to
// the most restrictive view rather than briefly flashing privileged controls.
export function useMe(): {
  me: StaffMember | null;
  role: Role | null;
  capabilities: Capability[];
  hasCapability: (cap: Capability) => boolean;
  // Convenience alias for the manage-staff capability. Kept ONLY for the
  // out-of-scope /sync gates and the web home PIN bypass; prefer hasCapability
  // for everything else.
  isManager: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 60_000,
  });
  const role = data?.role ?? null;
  const capabilities = data?.capabilities ?? [];
  const hasCapability = (cap: Capability): boolean => capabilities.includes(cap);
  return {
    me: data ?? null,
    role,
    capabilities,
    hasCapability,
    isManager: hasCapability("manage-staff"),
    isLoading,
  };
}
