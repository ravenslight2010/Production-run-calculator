import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoTrack } from "../useAutoTrack";

const form = {
  getValues: () => 0,
  setValue: () => undefined,
} as any;

function props(elapsedBatchSec: number, claimAutoTrackEvent: any, values = {}, overrides = {}) {
  return {
    runId: "sauce-auto",
    runGeneration: "started",
    runStatus: "running" as const,
    nowTime: new Date(1_700_000_000_000),
    elapsedBatchSec,
    calc: {
      ppm: 100,
      perTray: 60,
      perBatch: 600,
      traysNeeded: 0,
      batchesNeeded: 0,
      pressDone: false,
      casesInFreezer: 0,
      sauceDepletionSec: 10,
    },
    v: {
      casesPerSkid: 60, pizzasPerCase: 12, casesNeeded: 1000, freezerTime: 20,
      traysOnLine: 0, batchesReady: 0,
      sauceBarrelsMade: 0,
      sauceBarrelAnchorNetSec: 0,
      sauceBarrelCorrectionGeneration: 0,
      ...values,
    } as any,
    form,
    claimAutoTrackEvent,
    ...overrides,
  };
}

describe("useAutoTrack sauce barrel coordination", () => {
  it("catches up one canonical identity at a time and anchors at the scheduled due time", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(25, claim),
    });

    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim.mock.calls[0][0]).toMatchObject({
      channel: "sauce-barrel", dueAt: 10, nextDueAt: 20, sequence: 1,
      mutations: expect.arrayContaining([
        expect.objectContaining({ field: "sauceBarrelsMade", to: 1 }),
        expect.objectContaining({ field: "sauceBarrelAnchorNetSec", to: 10 }),
        expect.objectContaining({ field: "sauceBarrelCorrectionGeneration", to: 0 }),
      ]),
    });
    rerender(props(25, claim, { sauceBarrelsMade: 1, sauceBarrelAnchorNetSec: 10 }));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    expect(claim.mock.calls[1][0]).toMatchObject({ channel: "sauce-barrel", dueAt: 20, nextDueAt: 30, sequence: 2 });
  });

  it("retries a rejected transport with the exact same identity", async () => {
    const claim = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ outcome: "accepted", state: { generation: "sauce-auto:started", sequence: 1, nextDueAt: 20 }, values: {} });
    const { rerender } = renderHook((p) => useAutoTrack(p), { initialProps: props(10, claim) });
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    // The production clock supplies this render in-app after a failed request.
    rerender(props(11, claim));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    expect(claim.mock.calls[1][0].eventId).toBe(claim.mock.calls[0][0].eventId);
  });

  it.each([
    ["paused", { runStatus: "paused" }],
    ["completed", { calc: { ...props(10, null).calc, pressDone: true } }],
    ["preparing the next run", { nextRunPrepActive: true }],
    ["foreground reconciliation", { autoTrackBlocked: true }],
    ["passive cast display", { disabled: true }],
  ])("does not claim a barrel while %s", async (_label, overrides) => {
    const claim = vi.fn();
    renderHook(() => useAutoTrack(props(30, claim, {}, overrides) as any));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();
  });

  it("uses the corrected canonical anchor and generation for the next barrel identity", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    renderHook(() => useAutoTrack(props(40, claim, {
      sauceBarrelsMade: 2,
      sauceBarrelAnchorNetSec: 30,
      sauceBarrelCorrectionGeneration: 4,
    })));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim.mock.calls[0][0]).toMatchObject({
      dueAt: 40,
      correctionGeneration: 4,
      mutations: expect.arrayContaining([
        { field: "sauceBarrelsMade", from: 2, to: 3 },
        { field: "sauceBarrelAnchorNetSec", from: 30, to: 40 },
        { field: "sauceBarrelCorrectionGeneration", from: 4, to: 4 },
      ]),
    });
  });

  it("restarts the Sauce channel sequence after a synchronized correction", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(10, claim),
    });
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim.mock.calls[0][0].sequence).toBe(1);

    rerender(props(40, claim, {
      sauceBarrelsMade: 0,
      sauceBarrelAnchorNetSec: 30,
      sauceBarrelCorrectionGeneration: 1,
    }));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    expect(claim.mock.calls[1][0]).toMatchObject({
      sequence: 1,
      dueAt: 40,
      correctionGeneration: 1,
    });
    expect(claim.mock.calls[1][0].eventId).not.toBe(claim.mock.calls[0][0].eventId);
  });

  it("rebases an in-run cadence change from the canonical anchor", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: {},
    }));
    const calcAt = (sauceDepletionSec: number) => ({
      ...props(0, null).calc,
      sauceDepletionSec,
    });
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(35, claim, {
        sauceBarrelAnchorNetSec: 30,
      }, { calc: calcAt(10) }),
    });
    expect(claim).not.toHaveBeenCalled();

    rerender(props(45, claim, {
      sauceBarrelAnchorNetSec: 30,
    }, { calc: calcAt(20) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();

    rerender(props(50, claim, {
      sauceBarrelAnchorNetSec: 30,
    }, { calc: calcAt(20) }));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim.mock.calls[0][0]).toMatchObject({ dueAt: 50, nextDueAt: 70 });
  });
});