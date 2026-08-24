import { describe, it, expect, vi } from "vitest";
import {
  sortLotsForConsumption,
  planDrawDown,
  applyRunConsumption,
  type LotForConsumption,
  type ConsumeDeps,
} from "./inventoryLogic";

// A lot shaped like the rows drawDown reads, used as a baseline tests tweak.
function lot(overrides: Partial<LotForConsumption> = {}): LotForConsumption {
  return {
    id: 1,
    qtyRemaining: 10,
    receivedDate: null,
    expirationDate: null,
    ...overrides,
  };
}

describe("sortLotsForConsumption", () => {
  it("orders by earliest expiration first, nulls last (FEFO)", () => {
    const lots = [
      lot({ id: 1, expirationDate: null }),
      lot({ id: 2, expirationDate: "2026-03-01" }),
      lot({ id: 3, expirationDate: "2026-01-01" }),
    ];
    expect(sortLotsForConsumption(lots).map((l) => l.id)).toEqual([3, 2, 1]);
  });

  it("breaks expiration ties by earliest received date, nulls last", () => {
    const lots = [
      lot({ id: 1, expirationDate: "2026-05-01", receivedDate: null }),
      lot({ id: 2, expirationDate: "2026-05-01", receivedDate: "2026-02-01" }),
      lot({ id: 3, expirationDate: "2026-05-01", receivedDate: "2026-01-01" }),
    ];
    expect(sortLotsForConsumption(lots).map((l) => l.id)).toEqual([3, 2, 1]);
  });

  it("breaks remaining ties by insertion order (id)", () => {
    const lots = [
      lot({ id: 30 }),
      lot({ id: 10 }),
      lot({ id: 20 }),
    ];
    expect(sortLotsForConsumption(lots).map((l) => l.id)).toEqual([10, 20, 30]);
  });

  it("does not mutate the input array", () => {
    const lots = [lot({ id: 2 }), lot({ id: 1 })];
    const snapshot = lots.map((l) => l.id);
    sortLotsForConsumption(lots);
    expect(lots.map((l) => l.id)).toEqual(snapshot);
  });
});

describe("planDrawDown", () => {
  it("consumes nothing for a non-positive quantity", () => {
    expect(planDrawDown([lot({ qtyRemaining: 5 })], 0)).toEqual({
      consumed: 0,
      updates: [],
    });
    expect(planDrawDown([lot({ qtyRemaining: 5 })], -3)).toEqual({
      consumed: 0,
      updates: [],
    });
  });

  it("draws from a single lot and reports the new remaining quantity", () => {
    const result = planDrawDown([lot({ id: 1, qtyRemaining: 10 })], 4);
    expect(result.consumed).toBe(4);
    expect(result.updates).toEqual([{ id: 1, qtyRemaining: 6 }]);
  });

  it("draws across lots in FEFO order, stopping once satisfied", () => {
    const lots = [
      lot({ id: 1, qtyRemaining: 5, expirationDate: "2026-02-01" }),
      lot({ id: 2, qtyRemaining: 5, expirationDate: "2026-01-01" }),
      lot({ id: 3, qtyRemaining: 5, expirationDate: "2026-03-01" }),
    ];
    const result = planDrawDown(lots, 7);
    expect(result.consumed).toBe(7);
    // Earliest expiration (id 2) is emptied first, then the next (id 1) covers
    // the remainder; the latest lot (id 3) is untouched.
    expect(result.updates).toEqual([
      { id: 2, qtyRemaining: 0 },
      { id: 1, qtyRemaining: 3 },
    ]);
  });

  it("never goes negative and caps consumed at the available stock", () => {
    const lots = [
      lot({ id: 1, qtyRemaining: 3 }),
      lot({ id: 2, qtyRemaining: 2 }),
    ];
    const result = planDrawDown(lots, 100);
    expect(result.consumed).toBe(5); // only 5 were available
    expect(result.updates).toEqual([
      { id: 1, qtyRemaining: 0 },
      { id: 2, qtyRemaining: 0 },
    ]);
    // No update leaves a lot below zero.
    expect(result.updates.every((u) => u.qtyRemaining >= 0)).toBe(true);
  });

  it("consumes nothing when there are no lots", () => {
    expect(planDrawDown([], 5)).toEqual({ consumed: 0, updates: [] });
  });
});

// In-memory stand-in for the transaction-scoped deps the route supplies. It
// tracks claimed runs (so re-finalizing the same run is rejected), available
// stock per item, and the consume ledger entries written.
function makeDeps(
  items: Record<string, number | undefined>,
  stock: Record<number, number> = {},
) {
  const claimedRuns = new Set<string>();
  const ledger: Array<{ itemId: number; consumed: number }> = [];
  const remaining = { ...stock };
  const deps: ConsumeDeps = {
    claimRun: vi.fn(async (runId: string) => {
      if (claimedRuns.has(runId)) return false;
      claimedRuns.add(runId);
      return true;
    }),
    findItemByKey: vi.fn(async (key: string) => {
      const id = items[key];
      return id == null ? null : { id };
    }),
    drawDown: vi.fn(async (itemId: number, qty: number) => {
      const avail = remaining[itemId] ?? 0;
      const consumed = Math.min(avail, qty);
      remaining[itemId] = avail - consumed;
      return consumed;
    }),
    recordConsumption: vi.fn(async (itemId: number, consumed: number) => {
      ledger.push({ itemId, consumed });
    }),
  };
  return { deps, ledger, remaining, claimedRuns };
}

