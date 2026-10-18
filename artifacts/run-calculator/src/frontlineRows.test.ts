import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES } from "./types";
import { deriveFrontlineNeedRows, type FrontlineQuantitySource } from "./frontlineRows";

const quantities: FrontlineQuantitySource = {
  sauceLbs: 90, sauceBatches: 3,
  app1Lbs: 40, app1Batches: 2,
  app2Lbs: 30, app2Batches: 0,
  app3Lbs: 20, app3Batches: 1,
  app4Lbs: 10, app4Batches: 0,
  pep1Lbs: 12, pep1Batches: 0,
  pep1LbsB: 8, pep1BatchesB: 2,
  pep2Lbs: 9, pep2Batches: 3,
  pep2LbsB: 7, pep2BatchesB: 0,
};

describe("deriveFrontlineNeedRows", () => {
  it("keeps physical line order and falls back to pounds without a batch weight", () => {
    const v = {
      ...DEFAULT_VALUES,
      sauceOzPerPizza: 2,
      app1Type: "Cheese",
      app2Type: "Cheese",
      app3Type: "Mix",
      app4Type: "Cheese",
      pep1Combined: false,
      pep1Type: "Pep A",
      pep1TypeB: "Pep B",
      pep2Type: "Pep C",
      pep2TypeB: "Pep D",
    };
    const rows = deriveFrontlineNeedRows(v, quantities);
    expect(rows.map((row) => row.key)).toEqual([
      "sauce", "app1", "app2", "pep1", "pep1b", "pep2", "pep2b", "app3", "app4",
    ]);
    expect(rows.find((row) => row.key === "app1")).toMatchObject({
      unit: "batches", batchProgressField: "app1BatchesMade",
    });
    expect(rows.find((row) => row.key === "app2")).toMatchObject({
      unit: "lbs", amount: 30,
    });
    expect(rows.find((row) => row.key === "app2")).not.toHaveProperty("batchProgressField");
    expect(rows.find((row) => row.key === "pep2b")).toMatchObject({
      unit: "lbs", amount: 7,
    });
  });

  it("represents a combined Pep station once and hides unused rows", () => {
    const v = {
      ...DEFAULT_VALUES,
      app1Type: "",
      pep1Combined: true,
      pep1Type: "Pep A",
      pep2Type: "Pep C",
    };
    const rows = deriveFrontlineNeedRows(v, quantities);
    expect(rows.map((row) => row.label)).toEqual(["Pep 1 & 2 — Pep A"]);
    expect(rows.some((row) => row.station === "pep2")).toBe(false);
  });

  it("shows configured Pep slots with zero demand and hides blank slots", () => {
    const v = {
      ...DEFAULT_VALUES,
      pep1Combined: false,
      pep1Type: "  Pep A  ",
      pep1TypeB: "   ",
      pep2Type: "\tPep C",
      pep2TypeB: "Pep D",
    };
    const zeroQuantities: FrontlineQuantitySource = {
      sauceLbs: 0, sauceBatches: 0,
      app1Lbs: 0, app1Batches: 0,
      app2Lbs: 0, app2Batches: 0,
      app3Lbs: 0, app3Batches: 0,
      app4Lbs: 0, app4Batches: 0,
      pep1Lbs: 0, pep1Batches: 0,
      pep2Lbs: 0, pep2Batches: 0,
      pep1LbsB: 0, pep1BatchesB: 0,
      pep2LbsB: 0, pep2BatchesB: 0,
    };

    const rows = deriveFrontlineNeedRows(v, zeroQuantities);

    expect(rows.map((row) => row.key)).toEqual(["pep1", "pep2", "pep2b"]);
    expect(rows.map((row) => row.label)).toEqual([
      "Pep 1 — Pep A",
      "Pep 2 — Pep C",
      "Pep 2 — Pep D",
    ]);
    expect(rows.every((row) => row.amount === 0 && row.unit === "lbs" && row.totalLbs === 0)).toBe(true);
  });

  it("shows no plausible rows when shared case-based quantities are unavailable", () => {
    const rows = deriveFrontlineNeedRows(
      { ...DEFAULT_VALUES, casesNeeded: 240, pizzasPerCase: 0, app1Type: "Cheese", app1OzPerPizza: 2.9 },
      { ...quantities, productionNeedsAvailable: false } as FrontlineQuantitySource,
    );
    expect(rows).toEqual([]);
  });
});