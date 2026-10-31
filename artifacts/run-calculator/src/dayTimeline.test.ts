// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  calculateDayTimeline,
  defaultDayBreaks,
  normalizeDayBreaks,
  buildTimelineRuns,
} from "./dayTimeline";

const day = "2026-09-18";
const at = (time: string) => new Date(`${day}T${time}:00`).getTime();

describe("day timeline", () => {
  it("projects the morning browser fixture but refuses a late-day clock break inside a run", () => {
    const plan = {
      date: day,
      productionStartTime: "06:00",
      runs: [
        { run: { id: "a", brand: "A", flavor: "" }, durationSec: 45 * 60 },
        { run: { id: "b", brand: "B", flavor: "" }, durationSec: 45 * 60 },
      ],
      breaks: [
        { enabled: true, mode: "after-run", runId: "a" },
        { enabled: true, mode: "at-time", atTime: "23:00" },
      ],
    };
    const morning = calculateDayTimeline({ ...plan, nowMs: at("06:00") });
    expect(morning.incomplete).toBe(false);
    expect(morning.projectedFinishMs).toBe(at("23:30"));
    expect(morning.breaks[1]).toMatchObject({ status: "scheduled", startMs: at("23:00") });

    const evening = calculateDayTimeline({ ...plan, nowMs: at("21:15") });
    expect(evening.runs[1]).toMatchObject({ startMs: at("22:30"), finishMs: at("23:15") });
    expect(evening.breaks[1]).toMatchObject({ status: "pending", reason: "during-run" });
    expect(evening.incomplete).toBe(true);
    expect(evening.projectedFinishMs).toBeUndefined();
  });

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

  it("finishes a paused current run from now, not a stale paused timestamp", () => {
    const timeline = calculateDayTimeline({
      date: day,
      productionStartTime: "06:00",
      nowMs: at("12:00"),
      currentRunId: "a",
      currentRemainingSec: 600,
      runs: [{ run: { id: "a", brand: "A", flavor: "", startedAt: at("06:00"), pausedAt: at("07:00") }, durationSec: 3600 }],
    });
    expect(timeline.runs[0].finishMs).toBe(at("12:10"));
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
    expect(timeline.projectedFinishMs).toBeUndefined();
    expect(timeline.partialFinishMs).toBe(at("06:30"));
    expect(timeline.incomplete).toBe(true);
  });

  it("does not schedule downstream runs through an unknown duration", () => {
    const timeline = calculateDayTimeline({
      date: day, nowMs: at("05:00"),
      runs: [
        { run: { id: "a", brand: "", flavor: "" } },
        { run: { id: "b", brand: "", flavor: "" }, durationSec: 3600 },
      ],
      breaks: [{ enabled: true, mode: "after-run", runId: "a" }],
    });
    expect(timeline.runs[0].finishMs).toBeUndefined();
    expect(timeline.runs[1].startMs).toBeUndefined();
    expect(timeline.runs[1].finishMs).toBeUndefined();
    expect(timeline.breaks[0]).toMatchObject({ status: "pending", reason: "unknown-duration" });
    expect(timeline.projectedFinishMs).toBeUndefined();
  });

  it("does not expose a finite but out-of-range date as a finish", () => {
    for (const durationSec of [Number.MAX_VALUE, 1e15]) {
      const timeline = calculateDayTimeline({
        date: day, nowMs: at("05:00"),
        runs: [
          { run: { id: "a", brand: "", flavor: "" }, durationSec },
          { run: { id: "b", brand: "", flavor: "" }, durationSec: 60 },
        ],
        breaks: [{ enabled: true, mode: "after-run", runId: "a" }],
      });
      expect(timeline.incomplete).toBe(true);
      expect(timeline.projectedFinishMs).toBeUndefined();
      expect(timeline.runs[0].finishMs).toBeUndefined();
      expect(timeline.runs[1].startMs).toBeUndefined();
      expect(timeline.breaks[0].status).toBe("pending");
    }
  });

  it.each([NaN, Infinity, -1])("never converts invalid duration %s to a finish", durationSec => {
    const timeline = calculateDayTimeline({
      date: day, nowMs: at("05:00"),
      runs: [{ run: { id: "a", brand: "", flavor: "" }, durationSec }],
    });
    expect(timeline.projectedFinishMs).toBeUndefined();
    expect(timeline.runs[0].finishMs).toBeUndefined();
  });

  it("keeps actual completion and overlapping current starts despite missing recipe inputs", () => {
    const timeline = calculateDayTimeline({
      date: day, nowMs: at("08:00"),
      runs: [
        { run: { id: "a", brand: "", flavor: "", startedAt: at("06:00"), endedAt: at("07:30") } },
        { run: { id: "b", brand: "", flavor: "", startedAt: at("07:00") }, remainingSec: 600 },
        { run: { id: "c", brand: "", flavor: "" }, durationSec: 600 },
      ],
    });
    expect(timeline.runs[0]).toMatchObject({ startMs: at("06:00"), finishMs: at("07:30") });
    expect(timeline.runs[1]).toMatchObject({ startMs: at("07:00"), finishMs: at("08:10") });
    expect(timeline.runs[2]).toMatchObject({ startMs: at("08:10"), finishMs: at("08:20") });
  });

  it("places three adjacent breaks after their run identities even after earlier shifts", () => {
    const timeline = calculateDayTimeline({
      date: day, nowMs: at("05:00"),
      runs: ["b", "a", "c"].map(id => ({ run: { id, brand: "", flavor: "" }, durationSec: 1800 })),
      breaks: [
        { enabled: true, mode: "after-run", runId: "b" },
        { enabled: true, mode: "after-run", runId: "a" },
        { enabled: true, mode: "after-run", runId: "a" },
      ],
    });
    expect(timeline.breaks.map(br => br.startMs)).toEqual([at("06:30"), at("07:30"), at("08:00")]);
    expect(timeline.runs[2].startMs).toBe(at("08:30"));
    expect(timeline.projectedFinishMs).toBe(at("09:00"));
  });

  it("keeps a clock break inside a planned run pending instead of moving the requested time", () => {
    const timeline = calculateDayTimeline({
      date: day, nowMs: at("05:00"),
      runs: [{ run: { id: "a", brand: "", flavor: "" }, durationSec: 3600 }],
      breaks: [{ enabled: true, mode: "at-time", atTime: "06:30" }],
    });
    expect(timeline.runs[0].finishMs).toBe(at("07:00"));
    expect(timeline.breaks[0]).toMatchObject({ status: "pending", reason: "during-run" });
    expect(timeline.breaks[0].startMs).toBeUndefined();
    expect(timeline.projectedFinishMs).toBeUndefined();
    expect(timeline.incomplete).toBe(true);
  });

  it.each([
    ["00:00", "12:00 AM", "00:00"],
    ["12:00", "12:00 PM", "12:00"],
    ["23:00", "11:00 PM", "23:00"],
  ])("preserves local %s clock values under 12/24-hour display", (clock, twelve, twentyFour) => {
    const timeline = calculateDayTimeline({
      date: day, productionStartTime: "00:00", nowMs: at("00:00"), runs: [],
      breaks: [{ enabled: true, mode: "at-time", atTime: clock }],
    });
    expect(timeline.breaks[0].startMs).toBe(at(clock));
    const time = new Date(timeline.breaks[0].startMs!);
    expect(time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })).toBe(twelve);
    expect(time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })).toBe(twentyFour);
  });

  it("shares identity-bound live inputs and zero remaining, while future plans ignore today's clock", () => {
    const runs = [{ id: "a", brand: "", flavor: "", subTab: "crusts" as const, startedAt: at("06:00") }];
    const values = { casesNeeded: 100, pizzasPerCase: 12, approxLineSpeed: 40, freezerTime: 15, casesOnCurrentSkid: 100 };
    const live = buildTimelineRuns(runs, () => values, at("08:00"));
    expect(calculateDayTimeline({ date: day, nowMs: at("08:00"), runs: live }).runs[0].finishMs).toBe(at("08:00"));
    const future = buildTimelineRuns([{ ...runs[0], startedAt: undefined }], () => values, at("08:00"));
    const plan = calculateDayTimeline({ date: day, nowMs: at("08:00"), runs: future, isToday: false });
    expect(plan.runs[0]).toMatchObject({ startMs: at("06:00"), finishMs: at("06:45") });
  });
});