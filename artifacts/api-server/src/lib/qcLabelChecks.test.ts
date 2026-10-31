import { describe, expect, it } from "vitest";
import { evaluateQcLabelCheck, type QcLabelField } from "./qcLabelChecks";

const observed = {
  productName: "House Cheese",
  lotText: "LOT-42",
  dateText: "BEST BY 11/30/30",
};

const completeReference = {
  expected: { ...observed },
  requiredFields: ["productName", "lotText", "dateText"] as QcLabelField[],
};

describe("evaluateQcLabelCheck", () => {
  it("keeps all observations not evaluated when no approved applicable reference exists", () => {
    const result = evaluateQcLabelCheck({
      observed,
      reference: null,
      referenceUnavailableReason: "No approved reference is available for this context.",
    });
    expect(result.outcome).toBe("not-evaluated");
    expect(Object.values(result.fields).map((field) => field.state))
      .toEqual(["not-evaluated", "not-evaluated", "not-evaluated"]);
    expect(result.fields.productName.expected).toBeNull();
    expect(result.fields.productName.reason).toContain("No approved reference");
  });

  it("requires every required field for overall pass", () => {
    const result = evaluateQcLabelCheck({
      observed: { ...observed, dateText: "" },
      reference: completeReference,
    });
    expect(result.fields.productName.state).toBe("pass");
    expect(result.fields.dateText.state).toBe("not-evaluated");
    expect(result.outcome).toBe("not-evaluated");
  });

  it("fails overall when any evaluable field mismatches, even with another field unevaluated", () => {
    const result = evaluateQcLabelCheck({
      observed: { ...observed, productName: "Wrong Product", dateText: "" },
      reference: completeReference,
    });
    expect(result.fields.productName.state).toBe("fail");
    expect(result.fields.dateText.state).toBe("not-evaluated");
    expect(result.outcome).toBe("fail");
  });

  it("allows a missing optional field while requiring configured fields", () => {
    const result = evaluateQcLabelCheck({
      observed: { ...observed, dateText: "" },
      reference: {
        expected: { productName: observed.productName, lotText: observed.lotText },
        requiredFields: ["productName", "lotText"],
      },
    });
    expect(result.fields.dateText.state).toBe("not-evaluated");
    expect(result.outcome).toBe("pass");
  });

  it("compares text case-sensitively after NFC normalization and boundary trimming", () => {
    const normalized = evaluateQcLabelCheck({
      observed: { ...observed, productName: "  Cafe\u0301 " },
      reference: {
        expected: { productName: "Café" },
        requiredFields: ["productName"],
      },
    });
    expect(normalized.fields.productName.state).toBe("pass");

    const caseMismatch = evaluateQcLabelCheck({
      observed: { ...observed, productName: "house cheese" },
      reference: {
        expected: { productName: "House Cheese" },
        requiredFields: ["productName"],
      },
    });
    expect(caseMismatch.fields.productName.state).toBe("fail");
  });

  it("treats printed dates as exact text rather than parsing or normalizing a date format", () => {
    const result = evaluateQcLabelCheck({
      observed: { ...observed, dateText: "11/30/30" },
      reference: {
        expected: { dateText: "2030-11-30" },
        requiredFields: ["dateText"],
      },
    });
    expect(result.fields.dateText.state).toBe("fail");
    expect(result.outcome).toBe("fail");
  });
});
