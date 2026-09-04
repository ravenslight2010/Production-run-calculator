import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAutoTrack } from "../useAutoTrack";

function form() {
  const values: Record<string, number> = {};
  return {
    values,
    form: {
      getValues: (key: string) => values[key] ?? 0,
      setValue: (key: string, value: number) => { values[key] = value; },
    } as any,
  };
}

const calc = {
  ppm: 100, perTray: 50, perBatch: 500, traysNeeded: 1, batchesNeeded: 1,
  pressDone: false, casesInFreezer: 0, app1Batches: 3, app2Batches: 3,
};

function values(overrides: Record<string, unknown> = {}) {
  return {
    casesPerSkid: 10, pizzasPerCase: 10, casesNeeded: 100, freezerTime: 0,
    traysOnLine: 0, batchesReady: 0, sauceBarrelsMade: 0,
    sauceBarrelAnchorNetSec: 0, sauceBarrelCorrectionGeneration: 0,
    app1Type: "Mozzarella", app1OzPerPizza: 4, app1BatchLbs: 25, app1CheeseRecipe: [],
    app1BatchesMade: 0, app1BatchAnchorNetSec: 0, app1BatchCorrectionGeneration: 0,
    app2Type: "Cheese Mix", app2OzPerPizza: 4, app2BatchLbs: 25, app2CheeseRecipe: [],
    app2BatchesMade: 0, app2BatchAnchorNetSec: 0, app2BatchCorrectionGeneration: 0,
    app3Type: "", app3OzPerPizza: 0, app3BatchLbs: 0, app3CheeseRecipe: [],
    app3BatchesMade: 0, app3BatchAnchorNetSec: 0, app3BatchCorrectionGeneration: 0,
    app4Type: "", app4OzPerPizza: 0, app4BatchLbs: 0, app4CheeseRecipe: [],
    app4BatchesMade: 0, app4BatchAnchorNetSec: 0, app4BatchCorrectionGeneration: 0,
    ...overrides,
  } as any;
}

