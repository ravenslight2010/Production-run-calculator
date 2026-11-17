import { describe, expect, it } from "vitest";
import { liveProfileRecipeLinkRepair, liveProfileRecipeLinkRepairContract } from "./liveProfileRecipeLinkRepair";

describe("live profile recipe historical contract", () => {
  it("has an immutable automatic identity and bounded result contract", () => {
    expect(liveProfileRecipeLinkRepair.id).toBe("live-profile-recipe-link-repair-v1");
    expect(liveProfileRecipeLinkRepair.mode).toBe("automatic");
    expect(liveProfileRecipeLinkRepair.managerAllowed).toBe(false);
    expect(Object.isFrozen(liveProfileRecipeLinkRepairContract.repairs)).toBe(true);
    expect(Object.isFrozen(liveProfileRecipeLinkRepairContract.repairs[0])).toBe(true);
    expect(() => { (liveProfileRecipeLinkRepairContract.repairs[0] as { to: string }).to = "changed"; }).toThrow();
    expect(liveProfileRecipeLinkRepair.validateResult?.({ scanned: 5, updated: 5 })).toBe(true);
    expect(liveProfileRecipeLinkRepair.validateResult?.({ scanned: 1, updated: 2 })).toBe(false);
  });
});