import { describe, expect, it } from "vitest";
import { applyAutoTrackClaim, parseAutoTrackClaim, type AutoTrackClaim } from "./autoTrackCoordination";

const NOW = 1_800_000_000_000;

function claim(overrides: Partial<AutoTrackClaim> = {}): AutoTrackClaim {
  return {
    version: 1,
    runId: "run-1",
    channel: "tray-consume",
    generation: "run-1:2",
    sequence: 1,
    eventId: "client-a:tray-consume:1",
    dueAt: NOW - 10,
    nextDueAt: NOW + 1_000,
    baseUpdatedAt: 10,
    mutations: [{ field: "traysOnLine", from: 10, to: 9 }],
    ...overrides,
  };
}

describe("auto-track coordination", () => {
  it("validates allow-listed channels, fields, times, and bounded values", () => {
    expect(parseAutoTrackClaim(claim(), NOW)).toEqual(claim());
    expect(parseAutoTrackClaim(claim({
      channel: "hopper",
      mutations: [],
    }), NOW)).not.toBeNull();
    expect(parseAutoTrackClaim(claim({
      channel: "hopper",
    }), NOW)).toBeNull();
    expect(parseAutoTrackClaim(claim({
      mutations: [{ field: "batchesReady", from: 1, to: 0 }],
    }), NOW)).toBeNull();
    expect(parseAutoTrackClaim(claim({
      nextDueAt: NOW + 60 * 60_000 + 1,
    }), NOW)).toBeNull();
  });

  it("commits once and makes an identical retry idempotent", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: { "run-1": { traysOnLine: 10 } },
      runValuesUpdatedAt: { "run-1": 10 },
    };
    const first = applyAutoTrackClaim(stored, claim(), NOW);
    expect(first.outcome).toBe("accepted");
    expect(first.values.traysOnLine).toBe(9);
    const retry = applyAutoTrackClaim(first.data, claim(), NOW + 25);
    expect(retry.outcome).toBe("duplicate");
    expect(retry.values.traysOnLine).toBe(9);
  });

  it("rejects competing and skipped claims without changing the register", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: { "run-1": { traysOnLine: 10 } },
      runValuesUpdatedAt: { "run-1": 10 },
    };
    const first = applyAutoTrackClaim(stored, claim(), NOW);
    const competitor = applyAutoTrackClaim(first.data, claim({
      eventId: "client-b:tray-consume:1",
      mutations: [{ field: "traysOnLine", from: 10, to: 9 }],
    }), NOW + 5);
    expect(competitor.outcome).toBe("stale");
    expect(competitor.values.traysOnLine).toBe(9);
    const skipped = applyAutoTrackClaim(first.data, claim({
      sequence: 3,
      eventId: "client-a:tray-consume:3",
      mutations: [{ field: "traysOnLine", from: 9, to: 8 }],
    }), NOW + 10);
    expect(skipped.outcome).toBe("stale");
    expect(skipped.values.traysOnLine).toBe(9);
  });

  it("lets a manual correction invalidate a pending automatic write", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: { "run-1": { traysOnLine: 14 } },
      runValuesUpdatedAt: { "run-1": 10 },
    };
    const result = applyAutoTrackClaim(stored, claim(), NOW);
    expect(result.outcome).toBe("conflict");
    expect(result.values.traysOnLine).toBe(14);
  });

  it("rejects a claim after the canonical run lifecycle generation changes", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, pausedAt: NOW - 100, metaUpdatedAt: 3 }] },
      runValues: { "run-1": { traysOnLine: 10 } },
      runValuesUpdatedAt: { "run-1": 10 },
    };
    const result = applyAutoTrackClaim(stored, claim(), NOW);
    expect(result.outcome).toBe("stale");
    expect(result.values.traysOnLine).toBe(10);
  });

  it("rejects case tracking during a canonical manual-override window", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: { "run-1": { skidsCompleted: 0, casesOnCurrentSkid: 10 } },
      runValuesUpdatedAt: { "run-1": 10 },
      packagingProgress: {
        "run-1": {
          skidsCompleted: 0,
          casesOnCurrentSkid: 10,
          correctionGeneration: 4,
          manualOverrideUntil: NOW + 60_000,
          updatedAt: NOW - 1,
        },
      },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel: "case",
      correctionGeneration: 4,
      mutations: [{ field: "casesOnCurrentSkid", from: 10, to: 11 }],
    }), NOW);
    expect(result.outcome).toBe("conflict");
    expect(result.values.casesOnCurrentSkid).toBe(10);
  });

  it("rejects a queued claim when any ordinary edit advanced the canonical stamp", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: { "run-1": { traysOnLine: 10 } },
      runValuesUpdatedAt: { "run-1": 11 },
    };
    const result = applyAutoTrackClaim(stored, claim(), NOW);
    expect(result.outcome).toBe("conflict");
    expect(result.values.traysOnLine).toBe(10);
  });

  it("anchors an ahead-clock claim deadline to server time", () => {
    const clockAhead = 4 * 60 * 60_000;
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: { "run-1": { traysOnLine: 10 } },
      runValuesUpdatedAt: { "run-1": 10 },
    };
    const result = applyAutoTrackClaim(stored, claim({
      dueAt: NOW + clockAhead,
      nextDueAt: NOW + clockAhead + 1_000,
    }), NOW);
    expect(result.outcome).toBe("accepted");
    expect(result.channelState.nextDueAt).toBe(NOW + 1_000);
  });

  it("rejects a delayed case claim after an ended line is empty", () => {
    const endedAt = NOW - 5 * 60_000;
    const stored = {
      dayState: {
        runs: [{ id: "run-1", startedAt: NOW - 20 * 60_000, endedAt, metaUpdatedAt: 2 }],
      },
      runValues: {
        "run-1": {
          freezerTime: 5,
          skidsCompleted: 0,
          casesOnCurrentSkid: 10,
        },
      },
      runValuesUpdatedAt: { "run-1": 10 },
      packagingProgress: {
        "run-1": {
          skidsCompleted: 0,
          casesOnCurrentSkid: 10,
          correctionGeneration: 0,
          manualOverrideUntil: 0,
        },
      },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel: "case",
      correctionGeneration: 0,
      mutations: [{ field: "casesOnCurrentSkid", from: 10, to: 11 }],
    }), NOW);
    expect(result.outcome).toBe("stale");
    expect(result.values.casesOnCurrentSkid).toBe(10);
  });

  it("accepts a case claim while an ended line is still draining", () => {
    const endedAt = NOW - 4 * 60_000;
    const stored = {
      dayState: {
        runs: [{ id: "run-1", startedAt: NOW - 20 * 60_000, endedAt, metaUpdatedAt: 2 }],
      },
      runValues: {
        "run-1": {
          freezerTime: 5,
          skidsCompleted: 0,
          casesOnCurrentSkid: 10,
        },
      },
      runValuesUpdatedAt: { "run-1": 10 },
      packagingProgress: {
        "run-1": {
          skidsCompleted: 0,
          casesOnCurrentSkid: 10,
          correctionGeneration: 0,
          manualOverrideUntil: 0,
        },
      },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel: "case",
      correctionGeneration: 0,
      mutations: [{ field: "casesOnCurrentSkid", from: 10, to: 11 }],
    }), NOW);
    expect(result.outcome).toBe("accepted");
    expect(result.values.casesOnCurrentSkid).toBe(11);
  });
});