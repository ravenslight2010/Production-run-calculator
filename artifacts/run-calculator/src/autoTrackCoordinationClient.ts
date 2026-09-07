import type { SyncPayload } from "./types";

export const AUTO_TRACK_COORDINATION_EVENT = "run-calculator:auto-track-coordination";
export const AUTO_TRACK_SCHEDULE_EVENT = "run-calculator:auto-track-schedule";
export const DOUGH_TIMER_CONTROL_EVENT = "run-calculator:dough-timer-control";
export const DOUGH_TIMER_CONTROL_ADOPT_EVENT = "run-calculator:dough-timer-control-adopt";

export type DoughTimerControl = {
  runId: string; generation: string; pausedAt: number; resumeAt: number; updatedAt: number;
};

export function publishDoughTimerControl(control: DoughTimerControl): void {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem("run-calculator:dough-timer-controls");
  let controls: Record<string, Omit<DoughTimerControl, "runId">> = {};
  try { controls = raw ? JSON.parse(raw) : {}; } catch {}
  controls[control.runId] = {
    generation: control.generation, pausedAt: control.pausedAt,
    resumeAt: control.resumeAt, updatedAt: control.updatedAt,
  };
  localStorage.setItem("run-calculator:dough-timer-controls", JSON.stringify(controls));
  window.dispatchEvent(new CustomEvent(DOUGH_TIMER_CONTROL_EVENT, { detail: control }));
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