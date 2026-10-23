import type {
  StationActivityEvidence,
  StationActivityId,
  StationActivitySource,
} from "@workspace/live-calc";

type StationActivityRow = {
  commandType: string;
  actionData: unknown;
  serverReceivedAt: Date | number;
  outcome?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteTimestamp(value: unknown): number | null {
  const timestamp = typeof value === "number" ? value : Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function manualSectionStation(section: string): StationActivityId | null {
  if (section === "dough") return "dough";
  if (section === "sauce" || section === "sauce-stock") return "sauce";
  if (section === "packaging") return "packaging";
  if (/^(app[1-4]|pep[12])$/.test(section)) return "frontline";
  return null;
}

function automaticChannelStation(channel: string): StationActivityId | null {
  if (/^(tray|batch)-(consume|produce)$/.test(channel) || channel === "hopper") return "dough";
  if (channel === "sauce-barrel") return "sauce";
  if (channel === "case") return "press";
  if (/^app[1-4]-batch$/.test(channel)) return "frontline";
  return null;
}

/**
 * Project only server-accepted operations. The activity map is a display
 * read-model field and is never written back into the day-state snapshot.
 */
export function deriveStationActivity(args: {
  runId: string;
  rows: StationActivityRow[];
  nowMs: number;
}): Partial<Record<StationActivityId, StationActivityEvidence>> {
  const latest: Partial<Record<StationActivityId, StationActivityEvidence>> = {};
  const add = (
    station: StationActivityId,
    eventAtServerMs: number | null,
    source: StationActivitySource,
  ) => {
    if (eventAtServerMs === null || eventAtServerMs > args.nowMs) return;
    if (!latest[station] || latest[station]!.eventAtServerMs < eventAtServerMs) {
      latest[station] = { runId: args.runId, eventAtServerMs, source };
    }
  };

  for (const row of args.rows) {
    if (row.outcome !== undefined && row.outcome !== "accepted") continue;
    const action = record(row.actionData);
    if (action.runId !== args.runId) continue;
    const eventAt = row.serverReceivedAt instanceof Date
      ? row.serverReceivedAt.getTime()
      : finiteTimestamp(row.serverReceivedAt);
    if (row.commandType === "auto-track") {
      const station = typeof action.channel === "string"
        ? automaticChannelStation(action.channel)
        : null;
      if (station) add(station, finiteTimestamp(eventAt), "automatic");
    } else if (row.commandType.startsWith("manual-section:")) {
      const station = manualSectionStation(row.commandType.slice("manual-section:".length));
      if (station) add(station, finiteTimestamp(eventAt), "manual");
    } else if (row.commandType === "station-activity-confirmation") {
      const station = action.station;
      if (station === "freezeTunnel" || station === "warehouse") {
        add(station, finiteTimestamp(eventAt), "confirmed");
      }
    }
  }

  return latest;
}
