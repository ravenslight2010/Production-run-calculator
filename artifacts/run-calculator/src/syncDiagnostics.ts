import {
  attentionStateForSeverity,
  nextActionForAttention,
  type AttentionState,
} from "./attentionStates";
export type SyncDiagnosticKind =
  | "connected"
  | "local"
  | "push"
  | "ack"
  | "peer"
  | "merge"
  | "stale"
  | "failure"
  | "reset";
export type SyncDiagnostic = {
  id: string;
  kind: SyncDiagnosticKind;
  at: number;
  date: string;
  message: string;
  runId?: string;
  response?: string;
};

export type SyncMeasurementPath = "complete" | "partial";

export type SyncDiagnosticMeasurement = {
  path: SyncMeasurementPath;
  requestBytes: number;
  responseBytes: number;
  latencyMs: number;
  mergeMs: number;
  retries: number;
  converged: boolean;
};

export type SyncMeasurementSummary = {
  path: SyncMeasurementPath;
  samples: number;
  requestBytes: number;
  responseBytes: number;
  averageLatencyMs: number;
  averageMergeMs: number;
  retries: number;
  convergedSamples: number;
};

export type SyncDiagnosticReport = {
  reportType: "sync-diagnostic-history";
  label: "Sync diagnostic history";
  scope: "current facility";
  productionDate: string;
  exportedAt: string;
  status: string;
  lastAcknowledgedAt: string | null;
  pendingCount: number;
  failedCount: number;
  attentionState: AttentionState;
  nextAction: string;
  responseCategories: Record<string, number>;
  affectedRunIds: string[];
  measurements: SyncDiagnosticMeasurement[];
  measurementSummary: SyncMeasurementSummary[];
  events: SyncDiagnostic[];
};

const MAX_EVENTS = 20;
const MAX_MEASUREMENTS = 50;

function key(date: string): string {
  return `run-calc-sync-diagnostics:${date}`;
}

function measurementKey(date: string): string {
  return `run-calc-sync-measurements:${date}`;
}

export function loadSyncDiagnostics(date: string): SyncDiagnostic[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(date)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SyncDiagnostic =>
      item && typeof item === "object" && typeof item.id === "string" &&
      typeof item.kind === "string" && typeof item.at === "number" &&
      typeof item.date === "string" && typeof item.message === "string",
    ).slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

export function recordSyncDiagnostic(event: Omit<SyncDiagnostic, "id">): SyncDiagnostic {
  const next: SyncDiagnostic = { ...event, id: `${event.at}-${Math.random().toString(36).slice(2, 8)}` };
  try {
    const events = [...loadSyncDiagnostics(event.date), next].slice(-MAX_EVENTS);
    localStorage.setItem(key(event.date), JSON.stringify(events));
  } catch {
    // Diagnostics must never interfere with production persistence.
  }
  return next;
}

export function clearSyncDiagnostics(date: string): void {
  try {
    localStorage.removeItem(key(date));
    localStorage.removeItem(measurementKey(date));
  } catch {}
}

export function loadSyncMeasurements(date: string): SyncDiagnosticMeasurement[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(measurementKey(date)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SyncDiagnosticMeasurement =>
      item && typeof item === "object" &&
      (item.path === "complete" || item.path === "partial") &&
      Number.isFinite(item.requestBytes) && item.requestBytes >= 0 &&
      Number.isFinite(item.responseBytes) && item.responseBytes >= 0 &&
      Number.isFinite(item.latencyMs) && item.latencyMs >= 0 &&
      Number.isFinite(item.mergeMs) && item.mergeMs >= 0 &&
      Number.isInteger(item.retries) && item.retries >= 0 &&
      typeof item.converged === "boolean",
    ).slice(-MAX_MEASUREMENTS);
  } catch {
    return [];
  }
}

export function recordSyncMeasurement(
  date: string,
  measurement: SyncDiagnosticMeasurement,
): SyncDiagnosticMeasurement {
  try {
    const measurements = [...loadSyncMeasurements(date), measurement].slice(-MAX_MEASUREMENTS);
    localStorage.setItem(measurementKey(date), JSON.stringify(measurements));
  } catch {
    // Diagnostics must never interfere with production persistence.
  }
  return measurement;
}

function summarizeMeasurements(
  measurements: SyncDiagnosticMeasurement[],
): SyncMeasurementSummary[] {
  return (["complete", "partial"] as const).flatMap((path) => {
    const samples = measurements.filter((measurement) => measurement.path === path);
    if (samples.length === 0) return [];
    return [{
      path,
      samples: samples.length,
      requestBytes: samples.reduce((total, sample) => total + sample.requestBytes, 0),
      responseBytes: samples.reduce((total, sample) => total + sample.responseBytes, 0),
      averageLatencyMs: samples.reduce((total, sample) => total + sample.latencyMs, 0) / samples.length,
      averageMergeMs: samples.reduce((total, sample) => total + sample.mergeMs, 0) / samples.length,
      retries: samples.reduce((total, sample) => total + sample.retries, 0),
      convergedSamples: samples.filter((sample) => sample.converged).length,
    }];
  });
}

export function buildSyncDiagnosticReport(input: {
  date: string;
  status: string;
  lastAcknowledgedAt: number | null;
  pendingCount: number;
  failedCount: number;
  diagnostics: SyncDiagnostic[];
  measurements?: SyncDiagnosticMeasurement[];
  exportedAt?: number;
}): SyncDiagnosticReport {
  const events = input.diagnostics.filter((event) => event.date === input.date);
  const measurements = input.measurements ?? [];
  const responseCategories: Record<string, number> = {};
  for (const event of events) {
    if (event.response) responseCategories[event.response] = (responseCategories[event.response] ?? 0) + 1;
  }
  return {
    reportType: "sync-diagnostic-history",
    label: "Sync diagnostic history",
    scope: "current facility",
    productionDate: input.date,
    exportedAt: new Date(input.exportedAt ?? Date.now()).toISOString(),
    status: input.status,
    lastAcknowledgedAt: input.lastAcknowledgedAt ? new Date(input.lastAcknowledgedAt).toISOString() : null,
    pendingCount: input.pendingCount,
    failedCount: input.failedCount,
    attentionState: input.failedCount > 0
      ? "blocker"
      : input.pendingCount > 0 || input.status === "delayed" || input.status === "retrying"
        ? "review"
        : input.status === "failed" ? attentionStateForSeverity("error") : "info",
    nextAction: input.failedCount > 0
      ? "Retry latest retained change"
      : input.pendingCount > 0 || input.status === "delayed" || input.status === "retrying"
        ? "Retry and confirm acknowledgment"
        : nextActionForAttention("info", "current"),
    responseCategories,
    affectedRunIds: [...new Set(events.map((event) => event.runId).filter((runId): runId is string => Boolean(runId)))],
    measurements,
    measurementSummary: summarizeMeasurements(measurements),
    events,
  };
}
