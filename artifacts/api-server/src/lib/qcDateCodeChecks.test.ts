import { describe, expect, it } from "vitest";
import { evaluateDateCodeCheck } from "./qcDateCodeChecks";

const observed = { productionCode: "P-001", bestByCode: "12/13/99", otherCode: "" };
const readability = { productionCode: "readable", bestByCode: "readable", otherCode: "missing" };
const referenceSnapshot = {
  state: "approved", approvalEventId: 1, expected: observed,
  requiredFields: ["productionCode", "bestByCode"],
};
describe("advisory date-code exact-text comparison", () => {
  it("retains observations as not evaluated without approved applicable evidence", () => {
    for (const state of [null, "draft", "withdrawn", "stale", "inapplicable", "ambiguous"]) {
      const result = evaluateDateCodeCheck({ observed, readability,
        referenceSnapshot: state ? { ...referenceSnapshot, state } : null });
      expect(result.outcome).toBe("not-evaluated");
      expect(result.observed).toEqual(observed);
      expect(Object.values(result.fieldResults as object).every((field) => field.expected === null)).toBe(true);
    }
  });
  it("compares arbitrary code/date-like text literally without certifying a calendar or locale", () => {
    for (const text of ["2026-99-99", "02/03/04", "LOT-A", "Å漢字", "29-02-2100"]) {
      expect(evaluateDateCodeCheck({
        observed: { ...observed, productionCode: text }, readability,
        referenceSnapshot: { ...referenceSnapshot, expected: { ...observed, productionCode: text } },
      }).outcome).toBe("pass");
    }
    expect(evaluateDateCodeCheck({ observed: { ...observed, productionCode: " A\u030A " }, readability,
      referenceSnapshot: { ...referenceSnapshot, expected: { ...observed, productionCode: "Å" } } }).outcome).toBe("pass");
  });
  it("does not normalize punctuation, case or implied date formats", () => {
    for (const text of ["p-001", "P001", "P–001"]) {
      expect(evaluateDateCodeCheck({ observed: { ...observed, productionCode: text },
        readability, referenceSnapshot }).outcome).toBe("fail");
    }
  });
  it("leaves missing, unreadable and ambiguous required codes not evaluated", () => {
    for (const state of ["missing", "unreadable", "ambiguous"]) {
      const result = evaluateDateCodeCheck({ observed, readability: { ...readability, productionCode: state }, referenceSnapshot });
      expect(result.outcome).toBe("not-evaluated");
    }
    expect(evaluateDateCodeCheck({ observed: { ...observed, productionCode: "" }, readability, referenceSnapshot }).outcome).toBe("not-evaluated");
    expect(evaluateDateCodeCheck({ observed, readability,
      referenceSnapshot: { ...referenceSnapshot, expected: { productionCode: "P-001" } } }).outcome).toBe("not-evaluated");
  });
  it("never hides an evaluated mismatch behind an unevaluated required field", () => {
    expect(evaluateDateCodeCheck({ observed: { ...observed, bestByCode: "DIFFERENT" },
      readability: { ...readability, productionCode: "unreadable" }, referenceSnapshot }).outcome).toBe("fail");
  });
});
