import type { Capability } from "./inventoryShared";

export const ROLE_SURFACE_CAPABILITIES = {
  productionSchedule: ["manage-factory-settings"],
  setupProfiles: ["manage-profiles"],
  runManagement: ["manage-factory-settings"],
  qcWorkflow: ["record-qc", "manage-qc"],
} as const satisfies Record<string, readonly Capability[]>;

export type RoleSurface = keyof typeof ROLE_SURFACE_CAPABILITIES;

/** Match both server gates before requesting source-retention metadata. */
export function canReviewGoldRetention(
  role: string | null | undefined,
  capabilities: readonly Capability[],
): boolean {
  return (role === "manager" || role === "qc-manager") &&
    capabilities.some((capability) => capability === "manage-staff" || capability === "manage-qc");
}

export function hasRoleSurfaceAccess(
  surface: RoleSurface,
  capabilities: readonly Capability[],
): boolean {
  const held = new Set(capabilities);
  return ROLE_SURFACE_CAPABILITIES[surface].some((capability) => held.has(capability));
}
