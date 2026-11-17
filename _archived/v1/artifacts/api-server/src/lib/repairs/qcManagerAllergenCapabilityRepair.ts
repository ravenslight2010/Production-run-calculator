import { eq } from "drizzle-orm";
import { rolesTable } from "@workspace/db";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

/**
 * Existing qc-manager roles are editable and must keep their saved grants.
 * This one-time additive change grants only the newly approved capability.
 */
export const qcManagerAllergenCapabilityRepair: RepairDefinition<RepairTransaction> = {
  id: "qc-manager-allergen-capability-v1",
  owner: "role-capability",
  dependencies: [],
  eligibility: "The existing qc-manager role does not yet include manage-allergens.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: {
    affectedScope: "The qc-manager role's capability list only.",
    excludedScope: "All other roles and all ingredient or run data.",
    rollback: "Restore the qc-manager capability list only before any authorized role edits.",
    evidence: "The data-heal marker records whether the single role required an added grant.",
  },
  async execute(tx) {
    const [role] = await tx
      .select({ capabilities: rolesTable.capabilities })
      .from(rolesTable)
      .where(eq(rolesTable.name, "qc-manager"))
      .for("update");
    if (!role) throw new Error("qc-manager role was not seeded before its capability repair");
    const capabilities = role.capabilities ?? [];
    if (capabilities.includes("manage-allergens")) return { rolesUpdated: 0 };
    await tx
      .update(rolesTable)
      .set({ capabilities: [...capabilities, "manage-allergens"] })
      .where(eq(rolesTable.name, "qc-manager"));
    return { rolesUpdated: 1 };
  },
};
