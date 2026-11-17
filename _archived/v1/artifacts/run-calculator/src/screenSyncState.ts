export type ScreenSyncStatus = "live" | "reconnecting" | "stale";

export type ScreenSyncState = {
  online: boolean;
  streamConnected: boolean;
  canonicalAdopted: boolean;
  recovering: boolean;
  stale: boolean;
};

export type ScreenSyncEvent =
  | { type: "stream-open" }
  | { type: "stream-error" }
  | { type: "stream-closed" }
  | { type: "canonical-adopted" }
  | { type: "recovery-started" }
  | { type: "recovery-succeeded" }
  | { type: "recovery-failed" }
  | { type: "online" }
  | { type: "offline" };

export function createScreenSyncState(online: boolean): ScreenSyncState {
  return {
    online,
    streamConnected: false,
    canonicalAdopted: false,
    recovering: false,
    stale: !online,
  };
}

export function reduceScreenSyncState(
  state: ScreenSyncState,
  event: ScreenSyncEvent,
): ScreenSyncState {
  switch (event.type) {
    case "stream-open":
      return {
        ...state,
        online: true,
        streamConnected: true,
        canonicalAdopted: false,
        stale: false,
      };
    case "stream-error":
      return {
        ...state,
        streamConnected: false,
        canonicalAdopted: false,
        stale: !state.online,
      };
    case "stream-closed":
      return {
        ...state,
        streamConnected: false,
        canonicalAdopted: false,
        stale: true,
      };
    case "canonical-adopted":
      return {
        ...state,
        online: true,
        canonicalAdopted: true,
        recovering: false,
        stale: false,
      };
    case "recovery-succeeded":
      return {
        ...state,
        online: true,
        canonicalAdopted: true,
        recovering: false,
        stale: false,
      };
    case "recovery-started":
      return {
        ...state,
        canonicalAdopted: false,
        recovering: true,
        stale: false,
      };
    case "recovery-failed":
      return {
        ...state,
        canonicalAdopted: false,
        recovering: false,
        stale: true,
      };
    case "offline":
      return {
        ...state,
        online: false,
        streamConnected: false,
        canonicalAdopted: false,
        recovering: false,
        stale: true,
      };
    case "online":
      return {
        ...state,
        online: true,
        canonicalAdopted: false,
        recovering: false,
        stale: false,
      };
  }
}

export function getScreenSyncStatus(state: ScreenSyncState): ScreenSyncStatus {
  if (!state.online || state.stale) return "stale";
  if (!state.streamConnected || !state.canonicalAdopted || state.recovering) {
    return "reconnecting";
  }
  return "live";
}