describe("applyRunConsumption", () => {
  it("uses a confirmed conversion when drawing inventory units", async () => {
    const { deps, remaining } = makeDeps({ chicken: 1 }, { 1: 3 });
    deps.findItemByKey = vi.fn(async () => ({ id: 1, conversionFactor: 20 }));
    await applyRunConsumption(deps, "run-conversion", [{ itemKey: "chicken", qty: 40 }]);
    expect(remaining[1]).toBe(1);
  });

  it("deducts each matching line once and records a ledger entry per item drawn", async () => {
    const { deps, ledger, remaining } = makeDeps(
      { mozz: 1, boxes: 2 },
      { 1: 10, 2: 10 },
    );
    const result = await applyRunConsumption(deps, "run-A", [
      { itemKey: "mozz", qty: 3 },
      { itemKey: "boxes", qty: 4 },
    ]);
    expect(result).toEqual({ applied: true, consumed: 2 });
    expect(ledger).toEqual([
      { itemId: 1, consumed: 3 },
      { itemId: 2, consumed: 4 },
    ]);
    expect(remaining).toEqual({ 1: 7, 2: 6 });
  });

  it("finalizing the same run twice only deducts once (idempotency guard)", async () => {
    const { deps, ledger, remaining } = makeDeps({ mozz: 1 }, { 1: 10 });
    const lines = [{ itemKey: "mozz", qty: 3 }];

    const first = await applyRunConsumption(deps, "run-dupe", lines);
    expect(first).toEqual({ applied: true, consumed: 1 });
    expect(remaining[1]).toBe(7);

    const second = await applyRunConsumption(deps, "run-dupe", lines);
    expect(second).toEqual({ applied: false, consumed: 0 });
    // Stock and ledger are unchanged by the second finalization.
    expect(remaining[1]).toBe(7);
    expect(ledger).toEqual([{ itemId: 1, consumed: 3 }]);
    expect(deps.drawDown).toHaveBeenCalledTimes(1);
  });

  it("allows only one of concurrent retries to claim and deduct a run", async () => {
    const { deps, ledger, remaining } = makeDeps({ mozz: 1 }, { 1: 10 });
    const lines = [{ itemKey: "mozz", qty: 3 }];

    const results = await Promise.all([
      applyRunConsumption(deps, "run-race", lines),
      applyRunConsumption(deps, "run-race", lines),
    ]);

    expect(results).toEqual([
      { applied: true, consumed: 1 },
      { applied: false, consumed: 0 },
    ]);
    expect(remaining[1]).toBe(7);
    expect(ledger).toEqual([{ itemId: 1, consumed: 3 }]);
    expect(deps.drawDown).toHaveBeenCalledOnce();
    expect(deps.recordConsumption).toHaveBeenCalledOnce();
  });

  it("claims the run marker even when nothing is consumed (zero-consume run)", async () => {
    // No matching inventory items, so every line is a no-op draw.
    const { deps, ledger, claimedRuns } = makeDeps({});
    const result = await applyRunConsumption(deps, "run-empty", [
      { itemKey: "unknown", qty: 5 },
    ]);
    expect(result).toEqual({ applied: true, consumed: 0 });
    expect(ledger).toEqual([]);
    // The marker is still written, so a later re-consume of this run is blocked.
    expect(claimedRuns.has("run-empty")).toBe(true);
    expect(deps.drawDown).not.toHaveBeenCalled();

    const again = await applyRunConsumption(deps, "run-empty", [
      { itemKey: "unknown", qty: 5 },
    ]);
    expect(again).toEqual({ applied: false, consumed: 0 });
  });

  it("skips non-positive lines and materials without an inventory item", async () => {
    const { deps, ledger, remaining } = makeDeps({ mozz: 1 }, { 1: 10 });
    const result = await applyRunConsumption(deps, "run-mixed", [
      { itemKey: "mozz", qty: 0 }, // non-positive → skipped before lookup
      { itemKey: "ghost", qty: 5 }, // no matching item → skipped
      { itemKey: "mozz", qty: 2 }, // the only real deduction
    ]);
    expect(result).toEqual({ applied: true, consumed: 1 });
    expect(ledger).toEqual([{ itemId: 1, consumed: 2 }]);
    expect(remaining[1]).toBe(8);
    expect(deps.findItemByKey).toHaveBeenCalledTimes(2); // qty=0 line never looked up
  });

  it("does not record a ledger entry when a matched item has no stock to draw", async () => {
    const { deps, ledger } = makeDeps({ mozz: 1 }, { 1: 0 });
    const result = await applyRunConsumption(deps, "run-nostock", [
      { itemKey: "mozz", qty: 5 },
    ]);
    expect(result).toEqual({ applied: true, consumed: 0 });
    expect(ledger).toEqual([]);
    expect(deps.drawDown).toHaveBeenCalledTimes(1);
  });
});
