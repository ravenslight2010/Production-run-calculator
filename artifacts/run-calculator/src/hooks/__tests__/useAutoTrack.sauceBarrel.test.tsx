import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoTrack } from "../useAutoTrack";
import { publishAutoTrackSchedule } from "../../autoTrackCoordinationClient";

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
      initialProps: props(5, claim),
    });

    publishAutoTrackSchedule({
      runId: "sauce-auto",
      generation: "sauce-auto:OTHER-RUN", // stale identity
      atMs: Date.now(),
      entries: [
        { channel: "sauce-barrel", dueAt: 10, dueNow: true, nextDueAt: 20, canonical: false },
      ],
    });

    rerender(props(6, claim));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();
  });

  it("keeps the local elapsed fallback when no schedule verdict has arrived", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(5, claim),
    });

    publishAutoTrackSchedule({
      runId: "sauce-auto",
      generation: "sauce-auto:OTHER-RUN", // stale identity
      atMs: Date.now(),
      entries: [
        { channel: "sauce-barrel", dueAt: 10, dueNow: true, nextDueAt: 20, canonical: false },
      ],
    });

    rerender(props(6, claim));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();
  });

  it("keeps the local elapsed fallback when no schedule verdict has arrived", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
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

  it("restarts the Sauce channel sequence after a synchronized correction", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(5, claim),
    });

    publishAutoTrackSchedule({
      runId: "sauce-auto",
      generation: "sauce-auto:OTHER-RUN", // stale identity
      atMs: Date.now(),
      entries: [
        { channel: "sauce-barrel", dueAt: 10, dueNow: true, nextDueAt: 20, canonical: false },
      ],
    });

    rerender(props(6, claim));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();
  });

  it("keeps the local elapsed fallback when no schedule verdict has arrived", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    const calcAt = (sauceDepletionSec: number) => ({
      ...props(0, null).calc,
      sauceDepletionSec,
    });
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(5, claim),
    });
    renderHook((p) => useAutoTrack(p), { initialProps: props(25, claim) });
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim.mock.calls[0][0]).toMatchObject({ channel: "sauce-barrel", dueAt: 10 });
  });
});

describe("server-owned net-second suppression (Task 1)", () => {
  it("skips the redundant local claim while a fresh server schedule says not due", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(5, claim), // local due at 10 net-seconds
    });

    publishAutoTrackSchedule({
      runId: "sauce-auto",
      generation: "sauce-auto:started",
      atMs: Date.now(),
      entries: [
        { channel: "sauce-barrel", dueAt: 10, dueNow: false, nextDueAt: 20, canonical: false },
      ],
    });

    // The verdict says NOT due; however far past the local due time it gets, a
    // connected tab must not re-fire its own claim (the server executes it).
    rerender(props(25, claim));
    rerender(props(26, claim));
    rerender(props(40, claim));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();
  });

  it("restores the local elapsed fallback after the fresh verdict goes stale", async () => {
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    }));
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(5, claim),
    });
    publishAutoTrackSchedule({
      runId: "sauce-auto",
      generation: "sauce-auto:started",
      atMs: Date.now(),
      entries: [
        { channel: "sauce-barrel", dueAt: 10, dueNow: false, nextDueAt: 20, canonical: false },
      ],
    });
    rerender(props(25, claim));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim).not.toHaveBeenCalled();

    // 46s later (3 missed heartbeats) the latch expires: local fallback resumes.
    rerender(props(26, claim, {}, { nowTime: new Date(1_700_000_000_000 + 46_000) }));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim.mock.calls[0][0]).toMatchObject({ channel: "sauce-barrel", dueAt: 10 });
  });
});
