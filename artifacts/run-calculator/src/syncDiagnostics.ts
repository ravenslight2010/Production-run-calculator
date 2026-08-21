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