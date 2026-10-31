import type { AutoTrackSchedule } from "@workspace/live-calc";
import type { SyncPayload } from "./types";

export const AUTO_TRACK_COORDINATION_EVENT = "run-calculator:auto-track-coordination";
export const AUTO_TRACK_SCHEDULE_EVENT = "run-calculator:auto-track-schedule";
export const DOUGH_TIMER_CONTROL_EVENT = "run-calculator:dough-timer-control";
export const DOUGH_TIMER_CONTROL_ADOPT_EVENT = "run-calculator:dough-timer-control-adopt";

export type DoughTimerControl = {
  runId: string; generation: string; pausedAt: number; resumeAt: number; updatedAt: number;
};
const DOUGH_CONTROLS_KEY = "run-calculator:dough-timer-controls";
const DOUGH_OWNER_KEY = `${DOUGH_CONTROLS_KEY}:owner`;
let doughControlOwner: string | undefined;
let adoptedDoughControls: SyncPayload["doughTimerControls"] | undefined;

/** Recovery projections belong to one authenticated scope, never the browser. */
export function setDoughTimerControlOwner(owner: string | undefined): void {
  if (doughControlOwner === owner) return;
  doughControlOwner = owner;
  adoptedDoughControls = undefined;
  if (typeof window !== "undefined") window.dispatchEvent(
    new CustomEvent(DOUGH_TIMER_CONTROL_ADOPT_EVENT, { detail: {} }),
  );
}

export function readDoughTimerControlProjection(): SyncPayload["doughTimerControls"] {
  if (adoptedDoughControls !== undefined) return adoptedDoughControls;
  try {
    if (!doughControlOwner || localStorage.getItem(DOUGH_OWNER_KEY) !== doughControlOwner) return undefined;
    const value: unknown = JSON.parse(localStorage.getItem(DOUGH_CONTROLS_KEY) ?? "null");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as SyncPayload["doughTimerControls"] : undefined;
  } catch { return undefined; }
}

/** Canonical controls replace optimistic browser controls, including absence. */
export function adoptDoughTimerControls(controls: SyncPayload["doughTimerControls"]): void {
  if (typeof window === "undefined") return;
  adoptedDoughControls = controls ?? {};
  try {
    localStorage.setItem(DOUGH_CONTROLS_KEY, JSON.stringify(controls ?? {}));
    if (doughControlOwner) localStorage.setItem(DOUGH_OWNER_KEY, doughControlOwner);
  } catch {
    // Display adoption remains usable when browser recovery storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(DOUGH_TIMER_CONTROL_ADOPT_EVENT, { detail: controls ?? {} }));
}

export function publishDoughTimerControl(localControl: DoughTimerControl, serverClockOffsetMs = 0): boolean {
  if (typeof window === "undefined") return false;
  const control = { ...localControl,
    pausedAt: localControl.pausedAt > 0 ? localControl.pausedAt + serverClockOffsetMs : 0,
    resumeAt: localControl.resumeAt > 0 ? localControl.resumeAt + serverClockOffsetMs : 0,
    updatedAt: localControl.updatedAt + serverClockOffsetMs,
  };
  // A mounted operational owner must first retain the command durably. Do not
  // display an optimistic hold if delivery/recovery could not be recorded.
  if (!window.dispatchEvent(new CustomEvent(DOUGH_TIMER_CONTROL_EVENT, {
    detail: control, cancelable: true,
  }))) return false;
  let controls: Record<string, Omit<DoughTimerControl, "runId">> = {};
  try {
    const raw = localStorage.getItem("run-calculator:dough-timer-controls");
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      controls = parsed as typeof controls;
    }
  } catch {}
  controls[control.runId] = {
    generation: control.generation, pausedAt: control.pausedAt,
    resumeAt: control.resumeAt, updatedAt: control.updatedAt,
  };
  try { localStorage.setItem("run-calculator:dough-timer-controls", JSON.stringify(controls)); } catch {}
  try { if (doughControlOwner) localStorage.setItem(DOUGH_OWNER_KEY, doughControlOwner); } catch {}
  return true;
}

export function publishAutoTrackCoordination(payload: Pick<SyncPayload, "autoTrackCoordination">): void {
  if (!payload.autoTrackCoordination || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTO_TRACK_COORDINATION_EVENT, {
    detail: payload.autoTrackCoordination,
  }));
}

/** Schedules are advisory freshness leases, not persisted client state. */
export function publishAutoTrackSchedule(schedule: unknown): void {
  if (!schedule || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTO_TRACK_SCHEDULE_EVENT, { detail: schedule }));
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

type CoordinationShape = Pick<SyncPayload, "autoTrackCoordination">;

/**
 * Map a server-computed schedule into the coordination shape consumed by
 * useAutoTrack. Derived entries receive sequence zero while canonical entries
 * retain the server sequence and due-now verdict.
 */
export function autoTrackScheduleToCoordination(
  schedule: AutoTrackSchedule,
): CoordinationShape {
  const channelStates: NonNullable<SyncPayload["autoTrackCoordination"]>["runs"][string] = {};
  for (const entry of schedule.entries) {
    channelStates[entry.channel] = {
      generation: schedule.generation,
      sequence: entry.sequence ?? 0,
      nextDueAt: entry.nextDueAt,
      dueNow: entry.dueNow,
      canonical: entry.canonical,
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