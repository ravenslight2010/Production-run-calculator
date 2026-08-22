import { beforeEach, describe, expect, it } from "vitest";
import { buildSyncDiagnosticReport, clearSyncDiagnostics, loadSyncDiagnostics, recordSyncDiagnostic } from "./syncDiagnostics";

describe("sync diagnostics", () => {
  beforeEach(() => localStorage.clear());

  it("keeps diagnostics isolated by client-local date", () => {
    recordSyncDiagnostic({ kind: "ack", at: 1, date: "2026-08-21", message: "Saved", runId: "run-a" });
    recordSyncDiagnostic({ kind: "failure", at: 2, date: "2026-08-22", message: "Delayed" });
    expect(loadSyncDiagnostics("2026-08-21")).toHaveLength(1);
    expect(loadSyncDiagnostics("2026-08-21")[0].runId).toBe("run-a");
    expect(loadSyncDiagnostics("2026-08-22")).toHaveLength(1);
  });

  it("bounds recent activity and can clear one date without touching another", () => {
    for (let i = 0; i < 25; i++) {
      recordSyncDiagnostic({ kind: "peer", at: i, date: "2026-08-21", message: `Event ${i}` });
    }
    recordSyncDiagnostic({ kind: "ack", at: 99, date: "2026-08-22", message: "Other day" });
    expect(loadSyncDiagnostics("2026-08-21")).toHaveLength(20);
    clearSyncDiagnostics("2026-08-21");
    expect(loadSyncDiagnostics("2026-08-21")).toEqual([]);
    expect(loadSyncDiagnostics("2026-08-22")).toHaveLength(1);
  });

  it("builds a scoped report with counters, responses, and affected runs", () => {
    const events = [
      { id: "a", kind: "failure" as const, at: 1, date: "2026-08-21", message: "Failed", response: "network", runId: "run-a" },
      { id: "b", kind: "ack" as const, at: 2, date: "2026-08-21", message: "Acknowledged", response: "200", runId: "run-a" },
      { id: "c", kind: "failure" as const, at: 3, date: "2026-08-22", message: "Other date", response: "network", runId: "run-other" },
    ];
    const report = buildSyncDiagnosticReport({
      date: "2026-08-21",
      status: "delayed",
      lastAcknowledgedAt: 2,
      pendingCount: 3,
      failedCount: 1,
      diagnostics: events,
      exportedAt: 4,
    });
    expect(report.label).toBe("Sync diagnostic history");
    expect(report.scope).toBe("current facility");
    expect(report.productionDate).toBe("2026-08-21");
    expect(report.responseCategories).toEqual({ network: 1, "200": 1 });
    expect(report.affectedRunIds).toEqual(["run-a"]);
    expect(report.events).toHaveLength(2);
  });
});