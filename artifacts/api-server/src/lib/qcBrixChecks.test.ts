import { describe, expect, it } from "vitest";
import { evaluateQcBrixCheck } from "./qcBrixChecks";

describe("evaluateQcBrixCheck", () => {
  it("uses inclusive tolerance boundaries and fails immediately outside them", () => {
    expect(evaluateQcBrixCheck({ actualBrix: 12, targetBrix: 12.5, toleranceBrix: 0.5 }))
      .toBe("pass");
    expect(evaluateQcBrixCheck({ actualBrix: 13, targetBrix: 12.5, toleranceBrix: 0.5 }))
      .toBe("pass");
    expect(evaluateQcBrixCheck({ actualBrix: 7.3, targetBrix: 7.5, toleranceBrix: 0.2 }))
      .toBe("pass");
    expect(evaluateQcBrixCheck({ actualBrix: 7.299999999, targetBrix: 7.5, toleranceBrix: 0.2 }))
      .toBe("fail");
    expect(evaluateQcBrixCheck({ actualBrix: 11.999, targetBrix: 12.5, toleranceBrix: 0.5 }))
      .toBe("fail");
  });

  it("supports a zero target, zero reading, and an explicit zero tolerance", () => {
    expect(evaluateQcBrixCheck({ actualBrix: 0, targetBrix: 0, toleranceBrix: 0 }))
      .toBe("pass");
    expect(evaluateQcBrixCheck({ actualBrix: 0.001, targetBrix: 0, toleranceBrix: 0 }))
      .toBe("fail");
  });

  it("does not infer a target or tolerance and rejects values outside the canonical range", () => {
    for (const input of [
      { actualBrix: 10, targetBrix: null, toleranceBrix: 1 },
      { actualBrix: 10, targetBrix: 10, toleranceBrix: null },
      { actualBrix: -0.001, targetBrix: 10, toleranceBrix: 1 },
      { actualBrix: 100.001, targetBrix: 10, toleranceBrix: 1 },
      { actualBrix: Number.NaN, targetBrix: 10, toleranceBrix: 1 },
      { actualBrix: Number.POSITIVE_INFINITY, targetBrix: 10, toleranceBrix: 1 },
      { actualBrix: 10, targetBrix: -0.001, toleranceBrix: 1 },
      { actualBrix: 10, targetBrix: 10, toleranceBrix: Number.NaN },
    ]) {
      expect(evaluateQcBrixCheck(input)).toBe("not-evaluated");
    }
  });
});
