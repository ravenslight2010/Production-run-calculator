import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseMixSurplusLedger,
  fetchMixSurplusLedger,
  recordMixSurplus,
  replaceMixSurplusAllocations,
  voidMixSurplusLot,
} from "./mixSurplusClient";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseMixSurplusLedger", () => {
  it("returns an empty ledger for null / non-object input", () => {
    expect(parseMixSurplusLedger(null)).toEqual({ lots: [], allocations: [], balances: [] });
    expect(parseMixSurplusLedger("nope")).toEqual({ lots: [], allocations: [], balances: [] });
  });

  it("keeps valid lots and skips malformed ones", () => {
    const ledger = parseMixSurplusLedger({
      lots: [
        {
          id: "l1",
          mixId: "m1",
          name: "Bobo's Veggie Mix",
          brand: "Bobo's",
          flavor: "Veggie",
          isPrep: false,
          productionDate: "2026-09-14",
          location: "freezer",
          amountMade: 60,
          amountUsed: 0,
          amountRemaining: 10,
        },
        { id: "bad", mixId: "m2" }, // no date/amounts
      ],
      allocations: [],
      balances: [],
    });
    expect(ledger.lots).toHaveLength(1);
    expect(ledger.lots[0]).toMatchObject({
      id: "l1",
      mixId: "m1",
      name: "Bobo's Veggie Mix",
      productionDate: "2026-09-14",
      amountRemaining: 10,
    });
  });

  it("keeps valid allocations and skips malformed ones", () => {
    const ledger = parseMixSurplusLedger({
      lots: [],
      allocations: [
        {
          id: "a1",
          lotId: "l1",
          mixId: "m1",
          runId: "",
          runDate: "2026-09-15",
          brand: "Bobo's",
          flavor: "Veggie",
          isPrep: false,
          amount: 8,
        },
        { id: "bad", lotId: "l1", runDate: "nope", amount: -1 },
      ],
      balances: [],
    });
    expect(ledger.allocations).toHaveLength(1);
    expect(ledger.allocations[0].amount).toBe(8);
  });

  it("trusts server balances and derives them from lots when absent", () => {
    const served = parseMixSurplusLedger({
      lots: [
        {
          id: "l1",
          mixId: "m1",
          name: "Mix A",
          productionDate: "2026-09-14",
          location: "freezer",
          amountMade: 60,
          amountUsed: 0,
          amountRemaining: 10,
        },
      ],
      allocations: [],
      balances: [{ mixId: "m1", name: "Mix A", lbs: 10, productionDates: ["2026-09-14"] }],
    });
    expect(served.balances).toEqual([
      { mixId: "m1", name: "Mix A", lbs: 10, productionDates: ["2026-09-14"] },
    ]);

    const derived = parseMixSurplusLedger({
      lots: [
        {
          id: "l1",
          mixId: "m1",
          name: "Mix A",
          productionDate: "2026-09-14",
          location: "freezer",
          amountMade: 60,
          amountUsed: 0,
          amountRemaining: 10,
        },
      ],
      allocations: [],
    });
    expect(derived.balances).toEqual([
      { mixId: "m1", name: "Mix A", lbs: 10, productionDates: ["2026-09-14"] },
    ]);
  });
});

describe("mix surplus API wrappers", () => {
  it("GETs the ledger and parses it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ lots: [], allocations: [], balances: [] })));
    const ledger = await fetchMixSurplusLedger();
    expect(ledger.lots).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/mix-surplus",
      expect.objectContaining({ headers: expect.objectContaining({ "x-client-id": expect.any(String) }) }),
    );
  });

  it("POSTs a record with the right body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ lots: [], allocations: [], balances: [] })));
    await recordMixSurplus({ mixId: "m1", productionDate: "2026-09-14", amountMade: 60 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/mix-surplus",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mixId: "m1", productionDate: "2026-09-14", amountMade: 60 }),
      }),
    );
  });

  it("PUTs allocations for a make-day", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ lots: [], allocations: [], balances: [] })));
    await replaceMixSurplusAllocations("2026-09-15", [
      { lotId: "l1", amount: 8 },
      { lotId: "l2", amount: 0 },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/mix-surplus/allocations/2026-09-15",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ runDate: "2026-09-15", allocations: [{ lotId: "l1", amount: 8 }, { lotId: "l2", amount: 0 }] }),
      }),
    );
  });

  it("DELETEs (voids) a lot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ lots: [], allocations: [], balances: [] })));
    await voidMixSurplusLot("lot-1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/mix-surplus/lots/lot-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws with the server error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Unknown mix" }, false, 400)));
    await expect(recordMixSurplus({ mixId: "nope", productionDate: "2026-09-14", amountMade: 1 })).rejects.toThrow(
      "Unknown mix",
    );
  });
});
