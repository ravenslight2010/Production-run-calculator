import { describe, expect, it } from "vitest";
import {
  createScreenSyncState,
  getScreenSyncStatus,
  reduceScreenSyncState,
} from "./screenSyncState";

describe("station screen sync status", () => {
  it("reports live only after an open stream has adopted its canonical baseline", () => {
    let state = createScreenSyncState(true);
    expect(getScreenSyncStatus(state)).toBe("reconnecting");

    state = reduceScreenSyncState(state, { type: "stream-open" });
    expect(getScreenSyncStatus(state)).toBe("reconnecting");

    state = reduceScreenSyncState(state, { type: "canonical-adopted" });
    expect(getScreenSyncStatus(state)).toBe("live");
  });

  it("stays reconnecting until a reopened stream adopts the newest baseline", () => {
    let state = reduceScreenSyncState(createScreenSyncState(true), { type: "stream-open" });
    state = reduceScreenSyncState(state, { type: "canonical-adopted" });
    expect(getScreenSyncStatus(state)).toBe("live");

    state = reduceScreenSyncState(state, { type: "stream-error" });
    expect(getScreenSyncStatus(state)).toBe("reconnecting");
    state = reduceScreenSyncState(state, { type: "recovery-started" });
    expect(getScreenSyncStatus(state)).toBe("reconnecting");
    state = reduceScreenSyncState(state, { type: "recovery-succeeded" });
    expect(getScreenSyncStatus(state)).toBe("reconnecting");

    state = reduceScreenSyncState(state, { type: "stream-open" });
    expect(getScreenSyncStatus(state)).toBe("reconnecting");
    state = reduceScreenSyncState(state, { type: "canonical-adopted" });
    expect(getScreenSyncStatus(state)).toBe("live");
  });

  it("can report live after an online wake only when the open stream's canonical pull succeeds", () => {
    let state = reduceScreenSyncState(createScreenSyncState(true), { type: "stream-open" });
    state = reduceScreenSyncState(state, { type: "canonical-adopted" });
    state = reduceScreenSyncState(state, { type: "offline" });
    state = reduceScreenSyncState(state, { type: "online" });
    expect(getScreenSyncStatus(state)).toBe("reconnecting");

    state = reduceScreenSyncState(state, { type: "stream-open" });
    state = reduceScreenSyncState(state, { type: "recovery-started" });
    state = reduceScreenSyncState(state, { type: "recovery-succeeded" });
    expect(getScreenSyncStatus(state)).toBe("live");
  });

  it("shows stale data offline or after a failed canonical recovery", () => {
    let state = reduceScreenSyncState(createScreenSyncState(true), { type: "stream-open" });
    state = reduceScreenSyncState(state, { type: "recovery-started" });
    state = reduceScreenSyncState(state, { type: "recovery-failed" });
    expect(getScreenSyncStatus(state)).toBe("stale");

    state = reduceScreenSyncState(state, { type: "online" });
    expect(getScreenSyncStatus(state)).toBe("reconnecting");
    state = reduceScreenSyncState(state, { type: "offline" });
    expect(getScreenSyncStatus(state)).toBe("stale");
  });
});
