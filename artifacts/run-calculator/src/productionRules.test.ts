import { describe, it, expect } from "vitest";
import {
  normalizeRule,
  evaluateRule,
  evaluateRules,
  hasStrictViolation,
  newRule,
  defaultRuleName,
  RULE_FIELDS,
  type ProductionRule,
  type RuleRunContext,
} from "@workspace/production-rules";

function ctx(over: Partial<RuleRunContext> = {}): RuleRunContext {
  return { fields: {}, ...over };
}

describe("normalizeRule", () => {
  it("rejects input with no id", () => {
    expect(normalizeRule({ type: "required-field", field: "brand" })).toBeNull();
  });

  it("rejects an unknown type", () => {
    expect(normalizeRule({ id: "a", type: "nope" })).toBeNull();
  });

  it("defaults enforcement to flexible and enabled to true", () => {
    const r = normalizeRule({ id: "a", type: "required-field", field: "brand" });
    expect(r?.enforcement).toBe("flexible");
    expect(r?.enabled).toBe(true);
  });

  it("keeps explicit strict + disabled", () => {
    const r = normalizeRule({
      id: "a",
      type: "required-field",
      field: "brand",
      enforcement: "strict",
      enabled: false,
    });
    expect(r?.enforcement).toBe("strict");
    expect(r?.enabled).toBe(false);
  });

  it("fills a default name when blank", () => {
    const r = normalizeRule({ id: "a", type: "sequence" });
    expect(r?.name).toBe(defaultRuleName("sequence"));
  });

  it("rejects a required-field rule on an unknown field", () => {
    expect(normalizeRule({ id: "a", type: "required-field", field: "bogus" })).toBeNull();
  });

  it("rejects a numeric-range rule on a non-number field", () => {
    expect(
      normalizeRule({ id: "a", type: "numeric-range", field: "brand", min: 1 }),
    ).toBeNull();
  });

  it("rejects a numeric-range rule with neither bound", () => {
    expect(
      normalizeRule({ id: "a", type: "numeric-range", field: "lineSpeed" }),
    ).toBeNull();
  });

  it("normalizes sequence attribute values onto allowed values", () => {
    const r = normalizeRule({
      id: "a",
      type: "sequence",
      before: "NONE",
      after: "Egg",
    });
    expect(r?.attribute).toBe("allergen");
    expect(r?.before).toBe("none");
    expect(r?.after).toBe("egg");
  });
});

describe("evaluateRule - required-field", () => {
  const rule: ProductionRule = {
    id: "r1",
    name: "Brand required",
    type: "required-field",
    enforcement: "strict",
    enabled: true,
    field: "brand",
  };

  it("flags a blank text field", () => {
    expect(evaluateRule(rule, ctx({ fields: { brand: "" } }))?.enforcement).toBe("strict");
  });

  it("passes when set", () => {
    expect(evaluateRule(rule, ctx({ fields: { brand: "DiGiorno" } }))).toBeNull();
  });

  it("treats a non-positive number as empty", () => {
    const numRule: ProductionRule = { ...rule, field: "casesNeeded" };
    expect(evaluateRule(numRule, ctx({ fields: { casesNeeded: 0 } }))).not.toBeNull();
    expect(evaluateRule(numRule, ctx({ fields: { casesNeeded: 5 } }))).toBeNull();
  });

  it("never fires when disabled", () => {
    expect(evaluateRule({ ...rule, enabled: false }, ctx({ fields: { brand: "" } }))).toBeNull();
  });
});

describe("evaluateRule - numeric-range", () => {
  const rule: ProductionRule = {
    id: "r2",
    name: "Line speed range",
    type: "numeric-range",
    enforcement: "flexible",
    enabled: true,
    field: "lineSpeed",
    min: 50,
    max: 100,
  };

  it("passes inside the range", () => {
    expect(evaluateRule(rule, ctx({ fields: { lineSpeed: 75 } }))).toBeNull();
  });

  it("flags below min", () => {
    expect(evaluateRule(rule, ctx({ fields: { lineSpeed: 40 } }))).not.toBeNull();
  });

  it("flags above max", () => {
    expect(evaluateRule(rule, ctx({ fields: { lineSpeed: 120 } }))).not.toBeNull();
  });

  it("treats a missing value as 0 (trips a min bound)", () => {
    expect(evaluateRule(rule, ctx({ fields: {} }))).not.toBeNull();
  });

  it("honors a max-only bound", () => {
    const maxOnly: ProductionRule = { ...rule, min: null };
    expect(evaluateRule(maxOnly, ctx({ fields: { lineSpeed: 0 } }))).toBeNull();
    expect(evaluateRule(maxOnly, ctx({ fields: { lineSpeed: 200 } }))).not.toBeNull();
  });
});

describe("evaluateRule - sequence", () => {
  const rule: ProductionRule = {
    id: "r3",
    name: "No Egg after None",
    type: "sequence",
    enforcement: "strict",
    enabled: true,
    attribute: "allergen",
    before: "none",
    after: "egg",
  };

  const seq = [
    { id: "run1", label: "Run 1", attributes: { allergen: "none" } },
    { id: "run2", label: "Run 2", attributes: { allergen: "egg" } },
  ];

  it("flags the disallowed transition", () => {
    expect(evaluateRule(rule, ctx({ sequence: seq }))).not.toBeNull();
  });

  it("only reports transitions involving the current run", () => {
    expect(evaluateRule(rule, ctx({ sequence: seq, currentRunId: "run1" }))).not.toBeNull();
    const seq3 = [
      ...seq,
      { id: "run3", label: "Run 3", attributes: { allergen: "soy" } },
    ];
    // run3 is not part of the none->egg transition.
    expect(evaluateRule(rule, ctx({ sequence: seq3, currentRunId: "run3" }))).toBeNull();
  });

  it("does nothing with fewer than two runs", () => {
    expect(evaluateRule(rule, ctx({ sequence: [seq[0]] }))).toBeNull();
  });
});

describe("evaluateRules + hasStrictViolation", () => {
  it("collects violations in rule order and detects strict ones", () => {
    const rules: ProductionRule[] = [
      { id: "a", name: "Brand", type: "required-field", enforcement: "flexible", enabled: true, field: "brand" },
      { id: "b", name: "Cases", type: "required-field", enforcement: "strict", enabled: true, field: "casesNeeded" },
    ];
    const violations = evaluateRules(rules, ctx({ fields: { brand: "", casesNeeded: 0 } }));
    expect(violations.map((v) => v.ruleId)).toEqual(["a", "b"]);
    expect(hasStrictViolation(violations)).toBe(true);
  });

  it("reports no strict violation when all are flexible", () => {
    const rules: ProductionRule[] = [
      { id: "a", name: "Brand", type: "required-field", enforcement: "flexible", enabled: true, field: "brand" },
    ];
    expect(hasStrictViolation(evaluateRules(rules, ctx({ fields: { brand: "" } })))).toBe(false);
  });
});

describe("newRule", () => {
  it("builds an immediately-persistable draft for every type", () => {
    for (const type of ["required-field", "numeric-range", "sequence"] as const) {
      const r = newRule("id-" + type, type);
      expect(normalizeRule(r)).not.toBeNull();
    }
  });

  it("seeds numeric-range with a numeric field and a default lower bound", () => {
    const r = newRule("x", "numeric-range");
    expect(RULE_FIELDS.find((f) => f.key === r.field)?.kind).toBe("number");
    // Seeded with min:0 so 'Add rule' persists; the manager edits the bounds after.
    expect(r.min).toBe(0);
    expect(normalizeRule(r)).not.toBeNull();
  });
});
