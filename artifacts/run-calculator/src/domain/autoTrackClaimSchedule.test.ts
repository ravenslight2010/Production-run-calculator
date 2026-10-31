// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getStockClaimScheduleAfterRebase } from "./autoTrackClaimSchedule";

describe("rebased automatic stock claim schedules", () => {
  it.each([
    ["app1-stock", "app1StockAnchorNetSec"],
    ["sauce-stock", "sauceStockAnchorNetSec"],
  ])("moves %s timing with its rebased anchor", (channel, anchorField) => {
    const schedule = getStockClaimScheduleAfterRebase({
      channel,
      dueAt: 0.6,
      nextDueAt: 0.83,
      mutations: [{ field: anchorField, to: 1.05 }],
    });

    expect(schedule.dueAt).toBe(1.05);
    expect(schedule.nextDueAt).toBeCloseTo(1.28, 10);
  });

  it("leaves non-stock claim timing unchanged", () => {
    expect(getStockClaimScheduleAfterRebase({
      channel: "app1-batch",
      dueAt: 0.6,
      nextDueAt: 0.83,
      mutations: [{ field: "app1BatchAnchorNetSec", to: 1.05 }],
    })).toEqual({ dueAt: 0.6, nextDueAt: 0.83 });
  });

  it("fails explicitly when a stock claim lacks its anchor mutation", () => {
    expect(() => getStockClaimScheduleAfterRebase({
      channel: "app1-stock",
      dueAt: 0.6,
      nextDueAt: 0.83,
      mutations: [],
    })).toThrow("Missing app1StockAnchorNetSec");
  });
});
