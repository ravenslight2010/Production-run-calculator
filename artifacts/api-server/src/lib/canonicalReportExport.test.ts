import { describe, expect, it } from "vitest";
import { canonicalReportCsv, canonicalReportSnapshotId, canonicalReportXlsx } from "./canonicalReportExport";

const snapshot = {
  id: "3b1267a8-11bb-44e2-a8b9-687874f54800", contentHash: "a".repeat(64), finalizedAt: new Date("2025-01-01T00:00:00.000Z"),
  report: { scope: "day", date: "2025-01-01", periodStart: "2025-01-01", periodEnd: "2025-01-01", production: { casesPlanned: 1, casesProduced: 1, attainmentPct: 100, totalDowntimeMinutes: 0, totalStoppages: 0, runsFinished: 1, runsPlanned: 1, unfinishedRuns: [] }, productionRows: [], quality: { availability: "unavailable", value: null }, incidents: { availability: "unavailable", value: null }, inventory: { availability: "unavailable", value: null } },
} as any;
describe("canonical report export", () => {
  it("labels exports with immutable snapshot identity and emits a zip XLSX", () => {
    expect(canonicalReportCsv(snapshot)).toContain(canonicalReportSnapshotId(snapshot));
    const bytes = canonicalReportXlsx(snapshot);
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    expect(new TextDecoder().decode(bytes)).toContain("Canonical report");
  });
});