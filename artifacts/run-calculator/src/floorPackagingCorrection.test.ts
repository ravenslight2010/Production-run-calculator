import { describe, expect, it } from "vitest";
import { incrementFloorCaseCount } from "./floorPackagingCorrection";

describe("incrementFloorCaseCount", () => {
  it("increments a correction below skid capacity", () => {
    expect(incrementFloorCaseCount(7, 12)).toBe(8);
  });

  it("never exceeds skid capacity", () => {
    expect(incrementFloorCaseCount(12, 12)).toBe(12);
    expect(incrementFloorCaseCount(14, 12)).toBe(12);
  });

  it("still increments when no skid capacity is configured", () => {
    expect(incrementFloorCaseCount(7, 0)).toBe(8);
  });
});