import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAutoTrack } from "../useAutoTrack";
import { publishAutoTrackSchedule } from "../../autoTrackCoordinationClient";

function form() {
  const values: Record<string, number> = { traysOnLine: 10, batchesReady: 4 };
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
    traysOnLine: 10, batchesReady: 4, sauceBarrelsMade: 0,
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

function props(elapsedBatchSec: number, claim: any, valuesOverrides = {}, propOverrides = {}) {
  return {
    runId: "wc-run",
    runGeneration: "started",
    runStatus: "running" as const,
    nowTime: new Date(1_700_000_000_000),
    elapsedBatchSec,
    calc,
    v: values(valuesOverrides),
    form: form().form,
    claimAutoTrackEvent: claim,
    ...propOverrides,
  } as any;
}

async function acceptedClaim() {
  return vi.fn(async (event: any) => ({
    outcome: "accepted" as const,
    state: { generation: event.generation, sequence: event.sequence, nextDueAt: event.nextDueAt },
    values: Object.fromEntries(event.mutations.map((m: any) => [m.field, m.to])),
  }));
}

function publishWallClockReplay(channels: string[]) {
  publishAutoTrackSchedule({
    runId: "wc-run",
    generation: "wc-run:started",
    atMs: Date.now(),
    entries: channels.map((channel) => ({
      channel: channel as any,
      dueAt: 1_700_000_000_000 + 60_000,
      dueNow: false,
      nextDueAt: 1_700_000_000_000 + 120_000,
      canonical: false,
    })),
  });
}

describe("useAutoTrack wall-clock skip-latch (step 7b)", () => {
  it("skips redundant local case/tray/batch writes while a fresh non-canonical replay owns them", async () => {
    const claim = await acceptedClaim();
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(1, claim, {}, { nowTime: new Date(1_700_000_000_000 + 60_000) }),
    });
    // The mount's baseline ticks already claimed trays/batches once; clear the
    // history so the remainder of the test measures only post-replay writes.
    await new Promise((resolve) => setTimeout(resolve, 20));
    claim.mockClear();
    publishWallClockReplay(["case", "tray-consume", "batch-consume"]);
    // The server's adopted due ref (base+60s) is already due at this wall time
    // AND the time-based case estimate has grown past its baseline — without
    // the latch both case and dough blocks would write. A connected tab must
    // not re-fire its own wall-clock claims while the replay is fresh.
    rerender(props(30, claim, {}, { nowTime: new Date(1_700_000_000_000 + 60_000) }));
    rerender(props(31, claim, {}, { nowTime: new Date(1_700_000_000_000 + 60_000) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claim.mock.calls).toHaveLength(0);
  });

  it("never suppresses wall-clock writes for a canonical (echoed) entry", async () => {
    const claim = await acceptedClaim();
    const { rerender } = renderHook((p) => useAutoTrack(p), {
      initialProps: props(1, claim, {}, { nowTime: new Date(1_700_000_000_000 + 60_000) }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    claim.mockClear();
    publishAutoTrackSchedule({
      runId: "wc-run",
      generation: "wc-run:started",
      atMs: Date.now(),
      entries: [
        { channel: "tray-consume", dueAt: 1_700_000_000_000 + 60_000, dueNow: false, nextDueAt: 1_700_000_000_000 + 120_000, canonical: true },
      ],
    });
    // A canonical echo is NOT server replay: the client resumes executing its
    // own wall-clock writes even when the verdict is fresh and says not due.
    rerender(props(2, claim, {}, { nowTime: new Date(1_700_000_000_000 + 120_000) }));
    await waitFor(() => expect(claim.mock.calls.some(([event]) => event.channel === "tray-consume")).toBe(true));
  });
});
