import type { AutoTrackSchedule } from "@workspace/live-calc";
import type { SyncPayload } from "./types";

export const AUTO_TRACK_COORDINATION_EVENT = "run-calculator:auto-track-coordination";

type CoordinationShape = Pick<SyncPayload, "autoTrackCoordination">;

export function publishAutoTrackCoordination(payload: CoordinationShape): void {
  if (!payload.autoTrackCoordination || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTO_TRACK_COORDINATION_EVENT, {
    detail: payload.autoTrackCoordination,
  }));
}

export function subscribeAutoTrackCoordination(
  listener: (coordination: NonNullable<SyncPayload["autoTrackCoordination"]>) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = (event: Event) => {
    const coordination = (event as CustomEvent<SyncPayload["autoTrackCoordination"]>).detail;
    if (coordination) listener(coordination);
  };
  window.addEventListener(AUTO_TRACK_COORDINATION_EVENT, handle);
  return () => window.removeEventListener(AUTO_TRACK_COORDINATION_EVENT, handle);
}

/**
 * Map a server-computed auto-track schedule (refactor step 6a) into the
 * coordination shape useAutoTrack already adopts on AUTO_TRACK_COORDINATION_EVENT.
 * Each entry arms its channel's due ref to the server's due time; canonical
 * (coordination-echoed) entries also carry their sequence so peer tabs keep
 * their claim sequences in sync with the server.
 */
export function autoTrackScheduleToCoordination(
  schedule: AutoTrackSchedule,
): CoordinationShape {
  const channelStates: NonNullable<SyncPayload["autoTrackCoordination"]>["runs"][string] = {};
  for (const entry of schedule.entries) {
    channelStates[entry.channel] = {
      generation: schedule.generation,
      sequence: entry.sequence ?? 0,
      nextDueAt: entry.dueAt,
      dueNow: entry.dueNow,
      updatedAt: schedule.atMs,
    };
  }
  return {
    autoTrackCoordination: {
      version: 1,
      runs: {
        [schedule.runId]: channelStates,
      },
    },
  };
}

export function publishAutoTrackSchedule(schedule: AutoTrackSchedule): void {
  if (typeof window === "undefined") return;
  publishAutoTrackCoordination(autoTrackScheduleToCoordination(schedule));
}
