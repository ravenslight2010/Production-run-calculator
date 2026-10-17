import { describe, expect, it } from "vitest";
import {
  capSauceStock,
  computeSauceStockStepSeconds,
  depleteSauceStock,
  initializeSauceStockOnRunStart,
} from "./sauceStock";

describe("Sauce online stock", () => {
  it("initializes once and preserves a legitimate zero", () => {
    expect(initializeSauceStockOnRunStart({})).toEqual({
      sauceStockBarrels: 2,
      sauceStockAnchorNetSec: 0,
      sauceStockCorrectionGeneration: 0,
      sauceStockInitialized: true,
    });
    expect(initializeSauceStockOnRunStart({
      sauceStockInitialized: true,
      sauceStockBarrels: 0,
    })).toEqual({});
  });

  it("caps and depletes in exact tenths", () => {
    expect(capSauceStock(2.1)).toBe(2);
    expect(capSauceStock(-0.1)).toBe(0);
    expect(depleteSauceStock(2)).toBe(1.9);
    expect(depleteSauceStock(0.1)).toBe(0);
  });

  it("uses one tenth of the full barrel depletion cadence", () => {
    const step = computeSauceStockStepSeconds(2, 60, 30);
    expect(step).toBe(24);
    expect(computeSauceStockStepSeconds(0, 60, 30)).toBe(0);
  });
});
