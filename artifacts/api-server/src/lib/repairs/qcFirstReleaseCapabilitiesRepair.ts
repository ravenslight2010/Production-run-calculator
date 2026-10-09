import { eq } from "drizzle-orm";
import { rolesTable } from "@workspace/db";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

/**
 * Adds the first-release QC capabilities to existing starter roles without
 * replacing any manager-edited grants.
 */
export const qcFirstReleaseCapabilitiesRepair: RepairDefinition<RepairTransaction> = {
  id: "qc-first-release-capabilities-v1",
  owner: "role-capability",
  dependencies: [],
  eligibility: "The qc-operator or qc-manager starter role is missing a first-release QC capability.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: {
    affectedScope: "The capability lists of qc-operator and qc-manager only.",
    excludedScope: "All other roles and all non-role data; existing grants on both roles are preserved.",
    rollback: "Remove only record-qc/manage-qc grants before any later authorized role edits.",
    evidence: "The data-heal marker records whether either starter role required an added grant.",
  },
  async execute(tx) {
    let rolesUpdated = 0;
    const requiredByRole = new Map<string, string[]>([
      ["qc-operator", ["record-qc"]],
      ["qc-manager", ["record-qc", "manage-qc"]],
    ]);
    for (const [name, required] of requiredByRole) {
      const [role] = await tx
        .select({ capabilities: rolesTable.capabilities })
        .from(rolesTable)
        .where(eq(rolesTable.name, name))
        .for("update");
      if (!role) throw new Error(`${name} role was not seeded before its capability repair`);
      const capabilities = role.capabilities ?? [];
      const missing = required.filter((capability) => !capabilities.includes(capability));
      if (missing.length === 0) continue;
      await tx
        .update(rolesTable)
        .set({ capabilities: [...capabilities, ...missing] })
        .where(eq(rolesTable.name, name));
      rolesUpdated += 1;
    }
    return { rolesUpdated };
  },
};
