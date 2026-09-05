// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  operationalReportText,
  reportFilename,
  shareOperationalReport,
} from "./reportShare";
import type { OperationalReport } from "@workspace/day-summary";

const report: OperationalReport = {
  scope: "week",
  date: "2026-09-04",
  periodStart: "2026-08-29",
  periodEnd: "2026-09-04",
  generatedAt: "2026-09-04T12:00:00.000Z",
  production: {
    scope: "week",
    date: "2026-09-04",
    runsPlanned: 2,
    runsFinished: 1,
    casesPlanned: 200,
    casesProduced: 140,
    attainmentPct: 70,
    totalDowntimeMinutes: 12,
    totalStoppages: 2,
    topDowntime: null,
    unfinishedRuns: ["Acme Cheese"],
    incidentCount: 0,
    wasteFlaggedCount: 0,
    hasData: true,
  },
  quality: { availability: "available", value: { checks: 2, issues: 1, failed: 0, warnings: 1 } },
  incidents: { availability: "unavailable", value: null, note: "Incident history is unavailable." },
  inventory: {
    availability: "available",
    value: {
      flaggedItems: 1,
      historical: {
        availability: "unavailable",
        value: null,
        note: "Historical ledger is unavailable.",
      },
    },
  },
  narrative: { source: "ai", text: "One run remains unfinished." },
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as Navigator & { share?: unknown }).share;
});

describe("operational report sharing", () => {
  it("formats scope, authoritative sections, unavailable values, and narration", () => {
    const text = operationalReportText(report);
    expect(text).toContain("Period: 2026-08-29 to 2026-09-04");
    expect(text).toContain("Incidents: Unavailable — Incident history is unavailable.");
    expect(text).toContain("OPTIONAL NARRATIVE (AI-GENERATED; NOT AUTHORITATIVE STATISTICS)");
  });

  it("uses the clipboard when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    expect(await shareOperationalReport(report)).toBe("copied");
    expect(writeText).toHaveBeenCalledOnce();
    expect(reportFilename(report)).toBe("operational-week-2026-09-04.txt");
  });

  it("uses native sharing when it is available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share });
    expect(await shareOperationalReport(report)).toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("Operational week") }));
  });
});