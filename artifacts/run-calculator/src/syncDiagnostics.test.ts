import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSyncDiagnosticReport,
  clearSyncDiagnostics,
  loadSyncDiagnostics,
  loadSyncMeasurements,
  recordSyncDiagnostic,
  recordSyncMeasurement,
  recordWakeRecoveryDiagnostic,
} from "./syncDiagnostics";
import { FIELD_CHECK_SIGNAL_EVENT } from "./fieldChecks";
import { syncWriteFieldCheck } from "./syncWriteResponse";

describe("sync diagnostics", () => {
  beforeEach(() => localStorage.clear());

  it("keeps diagnostics isolated by client-local date", () => {
    recordSyncDiagnostic({ kind: "ack", at: 1, date: "2026-08-21", message: "Saved", runId: "run-a" });
    recordSyncDiagnostic({ kind: "failure", at: 2, date: "2026-08-22", message: "Delayed" });
    expect(loadSyncDiagnostics("2026-08-21")).toHaveLength(1);
    expect(loadSyncDiagnostics("2026-08-21")[0].runId).toBe("run-a");
    expect(loadSyncDiagnostics("2026-08-22")).toHaveLength(1);
  });

  it("routes only explicitly classified write outcomes to sync acknowledgment checks", () => {
    const signals: Array<{ checkName: string; outcome: string; metrics?: Record<string, number> }> = [];
    const listener = (event: Event) => {
      signals.push((event as CustomEvent<typeof signals[number]>).detail);
    };
    window.addEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);

    recordSyncDiagnostic({
      kind: "failure",
      at: 1,
      date: "2026-08-21",
      message: "Live sync connection delayed",
    });
    recordSyncDiagnostic({
      kind: "failure",
      at: 2,
      date: "2026-08-21",
      message: "Partial peer update was unusable",
      response: "partial-fallback",
    });
    recordSyncDiagnostic({
      kind: "failure",
      at: 3,
      date: "2026-08-21",
      message: "Foreground recovery failed",
      response: "foreground-recovery",
    });
    recordSyncDiagnostic({
      kind: "failure",
      at: 4,
      date: "2026-08-21",
      message: "Sync write was rejected",
      response: "403",
      fieldCheck: { checkName: "sync-acknowledgment", outcome: "failure" },
    });
    recordSyncDiagnostic({
      kind: "ack",
      at: 5,
      date: "2026-08-21",
      message: "Server acknowledged the local change",
      fieldCheck: { checkName: "sync-acknowledgment", outcome: "success" },
    });
    recordSyncDiagnostic({
      kind: "ack",
      at: 6,
      date: "2026-08-21",
      message: "Server baseline received",
    });

    window.removeEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);
    expect(signals).toEqual([
      { checkName: "sync-acknowledgment", outcome: "failure", metrics: {} },
      { checkName: "sync-acknowledgment", outcome: "success", metrics: {} },
    ]);
    expect(loadSyncDiagnostics("2026-08-21")).toHaveLength(6);
  });

  it("emits manager acknowledgment signals for Home write outcomes", () => {
    const signals: Array<{ checkName: string; outcome: string }> = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ checkName: string; outcome: string }>).detail;
      signals.push({ checkName: detail.checkName, outcome: detail.outcome });
    };
    window.addEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);

    recordSyncDiagnostic({
      kind: "failure",
      at: 1,
      date: "2026-08-21",
      message: "Authorization rejected",
      fieldCheck: syncWriteFieldCheck({ ok: false, status: 403 }),
    });
    recordSyncDiagnostic({
      kind: "stale",
      at: 2,
      date: "2026-08-21",
      message: "Reset-stale write",
      fieldCheck: syncWriteFieldCheck({ ok: true, status: 200, stale: true }),
    });
    recordSyncDiagnostic({
      kind: "failure",
      at: 3,
      date: "2026-08-21",
      message: "Retries exhausted",
      fieldCheck: syncWriteFieldCheck({ ok: false, status: 0, retriesExhausted: true }),
    });
    recordSyncDiagnostic({
      kind: "ack",
      at: 4,
      date: "2026-08-21",
      message: "Local write acknowledged",
      fieldCheck: syncWriteFieldCheck({ ok: true, status: 200 }),
    });
    recordSyncDiagnostic({
      kind: "failure",
      at: 5,
      date: "2026-08-21",
      message: "Foreground recovery failed",
      response: "foreground-recovery",
    });
    recordSyncDiagnostic({
      kind: "failure",
      at: 6,
      date: "2026-08-21",
      message: "Partial peer update was unusable",
      response: "partial-fallback",
    });

    window.removeEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);
    expect(signals).toEqual([
      { checkName: "sync-acknowledgment", outcome: "failure" },
      { checkName: "sync-acknowledgment", outcome: "failure" },
      { checkName: "sync-acknowledgment", outcome: "failure" },
      { checkName: "sync-acknowledgment", outcome: "success" },
    ]);
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
    expect(report.attentionState).toBe("blocker");
    expect(report.nextAction).toBe("Retry latest retained change");
  });

  it("records complete and partial wire measurements and summarizes them", () => {
    recordSyncMeasurement("2026-08-21", {
      path: "complete", requestBytes: 1000, responseBytes: 3000,
      direction: "push", trigger: "edit", runCount: 32, changedRuns: 1,
      latencyMs: 40, mergeMs: 4, queueDelayMs: 120, ackLatencyMs: 40,
      serverQueueAgeMs: 7, retries: 1, converged: true,
    });
    recordSyncMeasurement("2026-08-21", {
      path: "partial", requestBytes: 250, responseBytes: 3000,
      direction: "peer", runCount: 32, changedRuns: 1,
      latencyMs: 20, mergeMs: 3, peerApplyMs: 3, retries: 0, converged: true,
    });
    expect(loadSyncMeasurements("2026-08-21")).toHaveLength(2);
    const report = buildSyncDiagnosticReport({
      date: "2026-08-21", status: "healthy", lastAcknowledgedAt: null,
      pendingCount: 0, failedCount: 0, diagnostics: [],
      measurements: loadSyncMeasurements("2026-08-21"),
    });
    expect(report.measurementSummary).toEqual([
      expect.objectContaining({
        path: "complete", requestBytes: 1000, retries: 1, convergedSamples: 1,
        averageQueueDelayMs: 120, averageAckLatencyMs: 40, averageServerQueueAgeMs: 7,
      }),
      expect.objectContaining({
        path: "partial", requestBytes: 250, retries: 0, convergedSamples: 1,
        averagePeerApplyMs: 3,
      }),
    ]);
    clearSyncDiagnostics("2026-08-21");
    expect(loadSyncMeasurements("2026-08-21")).toEqual([]);
  });

  it("records only bounded wake-recovery metadata", () => {
    recordWakeRecoveryDiagnostic({
      date: "2026-08-21",
      at: 10,
      attempts: 1_000,
      durationMs: Number.MAX_SAFE_INTEGER,
      trigger: "online",
      outcome: "non-retryable-http",
    });

    expect(loadSyncDiagnostics("2026-08-21")).toEqual([
      expect.objectContaining({
        kind: "failure",
        response: "wake-recovery:non-retryable-http",
        wakeRecovery: {
          attempts: 99,
          durationMs: 86_400_000,
          trigger: "online",
          outcome: "non-retryable-http",
        },
      }),
    ]);
  });
});
