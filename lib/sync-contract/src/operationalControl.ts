/** Run-bound controls share the existing operational intent ledger/outbox. */
export type OperationalStoppage = {
  id: string;
  reason: string;
  startedAt: number;
  endedAt?: number;
  notes?: string;
  type?: "stop" | "pause" | "manual";
  stopTunnel?: boolean;
};

export type OperationalControl =
  | { kind: "auto-track"; enabled: boolean }
  | { kind: "dough-timer"; paused: boolean; durationMs?: number }
  | { kind: "pause-policy"; pauseId: string; stopTunnel: boolean }
  | { kind: "stoppages"; values: OperationalStoppage[] };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
const finiteTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15;

export function isOperationalControl(value: unknown): value is OperationalControl {
  if (!record(value)) return false;
  switch (value.kind) {
    case "auto-track":
      return Object.keys(value).every((key) => ["kind", "enabled"].includes(key))
        && typeof value.enabled === "boolean";
    case "dough-timer":
      return Object.keys(value).every((key) => ["kind", "paused", "durationMs"].includes(key))
        && typeof value.paused === "boolean"
        && (value.durationMs === undefined || (finiteTime(value.durationMs)
          && value.durationMs > 0 && value.durationMs <= 24 * 60 * 60_000 && value.paused));
    case "pause-policy":
      return Object.keys(value).every((key) => ["kind", "pauseId", "stopTunnel"].includes(key))
        && id(value.pauseId) && typeof value.stopTunnel === "boolean";
    case "stoppages": {
      if (Object.keys(value).some((key) => !["kind", "values"].includes(key))
        || !Array.isArray(value.values) || value.values.length > 200) return false;
      const ids = new Set<string>();
      return value.values.every((stop) => {
        if (!record(stop) || !id(stop.id) || ids.has(stop.id)
          || Object.keys(stop).some((key) =>
            !["id", "reason", "startedAt", "endedAt", "notes", "type", "stopTunnel"].includes(key))
          || typeof stop.reason !== "string" || stop.reason.length > 500
          || !finiteTime(stop.startedAt)
          || (stop.endedAt !== undefined && (!finiteTime(stop.endedAt) || stop.endedAt < stop.startedAt))
          || (stop.notes !== undefined && (typeof stop.notes !== "string" || stop.notes.length > 2000))
          || (stop.type !== undefined && !["stop", "pause", "manual"].includes(String(stop.type)))
          || (stop.stopTunnel !== undefined && typeof stop.stopTunnel !== "boolean")) return false;
        ids.add(stop.id);
        return true;
      });
    }
    default: return false;
  }
}
