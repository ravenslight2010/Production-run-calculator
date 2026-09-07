import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES, type DayState, type RunMeta } from "../types";
import {
  acceptRemoteRunValueOnSync,
  adoptStrictlyNewerRemoteLifecycles,
  isEmptyOverPopulated,
  shouldAtomicallyAdoptFirstSnapshot,
  stampDayStateMeta,
} from "./runSyncPolicy";

const day = (runs: RunMeta[]): DayState => ({ date: "2026-01-01", runs, currentIndex: 0 });

describe("run sync policy", () => {
  it("does not accept a transient blank over populated values even with a newer stamp", () => {
    const populated = { ...DEFAULT_VALUES, casesNeeded: 44 };
    expect(isEmptyOverPopulated(DEFAULT_VALUES, populated)).toBe(true);
    expect(acceptRemoteRunValueOnSync(DEFAULT_VALUES, populated, 200, 100)).toBe(false);
  });
  it("retains a paused lifecycle when a same-start remote copy regresses it", () => {
    const local = { id: "a", brand: "A", flavor: "", startedAt: 10, pausedAt: 20, metaUpdatedAt: 20 };
    const remote = { id: "a", brand: "A", flavor: "", startedAt: 10, metaUpdatedAt: 30 };
    expect(adoptStrictlyNewerRemoteLifecycles(day([local]), [remote]).dayState.runs[0]).toEqual(local);
  });
  it("stamps only changed lifecycle metadata and keeps durable stamps", () => {
    const stored = day([{ id: "a", brand: "A", flavor: "", metaUpdatedAt: 10 }]);
    expect(stampDayStateMeta(stored, stored, 20).runs[0].metaUpdatedAt).toBe(10);
    expect(stampDayStateMeta(day([{ id: "a", brand: "B", flavor: "", metaUpdatedAt: 10 }]), stored, 20).runs[0].metaUpdatedAt).toBe(20);
  });
  it("only atomically adopts the initial untouched seeded placeholder", () => {
    expect(shouldAtomicallyAdoptFirstSnapshot({ initialSnapshot: true, localRuns: [{ id: "a", brand: "", flavor: "", seeded: true }] })).toBe(true);
    expect(shouldAtomicallyAdoptFirstSnapshot({ initialSnapshot: true, hasLocalUserEdit: true, localRuns: [{ id: "a", brand: "", flavor: "", seeded: true }] })).toBe(false);
  });
});