import { useAuth } from "./useAuth";
import type { Capability, Role, StaffMember } from "./inventoryShared";

// Current signed-in user's identity, role, and capabilities. AuthProvider owns
// the one ["me"] request; keeping role consumers on that context prevents a
// second query function from racing an authoritative sign-in response.
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
  const { me, isLoading } = useAuth();
  const role = me?.role ?? null;
  const capabilities = me?.capabilities ?? [];
  const hasCapability = (cap: Capability): boolean => capabilities.includes(cap);
  return {
    me,
    role,
    capabilities,
    hasCapability,
    isManager: hasCapability("manage-staff"),
    isLoading,
  };
}
