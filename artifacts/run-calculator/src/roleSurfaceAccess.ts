import type { Capability } from "./inventoryShared";

export const ROLE_SURFACE_CAPABILITIES = {
  productionSchedule: ["manage-factory-settings"],
  setupProfiles: ["manage-profiles"],
  runManagement: ["manage-factory-settings"],
  qcWorkflow: ["record-qc", "manage-qc"],
} as const satisfies Record<string, readonly Capability[]>;

export type RoleSurface = keyof typeof ROLE_SURFACE_CAPABILITIES;

export function hasRoleSurfaceAccess(
  surface: RoleSurface,
  capabilities: readonly Capability[],
): boolean {
  const held = new Set(capabilities);
  return ROLE_SURFACE_CAPABILITIES[surface].some((capability) => held.has(capability));
}