describe("useAutoTrack applicator batches", () => {
  it("claims an eligible app at its own fractional cadence and excludes mix rows", async () => {
    const { form: fakeForm, values: stored } = form();
    const claim = vi.fn(async (event: any) => ({
      outcome: "accepted" as const,
      state: { generation: event.generation, sequence: event.sequence, nextDueAt: event.nextDueAt },
      values: Object.fromEntries(event.mutations.map((m: any) => [m.field, m.to])),
    }));
    // 25 lb × 16 / 7 oz / 100 ppm × 60 = 34.2857... seconds.
    renderHook(() => useAutoTrack({
      runId: "app-run", runStatus: "running", nowTime: new Date(1_700_000_000_000),
      elapsedBatchSec: 35, calc, v: values({ app1OzPerPizza: 7 }), form: fakeForm, claimAutoTrackEvent: claim,
    }));
    await waitFor(() => expect(claim.mock.calls.some(([event]) => event.channel === "app1-batch")).toBe(true));
    const appClaim = claim.mock.calls.map(([event]) => event).find((event) => event.channel === "app1-batch");
    expect(appClaim.channel).toBe("app1-batch");
    expect(appClaim.dueAt).toBeCloseTo(240 / 7);
    expect(stored.app1BatchesMade).toBe(1);
    expect(stored.app2BatchesMade).toBeUndefined();
  });

  it("does not apply an in-flight acknowledgement after a manual correction", async () => {
    const { form: fakeForm, values: stored } = form();
    stored.app1BatchesMade = 0;
    stored.app1BatchAnchorNetSec = 0;
    stored.app1BatchCorrectionGeneration = 0;
    const resolvers = new Map<string, (result: any) => void>();
    const claim = vi.fn((event: any) => new Promise((resolve) => {
      resolvers.set(event.channel, resolve);
    }));
    renderHook(() => useAutoTrack({
      runId: "manual-race", runStatus: "running", nowTime: new Date(),
      elapsedBatchSec: 61, calc, v: values(), form: fakeForm, claimAutoTrackEvent: claim,
    }));
    await waitFor(() => expect(resolvers.has("app1-batch")).toBe(true));
    const event = claim.mock.calls.map(([candidate]) => candidate)
      .find((candidate) => candidate.channel === "app1-batch");

    // Simulate the Frontline +/- handler changing the canonical local baseline
    // before the server's older automatic acknowledgement resolves.
    stored.app1BatchesMade = 4;
    stored.app1BatchAnchorNetSec = 61;
    stored.app1BatchCorrectionGeneration = 1;
    resolvers.get("app1-batch")!({
      outcome: "accepted",
      state: { generation: event.generation, sequence: event.sequence, nextDueAt: event.nextDueAt },
      values: Object.fromEntries(event.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(stored.app1BatchesMade).toBe(4);
    expect(stored.app1BatchAnchorNetSec).toBe(61);
    expect(stored.app1BatchCorrectionGeneration).toBe(1);
  });

  it("does not apply run A's in-flight acknowledgement after switching to run B", async () => {
    const { form: fakeForm, values: stored } = form();
    const resolvers = new Map<string, (result: any) => void>();
    const claim = vi.fn((event: any) => new Promise((resolve) => {
      resolvers.set(event.runId, resolve);
    }));
    const props = {
      runId: "run-a",
      runGeneration: "1",
      runStatus: "running" as const,
      nowTime: new Date(),
      elapsedBatchSec: 61,
      calc,
      v: values(),
      form: fakeForm,
      claimAutoTrackEvent: claim,
    };
    const { rerender } = renderHook(
      ({ input }) => useAutoTrack(input),
      { initialProps: { input: props } },
    );
    await waitFor(() => expect(resolvers.has("run-a")).toBe(true));
    rerender({
      input: {
        ...props,
        runId: "run-b",
        runGeneration: "2",
        elapsedBatchSec: 0,
        v: values({ app1BatchesMade: 7, app1BatchAnchorNetSec: 0 }),
      },
    });
    stored.app1BatchesMade = 7;
    const event = claim.mock.calls.map(([candidate]) => candidate)
      .find((candidate) => candidate.runId === "run-a");
    resolvers.get("run-a")!({
      outcome: "accepted",
      state: { generation: event.generation, sequence: event.sequence, nextDueAt: event.nextDueAt },
      values: Object.fromEntries(event.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(stored.app1BatchesMade).toBe(7);
  });

  it("does not apply run A's in-flight Sauce acknowledgement after switching to run B", async () => {
    const { form: fakeForm, values: stored } = form();
    const resolvers = new Map<string, (result: any) => void>();
    const claim = vi.fn((event: any) => new Promise((resolve) => {
      resolvers.set(event.runId, resolve);
    }));
    const props = {
      runId: "sauce-run-a",
      runGeneration: "1",
      runStatus: "running" as const,
      nowTime: new Date(),
      elapsedBatchSec: 61,
      calc: { ...calc, sauceDepletionSec: 60 },
      v: values(),
      form: fakeForm,
      claimAutoTrackEvent: claim,
    };
    const { rerender } = renderHook(
      ({ input }) => useAutoTrack(input),
      { initialProps: { input: props } },
    );
    await waitFor(() => expect(resolvers.has("sauce-run-a")).toBe(true));
    rerender({
      input: {
        ...props,
        runId: "sauce-run-b",
        runGeneration: "2",
        elapsedBatchSec: 0,
        v: values({ sauceBarrelsMade: 5 }),
      },
    });
    stored.sauceBarrelsMade = 5;
    const event = claim.mock.calls.map(([candidate]) => candidate)
      .find((candidate) => candidate.runId === "sauce-run-a" && candidate.channel === "sauce-barrel");
    resolvers.get("sauce-run-a")!({
      outcome: "accepted",
      state: { generation: event.generation, sequence: event.sequence, nextDueAt: event.nextDueAt },
      values: Object.fromEntries(event.mutations.map((mutation: any) => [mutation.field, mutation.to])),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(stored.sauceBarrelsMade).toBe(5);
  });

  it.each(["pending", "paused", "ended"] as const)(
    "does not emit applicator claims while the run is %s",
    async (runStatus) => {
      const { form: fakeForm } = form();
      const claim = vi.fn();
      renderHook(() => useAutoTrack({
        runId: `${runStatus}-run`,
        runStatus,
        endedAt: runStatus === "ended" ? Date.now() : null,
        nowTime: new Date(),
        elapsedBatchSec: 61,
        calc,
        v: values({ freezerTime: runStatus === "ended" ? 30 : 0 }),
        form: fakeForm,
        claimAutoTrackEvent: claim,
      }));
      await Promise.resolve();
      expect(claim.mock.calls.some(([event]) => event.channel.startsWith("app"))).toBe(false);
    },
  );

  it("does not claim while a manual correction suppression window is open", async () => {
    const { form: fakeForm } = form();
    const claim = vi.fn();
    const suppression = { current: Date.now() + 60_000 };
    renderHook(() => useAutoTrack({
      runId: "suppressed-app", runStatus: "running", nowTime: new Date(),
      elapsedBatchSec: 61, calc, v: values(), form: fakeForm, claimAutoTrackEvent: claim,
      externalAutoSuppressRef: suppression,
    }));
    await Promise.resolve();
    expect(claim).not.toHaveBeenCalled();
  });
});