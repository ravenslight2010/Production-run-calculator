import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import type { FormValues } from "../../types";
import { useAutoTrack, type AutoTrackChannel } from "../useAutoTrack";

const T0 = 1_600_000_000_000;

function makeForm() {
  const store: Record<string, number> = {
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    traysOnLine: 5,
    batchesReady: 2,
  };
  return {
    store,
    form: {
      getValues: vi.fn((key: string) => store[key] ?? 0),
      setValue: vi.fn((key: string, value: number) => {
        store[key] = value;
      }),
    } as unknown as UseFormReturn<FormValues>,
  };
}

describe("useAutoTrack server schedule freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses fresh wall-clock not-due verdicts and restores fallback after lease expiry", async () => {
    const { form, store } = makeForm();
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: {
        generation: request.generation,
        sequence: request.sequence,
        nextDueAt: request.nextDueAt,
      },
      values: Object.fromEntries(request.mutations.map((mutation) => [mutation.field, mutation.to])),
    }));
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, blocked: boolean): Props => ({
      runId: "server-schedule-wall",
      runGeneration: "started",
      runStatus: "running",
      nowTime: new Date(nowMs),
      elapsedBatchSec: (nowMs - T0) / 1000,
      calc: {
        ppm: 600,
        perTray: 10,
        perBatch: 10,
        traysNeeded: 2,
        batchesNeeded: 2,
        pressDone: false,
        casesInFreezer: 0,
      },
      v: {
        casesPerSkid: 10,
        pizzasPerCase: 10,
        casesNeeded: 100,
        freezerTime: 0,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
        sauceBarrelsMade: 0,
        sauceBarrelAnchorNetSec: 0,
        sauceBarrelCorrectionGeneration: 0,
        app1Type: "", app1OzPerPizza: 0, app1BatchLbs: 0, app1CheeseRecipe: [],
        app1BatchesMade: 0, app1BatchAnchorNetSec: 0, app1BatchCorrectionGeneration: 0,
        app2Type: "", app2OzPerPizza: 0, app2BatchLbs: 0, app2CheeseRecipe: [],
        app2BatchesMade: 0, app2BatchAnchorNetSec: 0, app2BatchCorrectionGeneration: 0,
        app3Type: "", app3OzPerPizza: 0, app3BatchLbs: 0, app3CheeseRecipe: [],
        app3BatchesMade: 0, app3BatchAnchorNetSec: 0, app3BatchCorrectionGeneration: 0,
        app4Type: "", app4OzPerPizza: 0, app4BatchLbs: 0, app4CheeseRecipe: [],
        app4BatchesMade: 0, app4BatchAnchorNetSec: 0, app4BatchCorrectionGeneration: 0,
      },
      form,
      machine: { spinSec: 1, hopperSec: 1 },
      autoTrackBlocked: blocked,
      autoTrackRebaseAfterBlock: false,
      claimAutoTrackEvent: claim,
    });

    const hook = renderHook((p: Props) => useAutoTrack(p), {
      initialProps: props(T0, true),
    });
    const channels: AutoTrackChannel[] = [
      "case", "tray-consume", "tray-produce",
      "batch-consume", "batch-produce", "hopper",
    ];
    act(() => {
      window.dispatchEvent(new CustomEvent("run-calculator:auto-track-schedule", {
        detail: {
          runId: "server-schedule-wall",
          generation: "server-schedule-wall:started",
          atMs: T0,
          entries: channels.map((channel) => ({ channel, canonical: true, dueNow: false })),
        },
      }));
      vi.setSystemTime(T0 + 2_000);
      hook.rerender(props(T0 + 2_000, false));
    });
    await act(async () => {});
    expect(claim).not.toHaveBeenCalled();

    await act(async () => {
      vi.setSystemTime(T0 + 31_001);
      hook.rerender(props(T0 + 31_001, false));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(claim).toHaveBeenCalled();
    expect(channels).toContain(claim.mock.calls[0][0].channel);
  });

  it("ignores a future schedule timestamp instead of extending suppression", async () => {
    const { form } = makeForm();
    const claim = vi.fn(async (request) => ({
      outcome: "accepted" as const,
      state: { generation: request.generation, sequence: request.sequence, nextDueAt: request.nextDueAt },
      values: Object.fromEntries(request.mutations.map((mutation) => [mutation.field, mutation.to])),
    }));
    const base = {
      runId: "future-schedule",
      runGeneration: "started",
      runStatus: "running" as const,
      elapsedBatchSec: 2,
      calc: { ppm: 600, perTray: 0, perBatch: 0, traysNeeded: 0, batchesNeeded: 0, pressDone: false, casesInFreezer: 0 },
      v: {
        casesPerSkid: 10, pizzasPerCase: 10, casesNeeded: 100, freezerTime: 0,
        traysOnLine: 0, batchesReady: 0, sauceBarrelsMade: 0,
        sauceBarrelAnchorNetSec: 0, sauceBarrelCorrectionGeneration: 0,
        app1Type: "", app1OzPerPizza: 0, app1BatchLbs: 0, app1CheeseRecipe: [], app1BatchesMade: 0, app1BatchAnchorNetSec: 0, app1BatchCorrectionGeneration: 0,
        app2Type: "", app2OzPerPizza: 0, app2BatchLbs: 0, app2CheeseRecipe: [], app2BatchesMade: 0, app2BatchAnchorNetSec: 0, app2BatchCorrectionGeneration: 0,
        app3Type: "", app3OzPerPizza: 0, app3BatchLbs: 0, app3CheeseRecipe: [], app3BatchesMade: 0, app3BatchAnchorNetSec: 0, app3BatchCorrectionGeneration: 0,
        app4Type: "", app4OzPerPizza: 0, app4BatchLbs: 0, app4CheeseRecipe: [], app4BatchesMade: 0, app4BatchAnchorNetSec: 0, app4BatchCorrectionGeneration: 0,
      },
      form,
      claimAutoTrackEvent: claim,
      autoTrackRebaseAfterBlock: false,
    };
    const hook = renderHook((p: Parameters<typeof useAutoTrack>[0]) => useAutoTrack(p), {
      initialProps: { ...base, nowTime: new Date(T0), autoTrackBlocked: true },
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("run-calculator:auto-track-schedule", {
        detail: {
          runId: "future-schedule",
          generation: "future-schedule:started",
          atMs: T0 + 60_000,
          entries: [{ channel: "case", canonical: true, dueNow: false }],
        },
      }));
      vi.setSystemTime(T0 + 2_000);
      hook.rerender({ ...base, nowTime: new Date(T0 + 2_000), autoTrackBlocked: false });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(claim).toHaveBeenCalled();
  });
});