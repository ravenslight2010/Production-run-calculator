import { describe, expect, it } from "vitest";
import {
  capApplicatorStock,
  computeApplicatorStockCapacityLbs,
  computeApplicatorStockCadenceSeconds,
  depleteApplicatorStock,
  initializeApplicatorStockOnRunStart,
} from "./applicatorStock";

describe("applicator stock", () => {
  const configured = {
    app1Type: "Cheese",
    app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 40 }],
    app1BatchLbs: 50,
    app2Type: "Mix",
    app2BatchLbs: 25,
    app3Type: "Other",
    app3BatchLbs: 32,
    app4Type: "",
    pep1Type: "Pepperoni",
    pep1OzPerPizza: 2,
    pep1TypeB: "Beef Pepperoni",
    pep1OzPerPizzaB: 2,
    pep2Type: "Pepperoni",
    pep2OzPerPizza: 2,
    pep2TypeB: "Cup Pepperoni",
    pep2OzPerPizzaB: 2,
    pep1Combined: false,
  };

  it("uses each slot's physical cap, including additional pepperoni types", () => {
    expect(computeApplicatorStockCapacityLbs(configured, "app1")).toBe(80);
    expect(computeApplicatorStockCapacityLbs(configured, "app2")).toBe(100);
    expect(computeApplicatorStockCapacityLbs(configured, "app3")).toBe(64);
    expect(computeApplicatorStockCapacityLbs(configured, "app4")).toBe(0);
    expect(computeApplicatorStockCapacityLbs(configured, "pep1")).toBe(50);
    expect(computeApplicatorStockCapacityLbs(configured, "pep1b")).toBe(50);
    expect(computeApplicatorStockCapacityLbs(configured, "pep2")).toBe(50);
    expect(computeApplicatorStockCapacityLbs(configured, "pep2b")).toBe(50);
    expect(computeApplicatorStockCapacityLbs({ ...configured, pep1Combined: true }, "pep2")).toBe(0);
  });

  it("initializes configured stock once without converting old cumulative counts", () => {
    const original = { ...configured, app1BatchesMade: 7, app1StockLbs: 0 };
    const initialized = initializeApplicatorStockOnRunStart(original);
    expect(initialized).toMatchObject({
      applicatorStockInitialized: true,
      app1StockLbs: 80,
      app1StockAnchorNetSec: 0,
      app1StockCorrectionGeneration: 0,
      app2StockLbs: 100,
      app3StockLbs: 64,
      app4StockLbs: 0,
      pep1StockLbs: 50,
      pep1bStockLbs: 50,
      pep2StockLbs: 50,
      pep2bStockLbs: 50,
    });
    expect(original.app1BatchesMade).toBe(7);
    expect(initializeApplicatorStockOnRunStart({ ...original, ...initialized, app1StockLbs: 11 })).toEqual({});
  });

  it("depletes fractionally from actual rate, clamps at zero, and caps operator entries", () => {
    expect(depleteApplicatorStock({ onHandLbs: 3.25, elapsedSeconds: 16, ozPerPizza: 2, ppm: 30 })).toBe(2.25);
    expect(depleteApplicatorStock({ onHandLbs: 0.1, elapsedSeconds: 100, ozPerPizza: 2, ppm: 30 })).toBe(0);
    expect(depleteApplicatorStock({ onHandLbs: 50, elapsedSeconds: 10, ozPerPizza: 0, ppm: 30 })).toBe(50);
    expect(capApplicatorStock(101.234, 100)).toBe(100);
    expect(capApplicatorStock(-1, 100)).toBe(0);
  });

  it("schedules fractional stock checks from usage rate and batch capacity", () => {
    const cadence = computeApplicatorStockCadenceSeconds(configured, "pep1", 30);
    expect(cadence).toBe(50 / (2 * 30 / (16 * 60)) / 4);
    expect(computeApplicatorStockCadenceSeconds(configured, "pep2", 0)).toBe(0);
  });
});
