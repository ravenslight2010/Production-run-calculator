import { describe, expect, it } from "vitest";
import { getFreezerSurplusRemainingMs, parseFreezerSurplusLedger } from "./freezerSurplus";

describe("getFreezerSurplusRemainingMs", () => {
  const endedAt = Date.UTC(2026, 8, 1, 12, 0, 0);

  it("keeps the prompt eligible while Freeze tunnel time remains", () => {
    expect(
      getFreezerSurplusRemainingMs({
        endedAt,
        freezerTimeMin: 20,
        nowMs: endedAt + 19 * 60000 + 59999,
      }),
    ).toBe(1);
  });

  it("hides the prompt at the exact freezer expiry boundary", () => {
    expect(
      getFreezerSurplusRemainingMs({
        endedAt,
        freezerTimeMin: 20,
        nowMs: endedAt + 20 * 60000,
      }),
    ).toBe(0);
  });

  it("hides when no freezer duration is configured", () => {
    expect(
      getFreezerSurplusRemainingMs({
        endedAt,
        freezerTimeMin: 0,
        nowMs: endedAt,
      }),
    ).toBe(0);
  });

  it("does not mutate warehouse freezer lots or allocations when tunnel time changes", () => {
    const rawLedger = {
      lots: [{
        id: "lot-1",
        brand: "Test Brand",
        flavor: "Test Flavor",
        productionDate: "2026-09-01",
        totalCases: 12,
        remainingCases: 12,
      }],
      allocations: [{
        id: "allocation-1",
        lotId: "lot-1",
        runId: "run-1",
        runDate: "2026-09-01",
        brand: "Test Brand",
        flavor: "Test Flavor",
        cases: 4,
      }],
    };
    const ledger = parseFreezerSurplusLedger(rawLedger);
    const before = structuredClone(ledger);

    getFreezerSurplusRemainingMs({ endedAt, freezerTimeMin: 20, nowMs: endedAt });
    getFreezerSurplusRemainingMs({ endedAt, freezerTimeMin: 40, nowMs: endedAt });

    expect(ledger).toEqual(before);
    expect(ledger.lots[0].remainingCases).toBe(12);
    expect(ledger.allocations[0].cases).toBe(4);
  });
});