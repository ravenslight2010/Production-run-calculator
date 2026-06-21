import { describe, it, expect } from "vitest";
import {
  evaluateRule,
  evaluateRules,
  hasStrictViolation,
  isRuleBypassed,
  type ProductionRule,
  type RuleRunContext,
} from "./index";

// Focused unit coverage for the run-screen exception paths: bypass conditions
// (text case-insensitive + numeric equality) waiving a rule, a non-matching
// bypass leaving the violation intact, and the checklist being carried onto a
// violation only when the rule is actually violated and not bypassed. These are
// pure functions, so this suite runs without a database alongside the lib.

function ctx(over: Partial<RuleRunContext> = {}): RuleRunContext {
  return { fields: {}, ...over };
}

// A strict required-field rule on "brand" — violated whenever brand is blank.
function brandRule(over: Partial<ProductionRule> = {}): ProductionRule {
  return {
    id: "r-brand",
    name: "Brand required",
    type: "required-field",
    enforcement: "strict",
    enabled: true,
    field: "brand",
    ...over,
  };
}

describe("isRuleBypassed - text matching", () => {
  it("waives the rule when a text bypass value matches exactly", () => {
    const rule = brandRule({ bypass: [{ field: "dieType", value: "Thin" }] });
    expect(isRuleBypassed(rule, ctx({ fields: { dieType: "Thin" } }))).toBe(true);
  });

  it("matches text bypass values case-insensitively", () => {
    const rule = brandRule({ bypass: [{ field: "dieType", value: "Thin" }] });
    expect(isRuleBypassed(rule, ctx({ fields: { dieType: "THIN" } }))).toBe(true);
    expect(isRuleBypassed(rule, ctx({ fields: { dieType: "thin" } }))).toBe(true);
  });

  it("does not match a different text value", () => {
    const rule = brandRule({ bypass: [{ field: "dieType", value: "Thin" }] });
    expect(isRuleBypassed(rule, ctx({ fields: { dieType: "Thick" } }))).toBe(false);
  });

  it("returns false when the rule has no bypass conditions", () => {
    expect(isRuleBypassed(brandRule(), ctx({ fields: { dieType: "Thin" } }))).toBe(false);
  });

  it("waives when ANY of several bypass conditions matches", () => {
    const rule = brandRule({
      bypass: [
        { field: "dieType", value: "Thin" },
        { field: "flavor", value: "Cheese" },
      ],
    });
    expect(isRuleBypassed(rule, ctx({ fields: { flavor: "cheese" } }))).toBe(true);
    expect(isRuleBypassed(rule, ctx({ fields: { flavor: "Pepperoni" } }))).toBe(false);
  });
});

describe("isRuleBypassed - numeric matching", () => {
  it("waives the rule on numeric equality (number value vs string condition)", () => {
    const rule = brandRule({ bypass: [{ field: "casesNeeded", value: "100" }] });
    expect(isRuleBypassed(rule, ctx({ fields: { casesNeeded: 100 } }))).toBe(true);
  });

  it("does not match a different number", () => {
    const rule = brandRule({ bypass: [{ field: "casesNeeded", value: "100" }] });
    expect(isRuleBypassed(rule, ctx({ fields: { casesNeeded: 99 } }))).toBe(false);
  });

  it("does not match when the numeric field is unset", () => {
    const rule = brandRule({ bypass: [{ field: "casesNeeded", value: "100" }] });
    expect(isRuleBypassed(rule, ctx({ fields: {} }))).toBe(false);
  });
});

describe("evaluateRule - bypass short-circuits evaluation", () => {
  it("a matching bypass waives a would-be violation (no warning, no block)", () => {
    const rule = brandRule({ bypass: [{ field: "dieType", value: "Thin" }] });
    // brand is blank (would violate), but the Thin die-type bypass waives it.
    expect(evaluateRule(rule, ctx({ fields: { brand: "", dieType: "Thin" } }))).toBeNull();
  });

  it("a non-matching bypass leaves the violation in place", () => {
    const rule = brandRule({ bypass: [{ field: "dieType", value: "Thin" }] });
    const v = evaluateRule(rule, ctx({ fields: { brand: "", dieType: "Thick" } }));
    expect(v).not.toBeNull();
    expect(v?.enforcement).toBe("strict");
  });

  it("a numeric bypass match waives the violation, a near-miss does not", () => {
    const rule = brandRule({ bypass: [{ field: "casesNeeded", value: "100" }] });
    expect(evaluateRule(rule, ctx({ fields: { brand: "", casesNeeded: 100 } }))).toBeNull();
    expect(evaluateRule(rule, ctx({ fields: { brand: "", casesNeeded: 99 } }))).not.toBeNull();
  });
});

describe("evaluateRule - checklist is carried onto violations only when violated and not bypassed", () => {
  const checklist = ["Confirm with supervisor", "Log the override"];

  it("carries the checklist onto the violation when the rule is violated", () => {
    const rule = brandRule({ checklist });
    const v = evaluateRule(rule, ctx({ fields: { brand: "" } }));
    expect(v).not.toBeNull();
    expect(v?.checklist).toEqual(checklist);
  });

  it("returns a fresh checklist copy, not the rule's own array reference", () => {
    const rule = brandRule({ checklist });
    const v = evaluateRule(rule, ctx({ fields: { brand: "" } }));
    expect(v?.checklist).not.toBe(rule.checklist);
  });

  it("does not carry a checklist when the rule passes (no violation at all)", () => {
    const rule = brandRule({ checklist });
    expect(evaluateRule(rule, ctx({ fields: { brand: "DiGiorno" } }))).toBeNull();
  });

  it("a bypassed checklist rule emits nothing — no violation, no checklist", () => {
    const rule = brandRule({ checklist, bypass: [{ field: "dieType", value: "Thin" }] });
    expect(evaluateRule(rule, ctx({ fields: { brand: "", dieType: "Thin" } }))).toBeNull();
  });
});

describe("evaluateRules + hasStrictViolation across exception paths", () => {
  it("keeps a strict violation that blocks Start, while a bypassed strict rule drops out", () => {
    const rules: ProductionRule[] = [
      // Violated, strict, with a checklist -> blocks Start (client gates on the checklist).
      brandRule({ id: "blocking", checklist: ["Ack"] }),
      // Strict but bypassed -> contributes no violation.
      brandRule({
        id: "waived",
        field: "flavor",
        bypass: [{ field: "dieType", value: "Thin" }],
      }),
    ];
    const violations = evaluateRules(
      rules,
      ctx({ fields: { brand: "", flavor: "", dieType: "Thin" } }),
    );
    expect(violations.map((v) => v.ruleId)).toEqual(["blocking"]);
    expect(violations[0].checklist).toEqual(["Ack"]);
    expect(hasStrictViolation(violations)).toBe(true);
  });

  it("reports no strict block once every strict rule is waived by a matching bypass", () => {
    const rules: ProductionRule[] = [
      brandRule({ bypass: [{ field: "dieType", value: "Thin" }] }),
    ];
    const violations = evaluateRules(rules, ctx({ fields: { brand: "", dieType: "Thin" } }));
    expect(violations).toEqual([]);
    expect(hasStrictViolation(violations)).toBe(false);
  });
});
