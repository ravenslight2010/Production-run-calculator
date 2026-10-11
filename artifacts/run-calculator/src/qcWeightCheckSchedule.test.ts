import { describe, expect, it } from "vitest";
import {
  deriveQcWeightCheckReminders,
  QC_WEIGHT_CHECK_INTERVAL_MS,
  type QcWeightReminderEvent,
} from "./qcWeightCheckSchedule";

const START = Date.parse("2025-01-01T00:00:00.000Z");
const configuredTarget = {
  ingredientId: "flour",
  ingredientName: "Flour",
  targetValue: 12,
  unit: "oz",
  state: "configured",
};

function weightCheck(createdAt: number): QcWeightReminderEvent {
  return {
    eventType: "weight",
    ingredientId: "flour",
    payload: { checkType: "30-minute" },
    createdAt: new Date(createdAt).toISOString(),
  };
}

describe("QC weight check schedule", () => {
  it("starts the first reminder 30 minutes after the run starts", () => {
    const reminders = deriveQcWeightCheckReminders({
      runStartedAt: START,
      pauses: [],
      targets: [configuredTarget],
      events: [],
      now: START + 10 * 60_000,
    });

    expect(reminders).toEqual([{
      ingredientId: "flour",
      ingredientName: "Flour",
      nextCheckAt: START + QC_WEIGHT_CHECK_INTERVAL_MS,
    }]);
  });

  it("moves the next reminder 30 minutes past the latest saved active-run check", () => {
    const reminders = deriveQcWeightCheckReminders({
      runStartedAt: START,
      pauses: [],
      targets: [configuredTarget],
      events: [weightCheck(START + 45 * 60_000), weightCheck(START + 30 * 60_000)],
      now: START + 50 * 60_000,
    });

    expect(reminders[0]?.nextCheckAt).toBe(START + 75 * 60_000);
  });

  it("excludes completed pauses when calculating a saved check's active time", () => {
    const pauseStart = START + 35 * 60_000;
    const resumeAt = START + 55 * 60_000;
    const resumedStartedAt = START + 20 * 60_000;
    const reminders = deriveQcWeightCheckReminders({
      runStartedAt: resumedStartedAt,
      pauses: [{ type: "pause", startedAt: pauseStart, endedAt: resumeAt }],
      targets: [configuredTarget],
      events: [weightCheck(START + 30 * 60_000)],
      now: resumeAt,
    });

    expect(reminders[0]?.nextCheckAt).toBe(START + 80 * 60_000);
  });

  it("omits targets without a valid configured value and unit", () => {
    const reminders = deriveQcWeightCheckReminders({
      runStartedAt: START,
      pauses: [],
      targets: [
        configuredTarget,
        { ...configuredTarget, ingredientId: "unknown", state: "not-evaluated" },
        { ...configuredTarget, ingredientId: "invalid-unit", unit: null },
      ],
      events: [],
      now: START,
    });

    expect(reminders.map(({ ingredientId }) => ingredientId)).toEqual(["flour"]);
  });
});
