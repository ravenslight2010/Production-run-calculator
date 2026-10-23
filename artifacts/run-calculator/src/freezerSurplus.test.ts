import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmFreezerSurplusOutcome,
  fetchFreezerSurplusConfirmations,
  getFreezerSurplusRemainingMs,
  parseFreezerSurplusLedger,
} from "./freezerSurplus";

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

describe("run-bound freezer surplus confirmations", () => {
  afterEach(() => vi.unstubAllGlobals());

  const savedNone = {
    runId: "run-1",
    runDate: "2026-09-01",
    brand: "Northstar",
    flavor: "Pepperoni",
    cases: 0,
    productionDate: null,
    lotId: null,
    createdAt: "2026-09-01T12:00:00.000Z",
  };

  it("accepts a valid zero outcome and omits lot-only date data", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ confirmation: savedNone }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(confirmFreezerSurplusOutcome({ runId: "run-1", cases: 0 })).resolves.toEqual(savedNone);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
      runId: "run-1",
      cases: 0,
    });
  });

  it("rejects non-OK and malformed acknowledgments instead of adopting them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Save rejected. Retry after checking the run." }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ).mockResolvedValueOnce(
        new Response(JSON.stringify({ confirmation: { ...savedNone, runId: "other-run" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(confirmFreezerSurplusOutcome({ runId: "run-1", cases: 0 }))
      .rejects.toThrow("Save rejected. Retry after checking the run.");
    await expect(confirmFreezerSurplusOutcome({ runId: "run-1", cases: 0 }))
      .rejects.toThrow(/did not match this form/i);
  });

  it("loads and validates persisted confirmation receipts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ confirmations: [savedNone] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(fetchFreezerSurplusConfirmations()).resolves.toEqual([savedNone]);
  });
});