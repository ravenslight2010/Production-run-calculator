import { describe, expect, it } from "vitest";
import {
  effectiveProductionCases,
  isMatchingSurplusProduct,
  isValidSurplusDate,
  normalizeSurplusProduct,
  summarizeSurplusForRun,
  type FreezerSurplusLedger,
} from "./surplus";

const ledger: FreezerSurplusLedger = {
  lots: [
    {
      id: "old",
      brand: "Acme",
      flavor: "Pepperoni",
      productKey: "acme::pepperoni",
      productionDate: "2026-08-20",
      totalCases: 20,
      remainingCases: 8,
    },
    {
      id: "new",
      brand: "Acme",
      flavor: "Pepperoni",
      productKey: "acme::pepperoni",
      productionDate: "2026-08-27",
      totalCases: 12,
      remainingCases: 12,
    },
    {
      id: "other",
      brand: "Other",
      flavor: "Pepperoni",
      productKey: "other::pepperoni",
      productionDate: "2026-08-27",
      totalCases: 50,
      remainingCases: 50,
    },
  ],
  allocations: [
    {
      id: "run-1:old",
      lotId: "old",
      runId: "run-1",
      runDate: "2026-08-28",
      brand: "Acme",
      flavor: "Pepperoni",
      productKey: "acme::pepperoni",
      cases: 12,
    },
  ],
};

describe("dated freezer surplus", () => {
  it("normalizes product identity without merging different products", () => {
    expect(normalizeSurplusProduct("  ACME  ", " Pepperoni ")).toEqual({
      brand: "ACME",
      flavor: "Pepperoni",
      productKey: "acme::pepperoni",
    });
    expect(isMatchingSurplusProduct(
      { brand: "Acme", flavor: "Pepperoni" },
      { brand: " acme ", flavor: "pepperoni" },
    )).toBe(true);
    expect(isMatchingSurplusProduct(
      { brand: "Acme", flavor: "Pepperoni" },
      { brand: "Acme", flavor: "Cheese" },
    )).toBe(false);
  });

  it("rejects impossible dates and preserves independently dated lots", () => {
    expect(isValidSurplusDate("2026-02-29")).toBe(false);
    expect(isValidSurplusDate("2026-08-27")).toBe(true);
    const summary = summarizeSurplusForRun({
      ...ledger,
      runId: "run-2",
      brand: "Acme",
      flavor: "Pepperoni",
      originalTarget: 500,
    });
    expect(summary.availableLots.map((lot) => lot.id)).toEqual(["old", "new"]);
  });

  it("subtracts only explicitly allocated cases and caps at the target", () => {
    const summary = summarizeSurplusForRun({
      ...ledger,
      runId: "run-1",
      brand: "Acme",
      flavor: "Pepperoni",
      originalTarget: 500,
    });
    expect(summary.carriedInCases).toBe(12);
    expect(summary.productionCases).toBe(488);
    expect(summary.selectedLotIds).toEqual(new Set(["old"]));
    expect(effectiveProductionCases(10, 25)).toBe(0);
    expect(summarizeSurplusForRun({
      ...ledger,
      runId: "no-pull",
      brand: "Acme",
      flavor: "Pepperoni",
      originalTarget: 500,
    }).productionCases).toBe(500);
  });
});