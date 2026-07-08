import { describe, it, expect } from "vitest";
import {
  daysUntilExpiry,
  flagExpiringItems,
  validateWasteInsightBody,
  buildWastePrompt,
  sanitizeWasteSuggestion,
  MAX_PLANNED_ITEMS,
  MAX_SUGGESTION_CHARS,
  type FlaggableItem,
} from "./wasteInsight";

const NOW = new Date("2026-06-21T12:00:00");

function item(overrides: Partial<FlaggableItem> = {}): FlaggableItem {
  return {
    key: "mozz",
    name: "Mozzarella",
    category: "ingredient",
    unit: "cases",
    lots: [],
    ...overrides,
  };
}

describe("daysUntilExpiry", () => {
  it("returns null for missing/invalid dates", () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull();
    expect(daysUntilExpiry("not-a-date", NOW)).toBeNull();
  });

  it("counts whole calendar days, negative once expired", () => {
    expect(daysUntilExpiry("2026-06-21", NOW)).toBe(0);
    expect(daysUntilExpiry("2026-06-24", NOW)).toBe(3);
    expect(daysUntilExpiry("2026-06-18", NOW)).toBe(-3);
  });
});

describe("flagExpiringItems", () => {
  it("flags items expiring within the window and ignores far-out ones", () => {
    const out = flagExpiringItems(
      [
        item({ key: "soon", lots: [{ qtyRemaining: 4, expirationDate: "2026-06-23" }] }),
        item({ key: "far", lots: [{ qtyRemaining: 4, expirationDate: "2026-09-01" }] }),
      ],
      5,
      NOW,
    );
    expect(out.map((f) => f.key)).toEqual(["soon"]);
    expect(out[0].status).toBe("soon");
    expect(out[0].qtyAtRisk).toBe(4);
  });

  it("marks an item expired when any at-risk lot is past date", () => {
    const out = flagExpiringItems(
      [item({ lots: [{ qtyRemaining: 2, expirationDate: "2026-06-19" }] })],
      5,
      NOW,
    );
    expect(out[0].status).toBe("expired");
    expect(out[0].daysUntilExpiry).toBe(-2);
  });

  it("ignores lots with no remaining quantity", () => {
    const out = flagExpiringItems(
      [item({ lots: [{ qtyRemaining: 0, expirationDate: "2026-06-21" }] })],
      5,
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("aggregates at-risk quantity across lots and reports the earliest expiry", () => {
    const out = flagExpiringItems(
      [
        item({
          lots: [
            { qtyRemaining: 3, expirationDate: "2026-06-24" },
            { qtyRemaining: 2, expirationDate: "2026-06-22" },
            { qtyRemaining: 9, expirationDate: "2026-12-01" },
          ],
        }),
      ],
      5,
      NOW,
    );
    expect(out[0].qtyAtRisk).toBe(5);
    expect(out[0].earliestExpiration).toBe("2026-06-22");
    expect(out[0].daysUntilExpiry).toBe(1);
  });

  it("sorts most-urgent first", () => {
    const out = flagExpiringItems(
      [
        item({ key: "a", lots: [{ qtyRemaining: 1, expirationDate: "2026-06-24" }] }),
        item({ key: "b", lots: [{ qtyRemaining: 1, expirationDate: "2026-06-18" }] }),
        item({ key: "c", lots: [{ qtyRemaining: 1, expirationDate: "2026-06-21" }] }),
      ],
      5,
      NOW,
    );
    expect(out.map((f) => f.key)).toEqual(["b", "c", "a"]);
  });
});

describe("validateWasteInsightBody", () => {
  it("accepts an empty/absent body", () => {
    expect(validateWasteInsightBody(undefined).ok).toBe(true);
    expect(validateWasteInsightBody({}).ok).toBe(true);
  });

  it("accepts a body with plannedItems", () => {
    const result = validateWasteInsightBody({
      plannedItems: [{ key: "mozz", category: "ingredient", name: "Mozzarella", unit: "cases" }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects too many plannedItems with 400", () => {
    const plannedItems = Array.from({ length: MAX_PLANNED_ITEMS + 1 }, (_, i) => ({
      key: `k${i}`,
      category: "ingredient",
      name: `n${i}`,
      unit: "cases",
    }));
    const result = validateWasteInsightBody({ plannedItems });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a plannedItem with an oversized name/key/unit/category with 400", () => {
    const base = { key: "mozz", category: "ingredient", name: "Mozzarella", unit: "cases" };
    for (const field of ["key", "category", "name", "unit"] as const) {
      const result = validateWasteInsightBody({
        plannedItems: [{ ...base, [field]: "x".repeat(5000) }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });
});

describe("buildWastePrompt", () => {
  it("lists flagged stock with expiry framing and asks for JSON", () => {
    const { system, user } = buildWastePrompt([
      {
        key: "mozz",
        name: "Mozzarella",
        category: "ingredient",
        unit: "cases",
        status: "soon",
        qtyAtRisk: 4,
        earliestExpiration: "2026-06-23",
        daysUntilExpiry: 2,
      },
    ]);
    expect(user).toContain("Mozzarella");
    expect(user).toContain("expires in 2d");
    expect(user).toContain('"suggestion"');
    expect(system.toLowerCase()).toContain("advisory");
  });

  it("includes planned items when provided", () => {
    const { user } = buildWastePrompt(
      [],
      [{ key: "p", name: "16in Pepperoni", unit: "cases", category: "ingredient" }],
    );
    expect(user).toContain("16in Pepperoni");
  });

  it("shows expired framing for past-date items", () => {
    const { user } = buildWastePrompt([
      {
        key: "x",
        name: "Old Sauce",
        category: "ingredient",
        unit: "barrels",
        status: "expired",
        qtyAtRisk: 1,
        earliestExpiration: "2026-06-18",
        daysUntilExpiry: -3,
      },
    ]);
    expect(user).toContain("expired 3d ago");
  });
});

describe("sanitizeWasteSuggestion", () => {
  it("returns empty for blank content", () => {
    expect(sanitizeWasteSuggestion("")).toEqual({ suggestion: "" });
  });

  it("extracts suggestion and note from valid JSON", () => {
    const out = sanitizeWasteSuggestion(
      JSON.stringify({ suggestion: "Run pepperoni first", note: "uses soon-to-expire cheese" }),
    );
    expect(out.suggestion).toBe("Run pepperoni first");
    expect(out.note).toBe("uses soon-to-expire cheese");
  });

  it("falls back to raw text when JSON is malformed", () => {
    const out = sanitizeWasteSuggestion("just a plain sentence");
    expect(out.suggestion).toBe("just a plain sentence");
  });

  it("clamps an overlong suggestion", () => {
    const out = sanitizeWasteSuggestion(
      JSON.stringify({ suggestion: "z".repeat(MAX_SUGGESTION_CHARS + 100) }),
    );
    expect(out.suggestion.length).toBeLessThanOrEqual(MAX_SUGGESTION_CHARS);
  });

  it("omits note when empty", () => {
    const out = sanitizeWasteSuggestion(JSON.stringify({ suggestion: "do x", note: "" }));
    expect(out.note).toBeUndefined();
  });
});
