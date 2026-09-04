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

function sauceMutations(made: number, anchor: number, correctionGeneration: number) {
  return [
    { field: "sauceBarrelsMade" as const, from: made, to: made + 1 },
    { field: "sauceBarrelAnchorNetSec" as const, from: anchor, to: anchor + 60 },
    {
      field: "sauceBarrelCorrectionGeneration" as const,
      from: correctionGeneration,
      to: correctionGeneration,
    },
  ];
}

function applicatorMutations(slot: 1 | 2 | 3 | 4, made: number, anchor: number, correctionGeneration: number) {
  const prefix = `app${slot}Batch` as const;
  return [
    { field: `${prefix}esMade` as const, from: made, to: made + 1 },
    { field: `${prefix}AnchorNetSec` as const, from: anchor, to: anchor + 60 },
    { field: `${prefix}CorrectionGeneration` as const, from: correctionGeneration, to: correctionGeneration },
  ];
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
      channel: "app1-batch",
      correctionGeneration: 0,
      dueAt: 60.25,
      nextDueAt: 120.5,
      mutations: [
        { field: "app1BatchesMade", from: 0, to: 1 },
        { field: "app1BatchAnchorNetSec", from: 0, to: 60.25 },
        { field: "app1BatchCorrectionGeneration", from: 0, to: 0 },
      ],
    }), NOW)).not.toBeNull();
    expect(parseAutoTrackClaim(claim({
      channel: "app1-batch",
      correctionGeneration: 0,
      dueAt: 60,
      nextDueAt: 120,
      mutations: [
        { field: "app1BatchesMade", from: 0, to: 2 },
        { field: "app1BatchAnchorNetSec", from: 0, to: 60 },
        { field: "app1BatchCorrectionGeneration", from: 0, to: 0 },
      ],
    }), NOW)).toBeNull();
    expect(parseAutoTrackClaim(claim({
      mutations: [{ field: "batchesReady", from: 1, to: 0 }],
    }), NOW)).toBeNull();
    expect(parseAutoTrackClaim(claim({
      channel: "sauce-barrel",
      correctionGeneration: 0,
      dueAt: 60,
      nextDueAt: 120,
      mutations: sauceMutations(0, 0, 0),
    }), NOW)).not.toBeNull();
    expect(parseAutoTrackClaim(claim({
      channel: "sauce-barrel",
      correctionGeneration: 0,
      dueAt: 60,
      nextDueAt: 120,
      mutations: [
        { field: "sauceBarrelsMade", from: 0, to: 2 },
        { field: "sauceBarrelAnchorNetSec", from: 0, to: 60 },
        { field: "sauceBarrelCorrectionGeneration", from: 0, to: 0 },
      ],
    }), NOW)).toBeNull();
    expect(parseAutoTrackClaim(claim({
      channel: "sauce-barrel",
      correctionGeneration: 1,
      dueAt: 60,
      nextDueAt: 120,
      mutations: sauceMutations(0, 0, 0),
    }), NOW)).toBeNull();
    expect(parseAutoTrackClaim(claim({
      channel: "sauce-barrel",
      correctionGeneration: 0,
      dueAt: 60,
      nextDueAt: 120,
      mutations: [
        { field: "sauceBarrelsMade", from: 0, to: 1 },
        { field: "sauceBarrelAnchorNetSec", from: 60, to: 59 },
        { field: "sauceBarrelCorrectionGeneration", from: 0, to: 0 },
      ],
    }), NOW)).toBeNull();
  });

  it("accepts a claim from a client clock advanced within the coordination horizon", () => {
    expect(
      parseAutoTrackClaim(
        claim({
          dueAt: NOW + 15 * 60_000,
          nextDueAt: NOW + 15 * 60_000 + 6_000,
        }),
        NOW,
      ),
    ).not.toBeNull();
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

  it("does not let a client timestamp bypass the canonical manual-override window", () => {
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
    const parsed = parseAutoTrackClaim({
      ...claim({
        channel: "case",
        correctionGeneration: 4,
        mutations: [{ field: "casesOnCurrentSkid", from: 10, to: 11 }],
      }),
      clientNow: NOW + 120_000,
    }, NOW);
    expect(parsed).not.toBeNull();
    const result = applyAutoTrackClaim(stored, parsed!, NOW);
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

  it("accepts a configured sauce barrel once and exposes canonical inventory work", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: {
        "run-1": {
          sauceBarrelsMade: 0,
          sauceBarrelAnchorNetSec: 0,
          sauceBarrelCorrectionGeneration: 0,
          sauceBarrelLbs: 200,
          frontlineRecipeName: "Tomato Sauce",
        },
      },
      runValuesUpdatedAt: { "run-1": 10 },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel: "sauce-barrel",
      eventId: "client-a:sauce-barrel:1",
      correctionGeneration: 0,
      mutations: sauceMutations(0, 0, 0),
    }), NOW);
    expect(result.outcome).toBe("accepted");
    expect(result.values.sauceBarrelsMade).toBe(1);
    expect(result.values.sauceBarrelAnchorNetSec).toBe(60);
    expect(result.values.sauceBarrelCorrectionGeneration).toBe(0);
    expect(result.inventoryConsumption).toEqual({
      kind: "sauce-barrel",
      runId: "run-1",
      barrelIndex: 1,
      eventId: "client-a:sauce-barrel:1",
      itemKey: "ingredient:Tomato Sauce:lbs",
      qty: 200,
    });
  });

  it("rejects sauce progress after a manual snapshot correction", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: {
        "run-1": {
          sauceBarrelsMade: 0,
          sauceBarrelAnchorNetSec: 0,
          sauceBarrelCorrectionGeneration: 1,
          sauceBarrelLbs: 200,
          frontlineRecipeName: "Tomato Sauce",
        },
      },
      runValuesUpdatedAt: { "run-1": 11 },
      autoTrackCoordination: {
        version: 1,
        runs: {
          "run-1": {
            "sauce-barrel": {
              generation: "manual:11",
              sequence: 0,
              nextDueAt: NOW,
              updatedAt: NOW,
            },
          },
        },
      },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel: "sauce-barrel",
      baseUpdatedAt: 11,
      correctionGeneration: 0,
      mutations: sauceMutations(0, 0, 0),
    }), NOW);
    expect(result.outcome).toBe("conflict");
    expect(result.inventoryConsumption).toBeUndefined();
  });

  it("coordinates every applicator batch channel without inventory consumption", () => {
    for (const slot of [1, 2, 3, 4] as const) {
      const channel = `app${slot}-batch` as const;
      const stored = {
        dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
        runValues: {
          "run-1": {
            [`app${slot}BatchesMade`]: 0,
            [`app${slot}BatchAnchorNetSec`]: 0,
            [`app${slot}BatchCorrectionGeneration`]: 0,
          },
        },
        runValuesUpdatedAt: { "run-1": 10 },
      };
      const event = claim({
        channel,
        eventId: `client-a:${channel}:1`,
        correctionGeneration: 0,
        dueAt: 60,
        nextDueAt: 120,
        mutations: applicatorMutations(slot, 0, 0, 0),
      });
      const accepted = applyAutoTrackClaim(stored, event, NOW);
      expect(accepted.outcome).toBe("accepted");
      expect(accepted.values[`app${slot}BatchesMade`]).toBe(1);
      expect(accepted.inventoryConsumption).toBeUndefined();
      const duplicate = applyAutoTrackClaim(accepted.data, event, NOW + 1);
      expect(duplicate.outcome).toBe("duplicate");
      expect(duplicate.values[`app${slot}BatchesMade`]).toBe(1);
    }
  });

  it.each([
    {
      channel: "app1-batch" as const,
      values: {
        app1BatchesMade: 0,
        app1BatchAnchorNetSec: 0,
        app1BatchCorrectionGeneration: 0,
      },
      mutations: applicatorMutations(1, 0, 0, 0),
    },
    {
      channel: "sauce-barrel" as const,
      values: {
        sauceBarrelsMade: 0,
        sauceBarrelAnchorNetSec: 0,
        sauceBarrelCorrectionGeneration: 0,
        frontlineRecipeName: "Tomato Sauce",
        frontlineRecipe: [],
        sauceBarrelLbs: 200,
      },
      mutations: sauceMutations(0, 0, 0),
    },
  ])("keeps a $channel claim scoped to its owning run", ({ channel, values, mutations }) => {
    const run2Values = { ...values };
    const stored = {
      dayState: {
        runs: [
          { id: "run-1", startedAt: 1, metaUpdatedAt: 2 },
          { id: "run-2", startedAt: 1, metaUpdatedAt: 7 },
        ],
      },
      runValues: { "run-1": values, "run-2": run2Values },
      runValuesUpdatedAt: { "run-1": 10, "run-2": 20 },
      autoTrackCoordination: {
        version: 1,
        runs: {
          "run-2": {
            [channel]: {
              generation: "run-2:7",
              sequence: 4,
              nextDueAt: 300,
              acceptedEventId: "run-2:event:4",
              updatedAt: NOW - 1,
            },
          },
        },
      },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel,
      generation: "run-1:2",
      eventId: `run-1:${channel}:1`,
      correctionGeneration: 0,
      dueAt: 60,
      nextDueAt: 120,
      mutations,
    }), NOW);

    expect(result.outcome).toBe("accepted");
    expect((result.data.runValues as any)["run-2"]).toEqual(run2Values);
    expect((result.data.runValuesUpdatedAt as any)["run-2"]).toBe(20);
    expect((result.data.autoTrackCoordination as any).runs["run-2"][channel])
      .toEqual(stored.autoTrackCoordination.runs["run-2"][channel]);
  });

  it.each([
    { channel: "app1-batch" as const, mutations: applicatorMutations(1, 0, 0, 0) },
    { channel: "sauce-barrel" as const, mutations: sauceMutations(0, 0, 0) },
  ])("rejects a stale $channel claim after run selection lifecycle changes without touching either register", ({ channel, mutations }) => {
    const stored = {
      dayState: {
        runs: [
          { id: "run-1", startedAt: 1, metaUpdatedAt: 9 },
          { id: "run-2", startedAt: 1, metaUpdatedAt: 7 },
        ],
      },
      runValues: {
        "run-1": {
          ...(channel === "sauce-barrel"
            ? { sauceBarrelsMade: 0, sauceBarrelAnchorNetSec: 0, sauceBarrelCorrectionGeneration: 0 }
            : { app1BatchesMade: 0, app1BatchAnchorNetSec: 0, app1BatchCorrectionGeneration: 0 }),
        },
        "run-2": { sentinel: 42 },
      },
      runValuesUpdatedAt: { "run-1": 10, "run-2": 20 },
      autoTrackCoordination: {
        version: 1,
        runs: {
          "run-1": { [channel]: { generation: "run-1:2", sequence: 0, nextDueAt: 60, updatedAt: NOW - 2 } },
          "run-2": { [channel]: { generation: "run-2:7", sequence: 3, nextDueAt: 240, updatedAt: NOW - 1 } },
        },
      },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel,
      generation: "run-1:2",
      eventId: `run-1:${channel}:1`,
      correctionGeneration: 0,
      dueAt: 60,
      nextDueAt: 120,
      mutations,
    }), NOW);

    expect(result.outcome).toBe("stale");
    expect(result.data).toEqual(stored);
  });

  it("rejects an applicator tick after a manual correction invalidates its channel", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: {
        "run-1": {
          app2BatchesMade: 3,
          app2BatchAnchorNetSec: 180,
          app2BatchCorrectionGeneration: 1,
        },
      },
      runValuesUpdatedAt: { "run-1": 11 },
      autoTrackCoordination: {
        version: 1,
        runs: {
          "run-1": {
            "app2-batch": { generation: "manual:11", sequence: 0, nextDueAt: 0, updatedAt: NOW },
          },
        },
      },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel: "app2-batch",
      baseUpdatedAt: 11,
      correctionGeneration: 0,
      dueAt: 60,
      nextDueAt: 120,
      mutations: applicatorMutations(2, 0, 0, 0),
    }), NOW);
    expect(result.outcome).toBe("conflict");
    expect(result.values.app2BatchesMade).toBe(3);
  });

  it("does not issue inventory work for unconfigured sauce tracking", () => {
    const stored = {
      dayState: { runs: [{ id: "run-1", startedAt: 1, metaUpdatedAt: 2 }] },
      runValues: {
        "run-1": {
          sauceBarrelsMade: 0,
          sauceBarrelAnchorNetSec: 0,
          sauceBarrelCorrectionGeneration: 0,
        },
      },
      runValuesUpdatedAt: { "run-1": 10 },
    };
    const result = applyAutoTrackClaim(stored, claim({
      channel: "sauce-barrel",
      correctionGeneration: 0,
      mutations: sauceMutations(0, 0, 0),
    }), NOW);
    expect(result.outcome).toBe("conflict");
    expect(result.values.sauceBarrelsMade).toBe(0);
    expect(result.inventoryConsumption).toBeUndefined();
  });
});