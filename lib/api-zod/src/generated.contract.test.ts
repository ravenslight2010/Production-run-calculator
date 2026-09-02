import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AiAnomaliesResponse,
  AiScheduleOptimizeResponse,
  AiSummaryResponse,
  CheckUsernameAvailableQueryParams,
  ListPasswordResetRequestsResponseItem,
  ListRunsResponseItem,
} from "./generated/api";

describe("generated Zod schema runtime contracts", () => {
  it("coerces query and parameter values as generated", () => {
    const parsed = CheckUsernameAvailableQueryParams.parse({ username: 12345 });

    expect(parsed.username).toBe("12345");
  });

  it("converts generated date fields to Date instances", () => {
    const parsed = ListPasswordResetRequestsResponseItem.parse({
      id: "reset-1",
      userId: "user-1",
      username: "operator",
      requestedAt: "2026-08-26T12:34:56.000Z",
    });

    expect(parsed.requestedAt).toBeInstanceOf(Date);
    expect(parsed.requestedAt.toISOString()).toBe("2026-08-26T12:34:56.000Z");
  });

  it("keeps integer response fields numeric and integral", () => {
    const parsed = ListRunsResponseItem.parse({
      id: 42,
      label: "Morning run",
      casesNeeded: 12,
      casesLeft: 12,
      skidsCompleted: 0,
      pizzasPerMin: "2.5",
      totalTimeSec: 300,
      batchesNeeded: "3",
      inputs: {},
      createdAt: "2026-08-26T12:34:56.000Z",
    });

    expect(parsed.id).toBe(42);
    expect(parsed.casesNeeded).toBe(12);
    expect(() =>
      ListRunsResponseItem.parse({
        id: 42.5,
        label: "Morning run",
        casesNeeded: 12,
        casesLeft: 12,
        skidsCompleted: 0,
        pizzasPerMin: "2.5",
        totalTimeSec: 300,
        batchesNeeded: "3",
        inputs: {},
        createdAt: "2026-08-26T12:34:56.000Z",
      }),
    ).toThrow(z.ZodError);
  });

  it("validates the shared AI status values on recap and schedule responses", () => {
    const statuses = ["deterministic", "enriched", "unavailable"] as const;

    for (const aiStatus of statuses) {
      const summary = AiSummaryResponse.parse({
        summary: "Production recap",
        stats: {
          scope: "day",
          date: "2026-08-26",
          runsPlanned: 1,
          runsFinished: 1,
          casesPlanned: 12,
          casesProduced: 12,
          attainmentPct: 100,
          totalDowntimeMinutes: 0,
          totalStoppages: 0,
          unfinishedRuns: [],
          incidentCount: 0,
          wasteFlaggedCount: 0,
          hasData: true,
        },
        generatedAt: 1_750_000_000_000,
        aiGenerated: aiStatus === "enriched",
        aiStatus,
      });
      expect(summary.aiStatus).toBe(aiStatus);

      const schedule = AiScheduleOptimizeResponse.parse({
        order: ["run-1"],
        changed: false,
        improved: false,
        before: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        after: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        summary: "",
        generatedAt: 1_750_000_000_000,
        aiGenerated: aiStatus === "enriched",
        aiStatus,
      });
      expect(schedule.aiStatus).toBe(aiStatus);

      const anomalies = AiAnomaliesResponse.parse({
        anomalies: [],
        checkedRuns: 0,
        baselineRuns: 0,
        summary: "",
        generatedAt: 1_750_000_000_000,
        aiGenerated: aiStatus === "enriched",
        aiStatus,
      });
      expect(anomalies.aiStatus).toBe(aiStatus);
    }

    expect(() =>
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
        generatedAt: 1_750_000_000_000,
        aiGenerated: false,
        aiStatus: "unknown",
      }),
    ).toThrow(z.ZodError);

    expect(() =>
      AiAnomaliesResponse.parse({
        anomalies: [],
        checkedRuns: 0,
        baselineRuns: 0,
        summary: "",
        generatedAt: 1_750_000_000_000,
        aiGenerated: false,
        aiStatus: "unknown",
      }),
    ).toThrow(z.ZodError);
  });
});
