import { describe, expect, it } from "vitest";
import { RepairExecutionError } from "./repairRegistry";
import { classifyStartupRepairFailure } from "./startupRepairFailure";

describe("startup repair failure classification", () => {
  it("identifies the first actionable repair for degraded startup", () => {
    expect(classifyStartupRepairFailure(new RepairExecutionError("reviewed-repair-v1", "execution")))
      .toEqual({ repairId: "reviewed-repair-v1", errorCode: "data_heals_failed:reviewed-repair-v1" });
    expect(classifyStartupRepairFailure(new Error("unknown"))).toEqual({ errorCode: "data_heals_failed", repairId: undefined });
  });
});