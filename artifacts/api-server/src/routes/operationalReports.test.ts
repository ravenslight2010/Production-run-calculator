import { describe, expect, it } from "vitest";
import { dateRange, validateOperationalReportBody } from "./operationalReports";

const run = {
  brand: "Acme",
  flavor: "Cheese",
  casesPlanned: 100,
  casesProduced: 90,
  finished: false,
  downtimeMinutes: 12,
  stoppageCount: 2,
};

describe("operational report input contract", () => {
  it("accepts a valid day report", () => {
    const result = validateOperationalReportBody({ scope: "day", date: "2026-09-04", runs: [run] });
    expect(result.ok).toBe(true);
  });

  it("accepts a week and derives the six-day lookback", () => {
    const result = validateOperationalReportBody({ scope: "week", date: "2026-09-04", runs: [] });
    expect(result.ok).toBe(true);
    expect(dateRange("week", "2026-09-04")).toEqual(["2026-08-29", "2026-09-04"]);
  });

  it("rejects invalid calendar dates and malformed runs", () => {
    expect(validateOperationalReportBody({ scope: "day", date: "2026-02-30", runs: [] }).ok).toBe(false);
    expect(validateOperationalReportBody({ scope: "day", date: "2026-09-04", runs: [{ ...run, casesPlanned: "100" }] }).ok).toBe(false);
  });

  it("rejects more than 600 supplied runs", () => {
    const tooMany = Array.from({ length: 601 }, () => run);
    expect(validateOperationalReportBody({ scope: "day", date: "2026-09-04", runs: tooMany }).ok).toBe(false);
  });
});