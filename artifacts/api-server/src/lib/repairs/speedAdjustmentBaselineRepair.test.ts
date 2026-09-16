import { describe, expect, it } from "vitest";
import {
  speedAdjustmentBaselineRepair,
  speedAdjustmentBaselineRepairContract,
} from "./speedAdjustmentBaselineRepair";
import { brandProfilesTable, dieLineDefaultsTable } from "@workspace/db";

describe("speed adjustment baseline repair contract", () => {
  it("is immutable, automatic, live-only, and bounded", () => {
    expect(speedAdjustmentBaselineRepair.id).toBe("speed-adjustment-baseline-v1");
    expect(speedAdjustmentBaselineRepair.mode).toBe("automatic");
    expect(speedAdjustmentBaselineRepair.managerAllowed).toBe(false);
    expect(speedAdjustmentBaselineRepairContract).toEqual({
      id: "speed-adjustment-baseline-v1",
      scope: "live",
      profileField: "crustValues.speedAdjustment",
      dieDefaultField: "speedAdjustment",
      value: 0.92,
    });
    expect(Object.isFrozen(speedAdjustmentBaselineRepairContract)).toBe(true);
    expect(speedAdjustmentBaselineRepair.validateResult?.({
      scannedProfiles: 3,
      updatedProfiles: 3,
      scannedDieDefaults: 2,
      updatedDieDefaults: 2,
    })).toBe(true);
    expect(speedAdjustmentBaselineRepair.validateResult?.({
      scannedProfiles: 1,
      updatedProfiles: 2,
      scannedDieDefaults: 0,
      updatedDieDefaults: 0,
    })).toBe(false);
  });

  it("updates only speed adjustment while advancing profile and die stamps", async () => {
    const profile = {
      key: "brand__flavor",
      scope: "live",
      brand: "Brand",
      flavor: "Flavor",
      values: { doughRecipeName: "Keep Dough", arbitrary: 17 },
      crustValues: { cycleSpeed: 8, speedAdjustment: 1 },
      updatedAtMs: 9_999_999_999_999,
      createdAt: new Date(0),
    };
    const die = {
      id: "12in",
      scope: "live",
      name: "12in",
      crustsPerCycle: 5,
      cycleSpeed: 8,
      speedAdjustment: 1,
      freezerTime: 15,
      casesPerLayer: 6,
      preTunnelMin: 2,
      postTunnelMin: 2,
      createdAt: new Date(0),
      updatedAt: new Date("2099-01-01T00:00:00.000Z"),
    };
    const customProfile = {
      ...profile,
      key: "custom__profile",
      crustValues: { cycleSpeed: 7.5, speedAdjustment: 0.85 },
      updatedAtMs: 123,
    };
    const customDie = {
      ...die,
      id: "custom-die",
      name: "Custom Die",
      cycleSpeed: 7.5,
      speedAdjustment: 0.73,
      updatedAt: new Date(0),
    };
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            for: async () => table === brandProfilesTable
              ? [profile, customProfile]
              : [die, customDie],
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => { updates.push({ table, values }); },
        }),
      }),
    };

    const result = await speedAdjustmentBaselineRepair.execute(tx as never);

    expect(result).toEqual({
      scannedProfiles: 2,
      updatedProfiles: 2,
      scannedDieDefaults: 2,
      updatedDieDefaults: 2,
    });
    expect(updates).toHaveLength(4);
    expect(updates[0]).toMatchObject({
      table: brandProfilesTable,
      values: {
        crustValues: { cycleSpeed: 8, speedAdjustment: 0.92 },
        updatedAtMs: 10_000_000_000_000,
      },
    });
    expect(updates[0]?.values).not.toHaveProperty("values");
    expect(updates[1]).toMatchObject({
      table: brandProfilesTable,
      values: {
        crustValues: { cycleSpeed: 7.5, speedAdjustment: 0.92 },
        updatedAtMs: expect.any(Number),
      },
    });
    expect(updates[2]).toMatchObject({
      table: dieLineDefaultsTable,
      values: { speedAdjustment: 0.92 },
    });
    expect((updates[2]?.values.updatedAt as Date).getTime()).toBe(die.updatedAt.getTime() + 1);
    expect(updates[3]).toMatchObject({
      table: dieLineDefaultsTable,
      values: { speedAdjustment: 0.92 },
    });
  });
});