import { describe, expect, it } from "vitest";
import {
  adaptCanonicalOperationalSnapshot,
  dateRange,
  operationalReleaseEvidence,
  validateOperationalReportBody,
} from "./operationalReports";

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
  it("reports the controlled deployed revision before compatibility values", () => {
    expect(operationalReleaseEvidence({
      RELEASE_REVISION: "a".repeat(40),
      REPLIT_GIT_COMMIT: "b".repeat(40),
      GIT_COMMIT: "c".repeat(40),
      npm_package_version: "1.2.3",
      NODE_ENV: "production",
    })).toEqual({
      version: "1.2.3",
      revision: "a".repeat(40),
      environment: "production",
    });
  });

  it("does not expose malformed revision metadata as release evidence", () => {
    expect(operationalReleaseEvidence({
      RELEASE_REVISION: "unknown",
      REPLIT_GIT_COMMIT: "b".repeat(40),
    }).revision).toBe("unknown");
  });

  it("accepts a valid day report", () => {
    const result = validateOperationalReportBody({ scope: "day", date: "2026-09-04", runs: [run] });
    expect(result.ok).toBe(true);
  });

  it("accepts scope/date without client production facts", () => {
    expect(validateOperationalReportBody({ scope: "day", date: "2026-09-04" }).ok).toBe(true);
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

  it("adapts canonical stored data to complete v1 without mutating it", () => {
    const stored = { dayState: { runs: [] }, runValues: {} };
    const snapshot = adaptCanonicalOperationalSnapshot(stored);
    expect(snapshot).toMatchObject({ syncVersion: 1, completeness: "complete" });
    expect(stored).not.toHaveProperty("syncVersion");
    expect(stored).not.toHaveProperty("completeness");
  });
});