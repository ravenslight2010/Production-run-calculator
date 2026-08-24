import { describe, expect, it } from "vitest";
import { sanitizeCountDraft } from "./countObservation";

const field = (value: unknown, confidence = 1, evidence = [0]) => ({
  value, confidence, evidence,
});

describe("photo inventory count draft", () => {
  it("keeps structured evidence and flags uncertain visual counts", () => {
    const draft = sanitizeCountDraft({
      productName: field("Mozzarella"),
      brand: field("Acme"),
      variant: field("Whole"),
      barcode: field("123"),
      packageSize: field("5 lb"),
      printedWeight: field(null, 0),
      unitType: field("cases"),
      casePack: field(4),
      quantity: field(8, 0.4, [1]),
      context: field("pallet", 0.8, [1]),
    }, new Set(["ingredient:Mozzarella:cases"]));

    expect(draft?.matchedKey).toBeNull();
    expect(draft?.quantity).toMatchObject({ value: 8, confidence: 0.4, evidence: [1] });
    expect(draft?.reviewFlags).toContain("Quantity estimate needs review");
    expect(draft?.reviewFlags).toContain("Printed weight not visible");
  });

  it("rejects hallucinated candidate links and malformed top-level data", () => {
    expect(sanitizeCountDraft({
      productName: field("New item"), brand: field(null), variant: field(null),
      barcode: field(null), packageSize: field(null), printedWeight: field(null),
      unitType: field("bags"), casePack: field(null), quantity: field(2),
      context: field("shelf"), matchedKey: "not-known",
    }, new Set(["known"]))).toMatchObject({ matchedKey: null });
    expect(sanitizeCountDraft({ quantity: 4 }, new Set())).toBeNull();
  });
});