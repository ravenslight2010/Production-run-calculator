import { describe, it, expect } from "vitest";
import { fmtElapsed } from "./utils";

describe("fmtElapsed", () => {
  it("returns '0m' for zero milliseconds", () => {
    expect(fmtElapsed(0)).toBe("0m");
  });

  it("returns '0m' for negative input (clock skew / future startedAt)", () => {
    expect(fmtElapsed(-1)).toBe("0m");
    expect(fmtElapsed(-60_000)).toBe("0m");
    expect(fmtElapsed(-Number.MAX_SAFE_INTEGER)).toBe("0m");
  });

  it("formats sub-hour durations as minutes", () => {
    expect(fmtElapsed(90_000)).toBe("1m");
    expect(fmtElapsed(30 * 60 * 1000)).toBe("30m");
    expect(fmtElapsed(59 * 60 * 1000 + 59_000)).toBe("59m");
  });

  it("formats hour-plus durations as 'Xh Ym'", () => {
    expect(fmtElapsed(60 * 60 * 1000)).toBe("1h 0m");
    expect(fmtElapsed(90 * 60 * 1000)).toBe("1h 30m");
    expect(fmtElapsed(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe("2h 15m");
  });
});
