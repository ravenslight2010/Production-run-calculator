// @vitest-environment node
import { expect, it } from "vitest";
import { DEFAULT_VALUES } from "../types";
import { canonicalOperationalRun, canonicalOperationalValues, canonicalOperationalSnapshotForPublish } from "./canonicalOperationalState";
import type { SyncPayload } from "../types";

it("publishes confirmed command fields, not optimistic holds/totals, and preserves ordinary setup edits", () => {
  const confirmed = {
    dayState: { date: "2026-10-23", runs: [{ id: "run", brand: "Acme", flavor: "Pep", startedAt: 100, metaUpdatedAt: 120 }] },
    runValues: { run: { traysOnLine: 3, doughStockInitialized: false, casesNeeded: 100 } },
    doughTimerControls: { run: { generation: "run:120", pausedAt: 0, resumeAt: 0, updatedAt: 100 } },
  } as unknown as SyncPayload;
  const local = {
    ...confirmed,
    dayState: { ...confirmed.dayState, runs: [{ ...confirmed.dayState.runs[0], pausedAt: 99999, metaUpdatedAt: 99999 }] },
    runValues: { run: { ...confirmed.runValues.run, traysOnLine: 9, casesNeeded: 120 } },
    doughTimerControls: { run: { generation: "run:120", pausedAt: 99999, resumeAt: 0, updatedAt: 99999 } },
  };
  const result = canonicalOperationalSnapshotForPublish(local, confirmed);
  expect(result.dayState.runs[0]).not.toHaveProperty("pausedAt");
  expect(result.dayState.runs[0].metaUpdatedAt).toBe(120);
  expect(result.runValues.run.traysOnLine).toBe(3);
  expect(result.runValues.run.casesNeeded).toBe(120);
  expect(result.doughTimerControls).toEqual(confirmed.doughTimerControls);
  expect(local.runValues.run.traysOnLine).toBe(9);
  expect(local.dayState.runs[0].pausedAt).toBe(99999);
});

it("never invents command defaults or carries another date's controls into a new run", () => {
  const local = {
    dayState: { date: "2026-10-24", runs: [{ id: "new", brand: "Acme", flavor: "Pep", startedAt: 99 }] },
    runValues: { new: { traysOnLine: 9, casesNeeded: 100 } },
    doughTimerControls: { new: { generation: "new:99", pausedAt: 99, resumeAt: 0, updatedAt: 99 } },
  } as unknown as SyncPayload;
  const result = canonicalOperationalSnapshotForPublish(local, {
    ...local, dayState: { ...local.dayState, date: "2026-10-23" },
  });
  expect(result.runValues.new).toEqual({ casesNeeded: 100 });
  expect(result.dayState.runs[0]).not.toHaveProperty("startedAt");
  expect(result).not.toHaveProperty("doughTimerControls");
});

it("adopts canonical lifecycle and counters despite a future browser stamp, preserving setup", () => {
  const local = { id: "run", brand: "local", flavor: "local", notes: "unsaved setup", startedAt: 9999, endedAt: 99999, metaUpdatedAt: 999999 };
  const run = canonicalOperationalRun(local, { id: "run", brand: "remote", flavor: "remote", startedAt: 10, pausedAt: 20, metaUpdatedAt: 30 });
  expect(run).toMatchObject({ notes: "unsaved setup", brand: "local", startedAt: 10, pausedAt: 20, metaUpdatedAt: 30 });
  expect(run.endedAt).toBeUndefined();
  const values = canonicalOperationalValues({ ...DEFAULT_VALUES, casesNeeded: 200, traysOnLine: 99 }, { ...DEFAULT_VALUES, traysOnLine: 3 });
  expect(values).toMatchObject({ casesNeeded: 200, traysOnLine: 3 });
});
