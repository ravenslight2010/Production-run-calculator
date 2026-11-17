import { describe, expect, it } from "vitest";
import { normalizeScheduledDays } from "./scheduledDays";

describe("normalizeScheduledDays", () => {
  it("rejects an API error envelope so it cannot corrupt scheduled-day state", () => {
    expect(normalizeScheduledDays({ error: "Unauthorized" })).toEqual([]);
  });

  it("keeps valid scheduled days and normalizes incomplete run fields", () => {
    expect(normalizeScheduledDays([{
      date: "2030-06-15",
      runCount: 1,
      runs: [{ id: "run-1", brand: "Acme", flavor: "Deluxe", casesNeeded: 120, dieType: "12\"" }],
    }])).toEqual([{
      date: "2030-06-15",
      runCount: 1,
      runs: [{ id: "run-1", brand: "Acme", flavor: "Deluxe", casesNeeded: 120, dieType: "12\"" }],
    }]);
  });
});