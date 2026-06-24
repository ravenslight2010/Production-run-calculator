import { describe, it, expect } from "vitest";
import {
  validateMixReconcileBody,
  toMixDiscrepancies,
  buildMixReconcilePrompt,
  sanitizeMixReconcileSummary,
  MAX_DISCREPANCIES,
} from "./aiMixReconcile";

function disc(over: Record<string, unknown> = {}) {
  return {
    source: "premix",
    type: "amount-mismatch",
    brand: "Tony's",
    flavor: "Pepperoni",
    mixName: "Cheese blend",
    message: "Cheese blend amount differs",
    ...over,
  };
}

describe("validateMixReconcileBody", () => {
  it("accepts a well-formed body", () => {
    const result = validateMixReconcileBody({ label: "Sheet A", discrepancies: [disc()] });
    expect(result.ok).toBe(true);
  });

  it("accepts an empty discrepancy list", () => {
    const result = validateMixReconcileBody({ discrepancies: [] });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object body with 400", () => {
    const result = validateMixReconcileBody(null);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a missing discrepancies array with 400", () => {
    const result = validateMixReconcileBody({ label: "x" });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an unknown discrepancy type with 400", () => {
    const result = validateMixReconcileBody({ discrepancies: [disc({ type: "nonsense" })] });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects too many discrepancies with 400", () => {
    const many = Array.from({ length: MAX_DISCREPANCIES + 1 }, () => disc());
    const result = validateMixReconcileBody({ discrepancies: many });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("toMixDiscrepancies", () => {
  it("maps wire discrepancies and drops absent optional fields", () => {
    const v = validateMixReconcileBody({
      discrepancies: [
        disc({ type: "missing-mix", message: "Needs a new mix", ingredient: undefined }),
        disc({
          type: "amount-mismatch",
          ingredient: "Mozzarella",
          sheetPerPizza: 0.5,
          mixPerPizza: 0.4,
        }),
      ],
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const mapped = toMixDiscrepancies(v.data);
    expect(mapped[0]).not.toHaveProperty("ingredient");
    expect(mapped[1]).toMatchObject({
      ingredient: "Mozzarella",
      sheetPerPizza: 0.5,
      mixPerPizza: 0.4,
    });
  });
});

describe("buildMixReconcilePrompt", () => {
  it("notes a clean match when there are no discrepancies", () => {
    const { user } = buildMixReconcilePrompt("Sheet A", []);
    expect(user).toContain("DISCREPANCIES: none");
  });

  it("lists discrepancies and asks for a summary JSON", () => {
    const { system, user } = buildMixReconcilePrompt("Sheet A", [
      {
        source: "premix",
        type: "missing-mix",
        brand: "Tony's",
        flavor: "Pepperoni",
        mixName: "Cheese blend",
        message: "Tony's Pepperoni needs a new mix",
      },
    ]);
    expect(system).toContain("ADVISORY ONLY");
    expect(user).toContain("needs a new mix");
    expect(user).toContain('"summary"');
  });
});

describe("sanitizeMixReconcileSummary", () => {
  it("extracts the summary field from JSON", () => {
    expect(sanitizeMixReconcileSummary('{"summary":"All good."}')).toBe("All good.");
  });

  it("falls back to raw content when not JSON", () => {
    expect(sanitizeMixReconcileSummary("plain text")).toBe("plain text");
  });

  it("returns empty for empty content", () => {
    expect(sanitizeMixReconcileSummary("")).toBe("");
  });
});
