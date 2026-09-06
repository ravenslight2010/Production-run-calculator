import { describe, expect, it } from "vitest";
import { autoTrackScheduleToCoordination } from "./autoTrackCoordinationClient";
import type { AutoTrackSchedule } from "@workspace/live-calc";

const schedule: AutoTrackSchedule = {
  runId: "run-1",
  generation: "run-1:42",
  atMs: 1234,
  entries: [
    { channel: "case", dueAt: 100_000 + 63_000, dueNow: false, nextDueAt: 100_000 + 63_000, canonical: true, sequence: 4 },
    { channel: "sauce-barrel", dueAt: 800, dueNow: true, nextDueAt: 1000, canonical: false },
  ],
};

describe("autoTrackScheduleToCoordination", () => {
  it("maps schedule entries to the coordination shape useAutoTrack adopts", () => {
    const coordination = autoTrackScheduleToCoordination(schedule);
    const run = coordination.autoTrackCoordination!.runs["run-1"];
    expect(run.case).toEqual({ generation: "run-1:42", sequence: 4, nextDueAt: 100_000 + 63_000, dueNow: false, canonical: true, updatedAt: 1234 });
    expect(run["sauce-barrel"]).toEqual({ generation: "run-1:42", sequence: 0, nextDueAt: 800, dueNow: true, canonical: false, updatedAt: 1234 });
  });

  it("keeps the client sequence out of the way when the entry is derived (no sequence)", () => {
    const coordination = autoTrackScheduleToCoordination({
      ...schedule,
      entries: [{ channel: "sauce-barrel", dueAt: 800, dueNow: true, nextDueAt: 1000, canonical: false }],
    });
    expect(coordination.autoTrackCoordination!.runs["run-1"]["sauce-barrel"].sequence).toBe(0);
    expect(coordination.autoTrackCoordination!.runs["run-1"]["sauce-barrel"].canonical).toBe(false);
  });
});

describe("autoTrackScheduleToCoordination canonical flag (step 7b)", () => {
  it("carries the entry's canonical/replay flag so clients know the server owns fresh-run wall-clock channels", () => {
    const coordination = autoTrackScheduleToCoordination({
      ...schedule,
      entries: [
        { channel: "case", dueAt: 100_000 + 63_000, dueNow: false, nextDueAt: 100_000 + 126_000, canonical: false },
        { channel: "tray-consume", dueAt: 100_000 + 30_000, dueNow: false, nextDueAt: 100_000 + 60_000, canonical: false },
        { channel: "batch-consume", dueAt: 100_000 + 90_000, dueNow: true, nextDueAt: 100_000 + 180_000, canonical: true, sequence: 3 },
      ],
    });
    const run = coordination.autoTrackCoordination!.runs["run-1"];
    expect(run.case!.canonical).toBe(false);
    expect(run["tray-consume"]!.canonical).toBe(false);
    expect(run["batch-consume"]!.canonical).toBe(true);
  });
});

describe("autoTrackScheduleToCoordination dueNow verdict (step 6b)", () => {
  it("carries each entry's server due-now verdict into the adopted state", () => {
    const coordination = autoTrackScheduleToCoordination({
      ...schedule,
      entries: [
        { channel: "sauce-barrel", dueAt: 800, dueNow: false, nextDueAt: 1000, canonical: false },
        { channel: "app3-batch", dueAt: 900, dueNow: true, nextDueAt: 1100, canonical: false },
      ],
    });
    const run = coordination.autoTrackCoordination!.runs["run-1"];
    expect(run["sauce-barrel"]!.dueNow).toBe(false);
    expect(run["app3-batch"]!.dueNow).toBe(true);
  });

  it("round-trips a full dueNow map for every channel kind", () => {
    const coordination = autoTrackScheduleToCoordination(schedule);
    const run = coordination.autoTrackCoordination!.runs["run-1"];
    expect(run.case!.dueNow).toBe(false);
    expect(run["sauce-barrel"]!.dueNow).toBe(true);
  });
});
