import { and, eq } from "drizzle-orm";
import { brandProfilesTable, dieLineDefaultsTable } from "@workspace/db";
import type { RepairDefinition, RepairTransaction } from "../repairRegistry";

export const SPEED_ADJUSTMENT_BASELINE_REPAIR_ID = "speed-adjustment-baseline-v1";
export const SPEED_ADJUSTMENT_BASELINE = 0.92;

export const speedAdjustmentBaselineRepair: RepairDefinition<RepairTransaction> = Object.freeze({
  id: SPEED_ADJUSTMENT_BASELINE_REPAIR_ID,
  owner: "production-settings",
  dependencies: Object.freeze([]),
  eligibility: "Every saved live setup profile and live manager-configured die default.",
  mode: "automatic",
  executionMode: "runner-transactional",
  resultOwnership: "runner-marker",
  managerAllowed: false,
  safety: Object.freeze({
    affectedScope: "all live brand_profiles and live die_line_defaults rows; speed adjustment only",
    excludedScope: "sandbox rows, daily sync, scheduled runs, completed runs, and historical snapshots",
    rollback: "Restore the prior database checkpoint before publish; the marker prevents partial or repeated execution.",
    evidence: "Bounded profile and die-default scanned/updated counts plus focused preservation and scope tests.",
  }),
  async execute(tx) {
    // This is an approved factory-wide replacement, not a legacy-value
    // backfill: every saved live profile and manager die override must converge
    // to the same baseline while run snapshots remain outside this repair.
    const profiles = await tx.select().from(brandProfilesTable)
      .where(eq(brandProfilesTable.scope, "live")).for("update");
    const dieDefaults = await tx.select().from(dieLineDefaultsTable)
      .where(eq(dieLineDefaultsTable.scope, "live")).for("update");
    const nowMs = Date.now();

    for (const profile of profiles) {
      await tx.update(brandProfilesTable).set({
        crustValues: {
          ...(profile.crustValues ?? {}),
          speedAdjustment: SPEED_ADJUSTMENT_BASELINE,
        },
        updatedAtMs: Math.max((profile.updatedAtMs ?? 0) + 1, nowMs),
      }).where(and(
        eq(brandProfilesTable.key, profile.key),
        eq(brandProfilesTable.scope, "live"),
      ));
    }

    for (const row of dieDefaults) {
      await tx.update(dieLineDefaultsTable).set({
        speedAdjustment: SPEED_ADJUSTMENT_BASELINE,
        updatedAt: new Date(Math.max(row.updatedAt.getTime() + 1, nowMs)),
      }).where(and(
        eq(dieLineDefaultsTable.id, row.id),
        eq(dieLineDefaultsTable.scope, "live"),
      ));
    }

    return {
      scannedProfiles: profiles.length,
      updatedProfiles: profiles.length,
      scannedDieDefaults: dieDefaults.length,
      updatedDieDefaults: dieDefaults.length,
    };
  },
  validateResult: (result) => {
    const counts = [
      result.scannedProfiles,
      result.updatedProfiles,
      result.scannedDieDefaults,
      result.updatedDieDefaults,
    ];
    return counts.every((value) => Number.isInteger(value) && Number(value) >= 0) &&
      Number(result.updatedProfiles) <= Number(result.scannedProfiles) &&
      Number(result.updatedDieDefaults) <= Number(result.scannedDieDefaults);
  },
});

export const speedAdjustmentBaselineRepairContract = Object.freeze({
  id: SPEED_ADJUSTMENT_BASELINE_REPAIR_ID,
  scope: "live",
  profileField: "crustValues.speedAdjustment",
  dieDefaultField: "speedAdjustment",
  value: SPEED_ADJUSTMENT_BASELINE,
});