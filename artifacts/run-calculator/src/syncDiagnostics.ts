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
  responseCategories: Record<string, number>;
  affectedRunIds: string[];
  events: SyncDiagnostic[];
};

const MAX_EVENTS = 20;

function key(date: string): string {
  return `run-calc-sync-diagnostics:${date}`;
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
  try { localStorage.removeItem(key(date)); } catch {}
}

export function buildSyncDiagnosticReport(input: {
  date: string;
  status: string;
  lastAcknowledgedAt: number | null;
  pendingCount: number;
  failedCount: number;
  diagnostics: SyncDiagnostic[];
  exportedAt?: number;
}): SyncDiagnosticReport {
  // The caller supplies diagnostics loaded for one client-local date. Do not
  // reach into storage here: keeping this pure makes the facility/date scope
  // explicit and prevents an export from accidentally including other history.
  const events = input.diagnostics.filter((event) => event.date === input.date);
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
    responseCategories,
    affectedRunIds: [...new Set(events.map((event) => event.runId).filter((runId): runId is string => Boolean(runId)))],
    events,
  };
}