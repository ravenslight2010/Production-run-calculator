import { describe, expect, it } from "vitest";
import * as GeneratedApi from "./generated/api";
import {
  AiAnomaliesResponse,
  AiScheduleOptimizeResponse,
  AiSummaryResponse,
} from "./generated/api";

describe("generated Zod schema runtime contracts", () => {
  it("keeps retained deterministic operation status contracts valid", () => {
    expect(
      AiSummaryResponse.parse({
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
        aiGenerated: false,
        aiStatus: "deterministic",
      }).aiStatus,
    ).toBe("deterministic");

    expect(
      AiAnomaliesResponse.parse({
        anomalies: [],
        checkedRuns: 0,
        baselineRuns: 0,
        summary: "",
        generatedAt: 1,
        aiGenerated: false,
        aiStatus: "deterministic",
      }).aiStatus,
    ).toBe("deterministic");

    expect(
      AiScheduleOptimizeResponse.parse({
        order: [],
        changed: false,
        improved: false,
        before: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        after: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        summary: "",
        generatedAt: 1,
        aiGenerated: false,
        aiStatus: "deterministic",
      }).aiStatus,
    ).toBe("deterministic");
  });

  it("does not publish retired conversation-history schemas", () => {
    expect("ConversationHistory" in GeneratedApi).toBe(false);
    expect("AppendConversationInput" in GeneratedApi).toBe(false);
    expect("ConversationTurn" in GeneratedApi).toBe(false);
  });
});