import type { SyncPayload } from "./types";

export const AUTO_TRACK_COORDINATION_EVENT = "run-calculator:auto-track-coordination";

export function publishAutoTrackCoordination(payload: Pick<SyncPayload, "autoTrackCoordination">): void {
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