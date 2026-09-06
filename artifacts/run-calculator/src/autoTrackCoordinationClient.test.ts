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
    expect(run.case).toEqual({ generation: "run-1:42", sequence: 4, nextDueAt: 100_000 + 63_000, updatedAt: 1234 });
    expect(run["sauce-barrel"]).toEqual({ generation: "run-1:42", sequence: 0, nextDueAt: 800, updatedAt: 1234 });
  });

  it("keeps the client sequence out of the way when the entry is derived (no sequence)", () => {
    const coordination = autoTrackScheduleToCoordination({
      ...schedule,
      entries: [{ channel: "sauce-barrel", dueAt: 800, dueNow: true, nextDueAt: 1000, canonical: false }],
    });
    expect(coordination.autoTrackCoordination!.runs["run-1"]["sauce-barrel"].sequence).toBe(0);
  });
});
