import { describe, expect, it } from "vitest";
import {
  calculateDayTimeline,
  defaultDayBreaks,
  normalizeDayBreaks,
} from "./dayTimeline";

const day = "2026-09-18";
const at = (time: string) => new Date(`${day}T${time}:00`).getTime();

describe("day timeline", () => {
  it("normalizes legacy and malformed break data to three fixed slots", () => {
    const breaks = normalizeDayBreaks([
      { enabled: true, mode: "at-time", atTime: "08:30", durationMin: 5 },
      { enabled: true, mode: "at-time", atTime: "not-a-time", durationMin: 999 },
      { mode: "unknown" },
    ]);
    expect(breaks).toHaveLength(3);
    expect(breaks[0]).toMatchObject({ slot: 1, enabled: true, atTime: "08:30", durationMin: 30 });
    expect(breaks[1]).toMatchObject({ slot: 2, enabled: true, durationMin: 30 });
    expect(breaks[2]).toMatchObject({ slot: 3, enabled: false, durationMin: 30 });
    expect(defaultDayBreaks().every((item) => item.durationMin === 30)).toBe(true);
  });

  it("inserts an after-run break and shifts later unstarted runs", () => {
    const timeline = calculateDayTimeline({
      date: day,
      productionStartTime: "06:00",
      nowMs: at("05:00"),
      runs: [
        { run: { id: "a", brand: "A", flavor: "" }, durationSec: 3600 },
        { run: { id: "b", brand: "B", flavor: "" }, durationSec: 1800 },
      ],
      breaks: [{ enabled: true, mode: "after-run", runId: "a" }],
    });
    expect(timeline.runs[0]).toMatchObject({ startMs: at("06:00"), finishMs: at("07:00") });
    expect(timeline.breaks[0]).toMatchObject({ status: "scheduled", startMs: at("07:00"), finishMs: at("07:30") });
    expect(timeline.runs[1]).toMatchObject({ startMs: at("07:30"), finishMs: at("08:00") });
  });

  it("keeps a clock break during the current run pending without pausing it", () => {
    const timeline = calculateDayTimeline({
      date: day,
      productionStartTime: "06:00",
      nowMs: at("06:30"),
      currentRunId: "a",
      currentRemainingSec: 1800,
      runs: [
        { run: { id: "a", brand: "A", flavor: "", startedAt: at("06:00") }, durationSec: 3600 },
        { run: { id: "b", brand: "B", flavor: "" }, durationSec: 1800 },
      ],
      breaks: [{ enabled: true, mode: "at-time", atTime: "06:45" }],
    });
    expect(timeline.breaks[0]).toMatchObject({ status: "pending", reason: "during-run" });
    expect(timeline.runs[0].finishMs).toBe(at("07:00"));
    expect(timeline.runs[1].startMs).toBe(at("07:00"));
  });

  it("surfaces a deleted after-run reference instead of reassigning it", () => {
    const timeline = calculateDayTimeline({
      date: day,
      productionStartTime: "06:00",
      nowMs: at("05:00"),
      runs: [{ run: { id: "remaining", brand: "A", flavor: "" }, durationSec: 1800 }],
      breaks: [{ enabled: true, mode: "after-run", runId: "deleted" }],
    });
    expect(timeline.breaks[0]).toMatchObject({ status: "unassigned", reason: "missing-run" });
    expect(timeline.projectedFinishMs).toBe(at("06:30"));
  });
});