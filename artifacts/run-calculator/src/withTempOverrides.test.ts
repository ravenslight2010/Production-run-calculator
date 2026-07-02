import { describe, it, expect } from "vitest";
import { withTempOverrides, DEFAULT_VALUES } from "./types";

const base = {
  ...DEFAULT_VALUES,
  freezerTime: 20,
  crustsPerCycle: 12,
  cycleSpeed: 8,
};

describe("withTempOverrides", () => {
  it("returns values unchanged when all temp fields are 0", () => {
    const out = withTempOverrides(base);
    expect(out.freezerTime).toBe(20);
    expect(out.crustsPerCycle).toBe(12);
    expect(out.cycleSpeed).toBe(8);
    expect(out).toBe(base); // same reference — no overlay applied
  });

  it("overrides only freezerTime when tempFreezerTime > 0", () => {
    const out = withTempOverrides({ ...base, tempFreezerTime: 35 });
    expect(out.freezerTime).toBe(35);
    expect(out.crustsPerCycle).toBe(12);
    expect(out.cycleSpeed).toBe(8);
  });

  it("overrides only crustsPerCycle when tempCrustsPerCycle > 0", () => {
    const out = withTempOverrides({ ...base, tempCrustsPerCycle: 10 });
    expect(out.crustsPerCycle).toBe(10);
    expect(out.freezerTime).toBe(20);
    expect(out.cycleSpeed).toBe(8);
  });

  it("overrides only cycleSpeed when tempCycleSpeed > 0", () => {
    const out = withTempOverrides({ ...base, tempCycleSpeed: 6.5 });
    expect(out.cycleSpeed).toBe(6.5);
    expect(out.freezerTime).toBe(20);
    expect(out.crustsPerCycle).toBe(12);
  });

  it("applies all three overrides together", () => {
    const out = withTempOverrides({
      ...base,
      tempFreezerTime: 30,
      tempCrustsPerCycle: 14,
      tempCycleSpeed: 9,
    });
    expect(out.freezerTime).toBe(30);
    expect(out.crustsPerCycle).toBe(14);
    expect(out.cycleSpeed).toBe(9);
  });

  it("never mutates the input object (Setup values stay permanent)", () => {
    const input = { ...base, tempFreezerTime: 30 };
    const out = withTempOverrides(input);
    expect(input.freezerTime).toBe(20);
    expect(out).not.toBe(input);
  });

  it("treats missing temp fields (old saved runs) as no override", () => {
    const legacy = { ...base } as Record<string, unknown>;
    delete legacy.tempFreezerTime;
    delete legacy.tempCrustsPerCycle;
    delete legacy.tempCycleSpeed;
    const out = withTempOverrides(legacy);
    expect(out.freezerTime).toBe(20);
    expect(out.crustsPerCycle).toBe(12);
    expect(out.cycleSpeed).toBe(8);
  });
});
