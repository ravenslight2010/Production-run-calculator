import { describe, expect, it } from "vitest";
import { canReviewGoldRetention, hasRoleSurfaceAccess } from "./roleSurfaceAccess";

describe("role surface access", () => {
  it("requires both an approved role and capability for retention metadata", () => {
    for (const role of ["manager", "qc-manager"]) {
      expect(canReviewGoldRetention(role, ["manage-staff"])).toBe(true);
      expect(canReviewGoldRetention(role, ["manage-qc"])).toBe(true);
      expect(canReviewGoldRetention(role, [])).toBe(false);
      expect(canReviewGoldRetention(role, ["record-qc"])).toBe(false);
    }
    for (const role of [undefined, null, "operator", "supervisor", "custom-manager"]) {
      expect(canReviewGoldRetention(role, ["manage-staff", "manage-qc"])).toBe(false);
    }
  });

  it("does not infer QC, schedule, or profile access from staff management", () => {
    const capabilities = ["manage-staff"] as const;
    expect(hasRoleSurfaceAccess("qcWorkflow", capabilities)).toBe(false);
    expect(hasRoleSurfaceAccess("productionSchedule", capabilities)).toBe(false);
    expect(hasRoleSurfaceAccess("setupProfiles", capabilities)).toBe(false);
  });

  it("matches each management surface to its route capability", () => {
    expect(hasRoleSurfaceAccess("productionSchedule", ["manage-factory-settings"])).toBe(true);
    expect(hasRoleSurfaceAccess("runManagement", ["manage-factory-settings"])).toBe(true);
    expect(hasRoleSurfaceAccess("setupProfiles", ["manage-profiles"])).toBe(true);
    expect(hasRoleSurfaceAccess("qcWorkflow", ["record-qc"])).toBe(true);
    expect(hasRoleSurfaceAccess("qcWorkflow", ["manage-qc"])).toBe(true);
  });
});
