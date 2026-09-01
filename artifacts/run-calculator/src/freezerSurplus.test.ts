import { describe, expect, it } from "vitest";
import { getFreezerSurplusRemainingMs } from "./freezerSurplus";

describe("getFreezerSurplusRemainingMs", () => {
  const endedAt = Date.UTC(2026, 8, 1, 12, 0, 0);

  it("keeps the prompt eligible while freezer time remains", () => {
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
});