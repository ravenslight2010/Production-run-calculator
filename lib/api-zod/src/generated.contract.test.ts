import { describe, expect, it } from "vitest";
import * as GeneratedApi from "./generated/api";
import {
  OperationsAnomalyDetectionResponse,
  OperationsIncidentPatternsResponse,
  OperationsMixReconciliationResponse,
  OperationsRecapResponse,
  OperationsScheduleOrderingResponse,
  OperationsSpecReconciliationResponse,
} from "./generated/api";

describe("generated Zod schema runtime contracts", () => {
  it("keeps Operations Insights deterministic response contracts valid", () => {
    expect(
      OperationsRecapResponse.parse({
        summary: "Production recap",
        stats: {
          scope: "day",
          date: "2026-08-26",
          runsPlanned: 0,
          runsFinished: 0,
          casesPlanned: 0,
          casesProduced: 0,
          attainmentPct: 0,
          totalDowntimeMinutes: 0,
          totalStoppages: 0,
          unfinishedRuns: [],
          incidentCount: 0,
          wasteFlaggedCount: 0,
          hasData: false,
        },
        generatedAt: 1,
      }).summary,
    ).toBe("Production recap");

    expect(
      OperationsAnomalyDetectionResponse.parse({
        anomalies: [],
        checkedRuns: 0,
        baselineRuns: 0,
        summary: "",
        generatedAt: 1,
      }).anomalies,
    ).toEqual([]);

    expect(
      OperationsScheduleOrderingResponse.parse({
        order: [],
        changed: false,
        improved: false,
        before: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        after: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        summary: "",
        generatedAt: 1,
      }).improved,
    ).toBe(false);

    expect(
      OperationsSpecReconciliationResponse.parse({
        specSheetId: 1,
        discrepancies: [],
        generatedAt: 1,
      }).discrepancies,
    ).toEqual([]);

    expect(
      OperationsMixReconciliationResponse.parse({
        discrepancies: [],
        generatedAt: 1,
      }).discrepancies,
    ).toEqual([]);

    expect(
      OperationsIncidentPatternsResponse.parse({
        clusters: [],
        totalIncidents: 0,
        generatedAt: 1,
      }).clusters,
    ).toEqual([]);
  });

  it("publishes permanent operation names without legacy AI contract names", () => {
    expect("OperationsSpecReconciliationBody" in GeneratedApi).toBe(true);
    expect("OperationsMixReconciliationBody" in GeneratedApi).toBe(true);
    expect("OperationsIncidentPatternsBody" in GeneratedApi).toBe(true);
    expect("AiSpecReconcileBody" in GeneratedApi).toBe(false);
    expect("AiMixReconcileBody" in GeneratedApi).toBe(false);
    expect("AiSummaryBody" in GeneratedApi).toBe(false);
    expect("AiAnomaliesBody" in GeneratedApi).toBe(false);
    expect("AiScheduleOptimizeBody" in GeneratedApi).toBe(false);
    expect("AiIncidentClustersBody" in GeneratedApi).toBe(false);
  });

  it("does not publish retired conversation-history schemas", () => {
    expect("ConversationHistory" in GeneratedApi).toBe(false);
    expect("AppendConversationInput" in GeneratedApi).toBe(false);
    expect("ConversationTurn" in GeneratedApi).toBe(false);
  });
});