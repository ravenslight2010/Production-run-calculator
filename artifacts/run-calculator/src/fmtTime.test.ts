import { describe, expect, it } from "vitest";
import { fmtTime } from "./utils";

describe("fmtTime rounds before decomposing seconds", () => {
  it.each([
    [0, "0s"], [59.4, "59s"], [59.5, "1m 0s"], [59.6, "1m 0s"],
    [60, "1m 0s"], [119.6, "2m 0s"], [3599.4, "59m 59s"],
    [3599.6, "1h 0m 0s"], [3661, "1h 1m 1s"], [7199.6, "2h 0m 0s"],
  ])("formats %s as %s", (seconds, expected) => {
    expect(fmtTime(seconds)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity, -1, -0.1])("rejects invalid seconds %s", (seconds) => {
    expect(fmtTime(seconds)).toBe("—");
  });
});