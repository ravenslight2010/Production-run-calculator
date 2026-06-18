import { describe, it, expect } from "vitest";
import {
  buildFillMissingPrompt,
  sanitizeFillMissingSuggestions,
  validateFillMissingBody,
  MAX_FILL_FIELDS,
  MAX_VALUE_CHARS,
  MAX_RATIONALE_CHARS,
  type RequestedField,
  type FillMissingInput,
} from "./aiFillMissing";

const REQUESTED: RequestedField[] = [
  { key: "casesNeeded", kind: "number" },
  { key: "app1OzPerPizza", kind: "number" },
  { key: "shipper", kind: "select", options: ["costco", "12in", "11in"] },
  { key: "app1Type", kind: "text" },
];

describe("validateFillMissingBody", () => {
  const base = {
    brand: "Lucia's",
    flavor: "PEPPERONI",
    fields: [{ key: "shipper", label: "Shipper", category: "packaging", kind: "select", options: ["costco"] }],
  };

  it("accepts a valid body", () => {
    const r = validateFillMissingBody(base);
    expect(r.ok).toBe(true);
  });

  it("rejects a non-object / wrong-shape body", () => {
    expect(validateFillMissingBody(null).ok).toBe(false);
    expect(validateFillMissingBody({ brand: "x" }).ok).toBe(false);
    expect(validateFillMissingBody({ brand: "x", flavor: "y" }).ok).toBe(false);
  });

  it("rejects an empty fields array", () => {
    const r = validateFillMissingBody({ ...base, fields: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects too many fields", () => {
    const fields = Array.from({ length: MAX_FILL_FIELDS + 1 }, (_, i) => ({
      key: `k${i}`,
      label: `L${i}`,
      category: "line",
      kind: "number",
    }));
    const r = validateFillMissingBody({ ...base, fields });
    expect(r.ok).toBe(false);
  });
});

describe("sanitizeFillMissingSuggestions — guards", () => {
  it("returns [] for a wrong top-level shape", () => {
    expect(sanitizeFillMissingSuggestions(null, REQUESTED).suggestions).toEqual([]);
    expect(sanitizeFillMissingSuggestions(42, REQUESTED).suggestions).toEqual([]);
    expect(sanitizeFillMissingSuggestions({ suggestions: "nope" }, REQUESTED).suggestions).toEqual([]);
  });

  it("drops suggestions for unrequested / hallucinated keys", () => {
    const { suggestions } = sanitizeFillMissingSuggestions(
      { suggestions: [{ key: "deleteEverything", value: "1", rationale: "no" }] },
      REQUESTED,
    );
    expect(suggestions).toEqual([]);
  });

  it("drops duplicate keys, keeping the first", () => {
    const { suggestions } = sanitizeFillMissingSuggestions(
      {
        suggestions: [
          { key: "casesNeeded", value: "384", rationale: "typical full run" },
          { key: "casesNeeded", value: "999", rationale: "second" },
        ],
      },
      REQUESTED,
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].value).toBe("384");
  });
});

describe("sanitizeFillMissingSuggestions — number fields", () => {
  it("accepts a numeric value and normalizes it", () => {
    const { suggestions } = sanitizeFillMissingSuggestions(
      { suggestions: [{ key: "app1OzPerPizza", value: "4.0", rationale: "standard cheese rate" }] },
      REQUESTED,
    );
    expect(suggestions[0]).toEqual({
      key: "app1OzPerPizza",
      value: "4",
      rationale: "standard cheese rate",
    });
  });

  it("rejects non-numeric or negative numbers", () => {
    expect(
      sanitizeFillMissingSuggestions(
        { suggestions: [{ key: "casesNeeded", value: "lots", rationale: "x" }] },
        REQUESTED,
      ).suggestions,
    ).toEqual([]);
    expect(
      sanitizeFillMissingSuggestions(
        { suggestions: [{ key: "casesNeeded", value: "-5", rationale: "x" }] },
        REQUESTED,
      ).suggestions,
    ).toEqual([]);
  });
});

describe("sanitizeFillMissingSuggestions — select fields", () => {
  it("accepts an allowed option (case-insensitive) and canonicalizes it", () => {
    const { suggestions } = sanitizeFillMissingSuggestions(
      { suggestions: [{ key: "shipper", value: "Costco", rationale: "bulk club pack" }] },
      REQUESTED,
    );
    expect(suggestions[0].value).toBe("costco");
  });

  it("drops a value not in the option set", () => {
    const { suggestions } = sanitizeFillMissingSuggestions(
      { suggestions: [{ key: "shipper", value: "fedex", rationale: "x" }] },
      REQUESTED,
    );
    expect(suggestions).toEqual([]);
  });
});

describe("sanitizeFillMissingSuggestions — text + clamping", () => {
  it("accepts free text and clamps long value/rationale", () => {
    const longVal = "x".repeat(MAX_VALUE_CHARS + 50);
    const longRat = "y".repeat(MAX_RATIONALE_CHARS + 50);
    const { suggestions } = sanitizeFillMissingSuggestions(
      { suggestions: [{ key: "app1Type", value: longVal, rationale: longRat }] },
      REQUESTED,
    );
    expect(suggestions[0].value.length).toBe(MAX_VALUE_CHARS);
    expect(suggestions[0].rationale.length).toBe(MAX_RATIONALE_CHARS);
  });

  it("drops a suggestion missing value or rationale", () => {
    expect(
      sanitizeFillMissingSuggestions(
        { suggestions: [{ key: "app1Type", value: "", rationale: "x" }] },
        REQUESTED,
      ).suggestions,
    ).toEqual([]);
    expect(
      sanitizeFillMissingSuggestions(
        { suggestions: [{ key: "app1Type", value: "Mozz", rationale: "" }] },
        REQUESTED,
      ).suggestions,
    ).toEqual([]);
  });

  it("passes through a note", () => {
    const { note } = sanitizeFillMissingSuggestions(
      { suggestions: [], note: "  not enough info  " },
      REQUESTED,
    );
    expect(note).toBe("not enough info");
  });
});

describe("buildFillMissingPrompt", () => {
  const input: FillMissingInput = {
    brand: "Lucia's",
    flavor: "PEPPERONI",
    dieType: "12in",
    context: [{ key: "pizzasPerCase", label: "Pizzas / Case", value: "12" }],
    fields: [
      { key: "shipper", label: "Shipper", category: "packaging", kind: "select", options: ["costco", "12in"] },
      { key: "app1OzPerPizza", label: "App 1 oz/pizza", category: "applicator", kind: "number" },
    ],
  };

  it("includes product, known context, and field keys + options", () => {
    const { system, user } = buildFillMissingPrompt(input);
    expect(system).toMatch(/frozen-pizza/i);
    expect(user).toContain("Lucia's");
    expect(user).toContain("PEPPERONI");
    expect(user).toContain("DIE/SIZE: 12in");
    expect(user).toContain("pizzasPerCase");
    expect(user).toContain("key=shipper");
    expect(user).toContain("options=[costco, 12in]");
    expect(user).toContain("key=app1OzPerPizza");
  });
});
