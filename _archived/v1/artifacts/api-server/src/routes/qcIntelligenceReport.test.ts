import { describe, expect, it } from "vitest";
import {
  buildQcIntelligenceReport,
  qcIntelligenceCsv,
  QcIntelligenceCsvLimitError,
  type QcReportEvent,
  type QcReportFilters,
  type QcReportCoverage,
} from "./qcIntelligenceReport";

const filters: QcReportFilters = {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-31T23:59:59.999Z",
  ingredientId: null,
  station: null,
  runId: null,
  checkType: null,
};

const complete: QcReportCoverage = {
  status: "complete",
  sampledEvents: 4,
  includedEvents: 4,
  maxEvents: 5_000,
  moreAvailable: false,
  reason: null,
};

function event(
  id: number,
  eventType: string,
  payload: Record<string, unknown>,
  extra: Partial<QcReportEvent> = {},
): QcReportEvent {
  return {
    id,
    eventType,
    runId: `run-${id}`,
    profileKey: "brand__flavor",
    ingredientId: "ingredient-1",
    ingredientName: "Synthetic Ingredient",
    station: "dough",
    createdAt: `2026-10-${String(id).padStart(2, "0")}T12:00:00.000Z`,
    payload,
    ...extra,
  };
}

describe("QC intelligence report projections", () => {
  it("keeps measurement units and target versions in separate trend contexts", () => {
    const report = buildQcIntelligenceReport("trends", [
      event(1, "weight", {
        actualValue: 10,
        actualUnit: "oz",
        targetValue: 9,
        targetUnit: "oz",
        toleranceValue: 0.1,
        targetVersion: "override:1",
        checkType: "pre-run",
        outcome: "fail",
      }),
      event(2, "weight", {
        actualValue: 10,
        actualUnit: "oz",
        targetValue: 9,
        targetUnit: "oz",
        toleranceValue: 0.1,
        targetVersion: "override:2",
        checkType: "pre-run",
        outcome: "fail",
      }),
      event(3, "weight", {
        actualValue: 1,
        actualUnit: "kg",
        targetValue: 1,
        targetUnit: "kg",
        toleranceValue: 0.1,
        targetVersion: "profile:3",
        checkType: "30-minute",
        outcome: "within-tolerance",
      }),
      event(4, "brix-check", {
        actualBrix: 5.2,
        targetBrix: 5,
        toleranceBrix: 0.2,
        targetVersion: 8,
        checkType: "interval",
        outcome: "pass",
      }, { station: "sauce" }),
    ], filters, complete);

    expect(report.view).toBe("trends");
    if (report.view !== "trends") throw new Error("Expected trend report");
    expect(report.groups).toHaveLength(4);
    expect(new Set(report.groups.map((group) => group.actualUnit))).toEqual(new Set(["oz", "kg", "°Bx"]));
    expect(report.groups.find((group) => group.targetVersion === "override:1")?.points[0]?.outcome).toBe("fail");
    expect(report.groups.find((group) => group.targetVersion === "override:2")?.points).toHaveLength(1);
    expect(report.dateBasis).toBe("event-created-at-utc");
  });

  it("counts only recorded checks and classifies unknown outcomes as not evaluated", () => {
    const report = buildQcIntelligenceReport("results", [
      event(1, "weight", { checkType: "pre-run", outcome: "within-tolerance" }),
      event(2, "weight", { checkType: "pre-run", outcome: "out-of-tolerance" }),
      event(3, "component-check", { outcome: "not-evaluated" }, {
        ingredientId: null,
        station: null,
      }),
      event(4, "lot", { lotNumber: "not a check" }),
    ], filters, complete);

    expect(report.view).toBe("results");
    if (report.view !== "results") throw new Error("Expected result report");
    expect(report.recordedChecks).toBe(3);
    expect(report.byCheckType).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "weight:pre-run", pass: 1, fail: 1, notEvaluated: 0, denominator: 2 }),
      expect.objectContaining({ key: "component-check", notEvaluated: 1, denominator: 1 }),
    ]));
    expect(report.byStation).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "unavailable", notEvaluated: 1, denominator: 1 }),
    ]));
    expect(report.byIngredient).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "unattributed", notEvaluated: 1, denominator: 1 }),
    ]));
  });

  it("does not emit redacted measurement or ingredient values in trends and groups", () => {
    const report = buildQcIntelligenceReport("trends", [
      event(1, "weight", {
        actualValue: 14,
        actualUnit: "oz",
        targetValue: 13,
        targetUnit: "oz",
        toleranceValue: 0.1,
        targetVersion: "override:1",
      }, { redactedFields: ["payload.actualValue", "ingredientName"] }),
    ], filters, complete);

    expect(report.view).toBe("trends");
    if (report.view !== "trends") throw new Error("Expected trend report");
    expect(report.groups).toEqual([]);
    const results = buildQcIntelligenceReport("results", [
      event(1, "weight", { outcome: "fail" }, { redactedFields: ["ingredientName"] }),
    ], filters, complete);
    if (results.view !== "results") throw new Error("Expected result report");
    expect(JSON.stringify(results)).not.toContain("Synthetic Ingredient");
    expect(results.byIngredient[0]?.label).toBe("Redacted ingredient");
  });

  it("uses only exact lot run identities and explains absent outbound links", () => {
    const eventRow = event(1, "lot", { lotNumber: "LOT-1" }, { runId: "exact-run" });
    const canonicalRuns = new Map([
      ["exact-run", {
        runId: "exact-run",
        status: "available" as const,
        source: "completed-run-snapshot" as const,
        productionDate: "2026-10-01",
        label: "Synthetic Brand Cheese",
      }],
    ]);
    const report = buildQcIntelligenceReport("traceability", [
      eventRow,
      event(2, "lot", { lotNumber: "LOT-2" }, { runId: "similar-but-not-equal" }),
    ], filters, complete, canonicalRuns);

    expect(report.view).toBe("traceability");
    if (report.view !== "traceability") throw new Error("Expected traceability report");
    expect(report.lots[0]?.run).toMatchObject({ runId: "exact-run", status: "available" });
    expect(report.lots[1]?.run).toMatchObject({ runId: "similar-but-not-equal", status: "unavailable" });
    expect(report.lots.every((lot) => lot.outboundStatus === "unavailable")).toBe(true);
    expect(report.outboundExplanation).toContain("No explicit");
  });

  it("omits redacted lot numbers and preserves partial coverage metadata", () => {
    const partial = { ...complete, status: "partial" as const, moreAvailable: true, reason: "event-limit" as const };
    const report = buildQcIntelligenceReport("traceability", [
      event(1, "lot", { lotNumber: "[redacted]" }, { redactedFields: ["payload.lotNumber"] }),
    ], filters, partial);
    if (report.view !== "traceability") throw new Error("Expected traceability report");
    expect(report.lots[0]).toMatchObject({ lotNumber: null, lotNumberStatus: "redacted" });
    expect(report.coverage).toEqual(partial);
  });

  it("keeps same-name identities and unversioned historical targets separate, and retains target-less measurements", () => {
    const payload = { actualValue: 2, actualUnit: "oz", targetValue: 2, targetUnit: "oz", outcome: "pass" };
    const report = buildQcIntelligenceReport("trends", [
      event(1, "weight", payload),
      event(2, "weight", payload),
      event(3, "weight", { ...payload, targetVersion: "same-v1" }, { ingredientId: "different-identity" }),
      event(4, "weight", { actualValue: 3, actualUnit: "kg", targetValue: null, targetUnit: null, outcome: "not-evaluated" }),
    ], filters, complete);
    if (report.view !== "trends") throw new Error("Expected trend report");
    expect(report.groups).toHaveLength(4);
    expect(report.groups.find((group) => group.actualUnit === "kg")?.points[0]).toMatchObject({ actual: 3, target: null, outcome: "not-evaluated" });
    expect(report.groups.filter((group) => group.targetVersion.startsWith("unversioned-event:"))).toHaveLength(2);
  });

  it("marks bounded group outputs partial instead of presenting dropped groups as complete", () => {
    const report = buildQcIntelligenceReport("results", [
      event(1, "weight", { outcome: "pass" }),
      event(2, "brix-check", { outcome: "not-evaluated" }, { ingredientId: "another-id", station: "sauce" }),
    ], filters, complete, new Map(), 1);
    if (report.view !== "results") throw new Error("Expected result report");
    expect(report.coverage).toMatchObject({ status: "partial", reason: "group-limit" });
    expect(report.recordedChecks).toBe(2);
    expect(report.byIngredient).toHaveLength(1);
    expect(report.byCheckType).toHaveLength(1);
  });

  it("escapes formula-leading CSV text, includes applied metadata and rejects excessive cells", () => {
    const report = buildQcIntelligenceReport("traceability", [
      event(1, "lot", { lotNumber: "=SYNTHETIC-FORMULA" }, { ingredientName: "+Synthetic" }),
    ], filters, complete);
    const csv = qcIntelligenceCsv(report);
    expect(csv).toContain("\"'=SYNTHETIC-FORMULA\"");
    expect(csv).toContain("\"'+Synthetic\"");
    expect(csv).toContain('"coverage","complete"');
    expect(csv).toContain('"ingredientId",""');
    const tooLarge = buildQcIntelligenceReport("traceability", [
      event(1, "lot", { lotNumber: "x".repeat(4001) }),
    ], filters, complete);
    expect(() => qcIntelligenceCsv(tooLarge)).toThrow(QcIntelligenceCsvLimitError);
  });
});
