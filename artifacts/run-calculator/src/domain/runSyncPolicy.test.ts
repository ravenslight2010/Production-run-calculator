import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES, type DayState, type RunMeta } from "../types";
import {
  acceptRemoteRunValueOnSync,
  adoptStrictlyNewerRemoteLifecycles,
  isRunValueStampAheadOfServerTime,
  isEmptyOverPopulated,
  reconcileOperationalIntentCanonical,
  serverOwnedApplicatorStockProgress,
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
  it("accepts a canonical peer edit instead of letting a fast local clock retain stale values", () => {
    const serverNow = 1_700_000_000_000;
    const clockFastByOneDay = serverNow + 86_400_000;
    const oldLocal = { ...DEFAULT_VALUES, casesNeeded: 120 };
    const updatedRemote = { ...DEFAULT_VALUES, casesNeeded: 240 };

    expect(isRunValueStampAheadOfServerTime(clockFastByOneDay, serverNow)).toBe(true);
    expect(acceptRemoteRunValueOnSync(
      updatedRemote,
      oldLocal,
      serverNow,
      clockFastByOneDay,
      serverNow,
    )).toBe(true);
    expect(acceptRemoteRunValueOnSync(
      updatedRemote,
      oldLocal,
      300,
      301,
      302,
    )).toBe(false);
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
  it("adopts server-proven pound depletion without allowing an older same-generation refill", () => {
    const remote = {
      ...DEFAULT_VALUES,
      app1Type: "Cheese",
      app1BatchLbs: 50,
      app1StockLbs: 49,
      app1StockAnchorNetSec: 12,
      app1StockCorrectionGeneration: 0,
      applicatorStockInitialized: true,
    };
    const payload: any = {
      runValues: { "stock-run": remote },
      runValuesUpdatedAt: { "stock-run": 200 },
      autoTrackCoordination: {
        version: 1,
        runs: {
          "stock-run": {
            "app1-stock": {
              generation: "stock-run:2",
              sequence: 1,
              nextDueAt: 20,
              acceptedRunValuesUpdatedAt: 200,
              acceptedEventId: "app1-stock-event",
              updatedAt: 190,
            },
          },
        },
      },
      autoTrackServerState: {
        netOwnership: {
          "stock-run": { "app1-stock": { generation: "stock-run:2", sequence: 1, updatedAt: 190 } },
        },
      },
    };
    const local = {
      ...DEFAULT_VALUES,
      app1Type: "Cheese",
      app1BatchLbs: 50,
      app1StockLbs: 50,
      app1StockAnchorNetSec: 0,
      app1StockCorrectionGeneration: 0,
      applicatorStockInitialized: true,
    };
    expect(serverOwnedApplicatorStockProgress(payload, "stock-run", local)).toMatchObject({
      app1StockLbs: 49,
      app1StockAnchorNetSec: 12,
      app1StockCorrectionGeneration: 0,
      applicatorStockInitialized: true,
    });
    expect(serverOwnedApplicatorStockProgress(payload, "other-run", local)).toBeNull();
    expect(serverOwnedApplicatorStockProgress(payload, "stock-run", {
      ...local,
      app1StockLbs: 48,
      app1StockAnchorNetSec: 13,
    })).toBeNull();
  });
  it("adopts canonical stock seeded by Start without changing historical made counters", () => {
    const canonicalValues = {
      ...DEFAULT_VALUES,
      app1Type: "Cheese",
      app1BatchLbs: 25,
      app1StockLbs: 50,
      app1StockAnchorNetSec: 0,
      app1StockCorrectionGeneration: 0,
      applicatorStockInitialized: true,
    };
    const result = reconcileOperationalIntentCanonical({
      dayState: day([{ id: "stock-run", brand: "", flavor: "", metaUpdatedAt: 100 }]),
      runValues: { ...DEFAULT_VALUES, app1BatchesMade: 7, app1StockLbs: 0 },
      runValuesUpdatedAt: { "stock-run": 10 },
      payload: {
        dayState: { runs: [{ id: "stock-run", brand: "", flavor: "", startedAt: 200, metaUpdatedAt: 201 }] },
        runValues: { "stock-run": canonicalValues },
        runValuesUpdatedAt: { "stock-run": 200 },
      },
      intent: { runId: "stock-run", action: "lifecycle", lifecycle: "start" },
      outcome: "accepted",
    });
    expect(result.runValues.app1StockLbs).toBe(50);
    expect(result.runValues.applicatorStockInitialized).toBe(true);
    expect(result.runValues.app1BatchesMade).toBe(7);
    expect(result.runValuesUpdatedAt["stock-run"]).toBe(200);
  });
});