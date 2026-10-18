import { act, renderHook, waitFor } from "@testing-library/react";
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
      sauceEffBarrel: 50,
    },
    v: {
      casesPerSkid: 60, pizzasPerCase: 12, casesNeeded: 1000, freezerTime: 20,
      traysOnLine: 0, batchesReady: 0,
      sauceBarrelsMade: 0,
      sauceBarrelAnchorNetSec: 0,
      sauceBarrelCorrectionGeneration: 0,
      sauceStockBarrels: 0,
      sauceStockAnchorNetSec: 0,
      sauceStockCorrectionGeneration: 0,
      sauceStockInitialized: true,
      sauceOzPerPizza: 4,
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

  it("reports Sauce failures and successful recovery using the same automatic barrel identity", async () => {
    const claim = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        outcome: "accepted",
        state: { generation: "sauce-auto:started", sequence: 1, nextDueAt: 20 },
        values: {},
      });
    const onFailure = vi.fn();
    const onSuccess = vi.fn();
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(10, claim, {}, { onAutomaticClaimFailure: onFailure, onAutomaticClaimSuccess: onSuccess }),
    });

    await waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    rerender(props(11, claim, {}, { onAutomaticClaimFailure: onFailure, onAutomaticClaimSuccess: onSuccess }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(onFailure.mock.calls[0][0].channel).toBe("sauce-barrel");
    expect(onFailure.mock.calls[0][1]).toBe("transient");
    expect(onSuccess.mock.calls[0][0].channel).toBe("sauce-barrel");
    expect(onSuccess.mock.calls[0][0].eventId).toBe(onFailure.mock.calls[0][0].eventId);
  });

  it.each(["accepted", "duplicate"] as const)(
    "adopts canonical progress exactly once for a %s response",
    async (outcome) => {
      const observedForm = { getValues: () => 0, setValue: vi.fn() } as any;
      const claim = vi.fn(async (request) => ({
        outcome,
        state: { generation: request.generation, sequence: request.sequence, nextDueAt: 20 },
        values: {
          sauceBarrelsMade: 4,
          sauceBarrelAnchorNetSec: 10,
          sauceBarrelCorrectionGeneration: 2,
        },
      }));
      renderHook(() => useAutoTrack(props(10, claim, {}, { form: observedForm })));

      await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(observedForm.setValue).toHaveBeenCalledWith(
        "sauceBarrelsMade",
        4,
        { shouldDirty: true },
      ));
      expect(observedForm.setValue.mock.calls.filter(([field]: [string]) => field === "sauceBarrelsMade"))
        .toHaveLength(1);
    },
  );

  it("pauses permanent Sauce failures until an explicit retry, retaining a rolled-back event ID", async () => {
    const permanentError = Object.assign(new Error("server detail must not be shown"), { retryable: false });
    const claim = vi.fn()
      .mockRejectedValueOnce(permanentError)
      .mockResolvedValueOnce({
        outcome: "accepted",
        state: { generation: "sauce-auto:started", sequence: 1, nextDueAt: 20 },
        values: { sauceBarrelsMade: 1, sauceBarrelAnchorNetSec: 10 },
      });
    const onFailure = vi.fn();
    const { result, rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(10, claim, {}, { onAutomaticClaimFailure: onFailure }),
    });

    await waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    expect(onFailure.mock.calls[0][1]).toBe("permanent");
    rerender(props(11, claim, {}, { onAutomaticClaimFailure: onFailure }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).toHaveBeenCalledTimes(1);

    act(() => result.current.retryFailedAutomaticClaim());
    rerender(props(12, claim, {}, { onAutomaticClaimFailure: onFailure }));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    expect(claim.mock.calls[1][0].eventId).toBe(claim.mock.calls[0][0].eventId);
  });

  it("retires a recorded conflict ID and retries only after operator action with a fresh event", async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce({
        outcome: "conflict",
        state: { generation: "sauce-auto:started", sequence: 0, nextDueAt: 20 },
        values: { sauceBarrelsMade: 0, sauceBarrelAnchorNetSec: 0 },
      })
      .mockResolvedValueOnce({
        outcome: "accepted",
        state: { generation: "sauce-auto:started", sequence: 1, nextDueAt: 20 },
        values: { sauceBarrelsMade: 1, sauceBarrelAnchorNetSec: 10 },
      });
    const onFailure = vi.fn();
    const { result, rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(10, claim, {}, { onAutomaticClaimFailure: onFailure }),
    });

    await waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    expect(onFailure.mock.calls[0][1]).toBe("permanent");
    rerender(props(11, claim, {}, { onAutomaticClaimFailure: onFailure }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).toHaveBeenCalledTimes(1);

    act(() => result.current.retryFailedAutomaticClaim());
    rerender(props(12, claim, {}, { onAutomaticClaimFailure: onFailure }));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    expect(claim.mock.calls[1][0].eventId).not.toBe(claim.mock.calls[0][0].eventId);
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

  it("suppresses only a fresh canonical explicit-not-due schedule and falls back for non-canonical schedules", async () => {
    const authoritative = vi.fn();
    const authoritativeHook = renderHook((p) => useAutoTrack(p), { initialProps: props(0, authoritative) as any });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("run-calculator:auto-track-schedule", {
        detail: {
          runId: "sauce-auto", generation: "sauce-auto:started", atMs: Date.now(),
          entries: [{ channel: "sauce-barrel", canonical: true, dueNow: false }],
        },
      }));
    });
    authoritativeHook.rerender(props(30, authoritative) as any);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(authoritative).not.toHaveBeenCalled();

    const fallback = vi.fn();
    const fallbackHook = renderHook((p) => useAutoTrack(p), { initialProps: props(0, fallback) as any });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("run-calculator:auto-track-schedule", {
        detail: {
          runId: "sauce-auto", generation: "sauce-auto:started", atMs: Date.now(),
          entries: [{ channel: "sauce-barrel", canonical: false, dueNow: false }],
        },
      }));
    });
    fallbackHook.rerender(props(30, fallback) as any);
    await waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));

    const stale = vi.fn();
    const staleHook = renderHook((p) => useAutoTrack(p), { initialProps: props(0, stale) as any });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("run-calculator:auto-track-schedule", {
        detail: {
          runId: "sauce-auto", generation: "sauce-auto:started", atMs: 0,
          entries: [{ channel: "sauce-barrel", canonical: true, dueNow: false }],
        },
      }));
    });
    staleHook.rerender(props(30, stale) as any);
    await waitFor(() => expect(stale).toHaveBeenCalledTimes(1));
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

  it("does not claim beyond the stable full-run Sauce requirement", async () => {
    const claim = vi.fn();
    renderHook(() => useAutoTrack(props(100, claim, {
      casesNeeded: 10,
      pizzasPerCase: 10,
      sauceOzPerPizza: 4,
      sauceBarrelsMade: 2,
      sauceBarrelAnchorNetSec: 10,
    })));
    // (10 × 10 × 4 / 16 + 30) / 50 = 1.1, so two barrels satisfy the run.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();
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

  it("initializes a legacy live run once through the stock-only claim", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    renderHook(() => useAutoTrack(props(25, claim, {
      sauceStockBarrels: 0,
      sauceStockAnchorNetSec: 0,
      sauceStockCorrectionGeneration: 0,
      sauceStockInitialized: false,
    })));

    await waitFor(() => expect(
      claim.mock.calls.some(([request]) => request.channel === "sauce-stock"),
    ).toBe(true));
    const stockClaim = claim.mock.calls.find(([request]) => request.channel === "sauce-stock")![0];
    expect(stockClaim).toMatchObject({
      channel: "sauce-stock",
      dueAt: 25,
      correctionGeneration: 0,
      mutations: expect.arrayContaining([
        { field: "sauceStockBarrels", from: 0, to: 2 },
        { field: "sauceStockAnchorNetSec", from: 0, to: 25 },
        { field: "sauceStockCorrectionGeneration", from: 0, to: 0 },
      ]),
    });
  });

  it("depletes exactly one tenth and rearms the stock countdown at its due anchor", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    renderHook(() => useAutoTrack(props(13, claim, {
      sauceStockBarrels: 1,
      sauceStockAnchorNetSec: 0,
      sauceStockCorrectionGeneration: 0,
      sauceStockInitialized: true,
    })));

    await waitFor(() => expect(
      claim.mock.calls.some(([request]) => request.channel === "sauce-stock"),
    ).toBe(true));
    const stockClaim = claim.mock.calls.find(([request]) => request.channel === "sauce-stock")![0];
    expect(stockClaim).toMatchObject({
      channel: "sauce-stock",
      dueAt: 12,
      nextDueAt: 24,
      mutations: expect.arrayContaining([
        { field: "sauceStockBarrels", from: 1, to: 0.9 },
        { field: "sauceStockAnchorNetSec", from: 0, to: 12 },
      ]),
    });
  });

  it.each([
    ["paused", { runStatus: "paused" }],
    ["completed", { calc: { ...props(30, null).calc, pressDone: true } }],
    ["ended", { runStatus: "ended" }],
    ["recovery suppression", { autoTrackBlocked: true }],
  ])("does not deplete stock while %s", async (_label, overrides) => {
    const claim = vi.fn();
    renderHook(() => useAutoTrack(props(30, claim, {
      sauceStockBarrels: 1,
      sauceStockInitialized: true,
    }, overrides) as any));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim.mock.calls.some(([request]) => request.channel === "sauce-stock")).toBe(false);
  });
});