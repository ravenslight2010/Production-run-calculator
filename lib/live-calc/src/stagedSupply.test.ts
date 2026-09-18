import { describe, expect, it } from "vitest";
import {
  computeAutomaticFrontlineSupply,
  computeAutomaticSauceSupply,
  computeFrontlineRunRequirement,
  computeSauceRunRequirement,
  computeFrontlineEffectiveBatchWeight,
  computeFrontlineSupply,
  computeFrontlineSupplyFromLbs,
  computeSauceSupply,
} from "./stagedSupply";

describe("shared staged supply calculations", () => {
  it("keeps partial final units and subtracts every pipeline stage", () => {
    expect(computeSauceSupply({
      total: 5.5, consumed: 1, onLine: 0.5, ready: 2, inProduction: 1,
    })).toMatchObject({
      total: 5.5, consumed: 1, onLine: 0.5, ready: 2, inProduction: 1,
      stillToMake: 1, stagingRoom: 0,
    });
  });

  it("uses the Sauce cap of three and Frontline cap of two", () => {
    expect(computeSauceSupply({ total: 10, ready: 1 }).stagingRoom).toBe(2);
    expect(computeFrontlineSupply({ total: 10, ready: 1 }).stagingRoom).toBe(1);
  });

  it("automatically fills each active pipeline and advances partial final units", () => {
    expect(computeAutomaticSauceSupply({ total: 5.5, consumed: 1 })).toMatchObject({
      consumed: 1, onLine: 1, ready: 1, inProduction: 1, stillToMake: 1.5,
    });
    expect(computeAutomaticSauceSupply({ total: 5.5, consumed: 4 })).toMatchObject({
      consumed: 4, onLine: 1, ready: 0.5, inProduction: 0, stillToMake: 0,
    });
    expect(computeAutomaticFrontlineSupply({ total: 3.25, consumed: 1 })).toMatchObject({
      consumed: 1, onLine: 1, ready: 1, inProduction: 0, stillToMake: 0.25,
    });
  });

  it("uses valid configured Frontline weights and defaults invalid values to 50", () => {
    expect(computeFrontlineEffectiveBatchWeight(42.5)).toBe(42.5);
    expect(computeFrontlineEffectiveBatchWeight(0)).toBe(50);
    expect(computeFrontlineEffectiveBatchWeight(51)).toBe(50);
    expect(computeFrontlineSupplyFromLbs({ demandLbs: 100, configuredEffectiveWeight: 40 }))
      .toMatchObject({ total: 2.5, effectiveBatchWeight: 40 });
  });

  it("keeps full-run requirements stable independently of packaging progress", () => {
    expect(computeSauceRunRequirement({
      casesNeeded: 100, pizzasPerCase: 10, ozPerPizza: 4, barrelLbs: 50,
    })).toEqual({ totalLbs: 280, totalUnits: 5.6 });
    expect(computeFrontlineRunRequirement({
      casesNeeded: 100, pizzasPerCase: 10, ozPerPizza: 4,
      configuredEffectiveWeight: 70,
    })).toEqual({ totalLbs: 270, totalUnits: 5.4, effectiveBatchWeight: 50 });
  });
});