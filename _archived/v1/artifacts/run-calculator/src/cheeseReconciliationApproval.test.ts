import { describe, expect, it } from "vitest";
import {
  CHEESE_RECONCILIATION_2026_08_26,
  auditedCheeseLinks,
  isAuditedCheeseWorkbook,
  matchesAuditedCheeseCommit,
} from "./cheeseReconciliationApproval";

describe("audited cheese reconciliation approval", () => {
  it("contains the exact 58 approved targets and keeps Price Chopper held", () => {
    expect(auditedCheeseLinks).toHaveLength(58);
    expect(new Set(auditedCheeseLinks.map((link) => link.targetId)).size).toBe(58);
    expect(isAuditedCheeseWorkbook([CHEESE_RECONCILIATION_2026_08_26.workbookSha256])).toBe(true);
  });

  it("does not grant an audit mode to a changed workbook", () => {
    expect(isAuditedCheeseWorkbook(["changed"])).toBe(false);
  });

  it("accepts only the complete approved target allowlist, with no removals", () => {
    const approval = {
      auditId: "test",
      evidence: {},
      approvedLinks: auditedCheeseLinks.map((link) => ({
        ...link,
        sourceFormulaFingerprint: "811c9dc5",
      })),
      held: {
        sourceId: "held",
        sourceName: "Hannaford's Chicken Bacon Club Cheese Mix",
        brand: "Price Chopper",
        reason: "formula conflict",
      },
    };
    const recipes = approval.approvedLinks.map((link) => ({
      id: link.targetId,
      components: [],
    })) as never[];
    expect(matchesAuditedCheeseCommit(approval, recipes, [])).toBe(true);
    expect(matchesAuditedCheeseCommit(approval, recipes.slice(1), [])).toBe(false);
    expect(matchesAuditedCheeseCommit(approval, recipes, ["cheese:live-only"])).toBe(false);
    expect(matchesAuditedCheeseCommit(approval, [{
      ...recipes[0],
      components: [{ ingredient: "changed", lbs: 1 }],
    }, ...recipes.slice(1)], [])).toBe(false);
  });
});