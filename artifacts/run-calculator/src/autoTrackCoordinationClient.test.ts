import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_TRACK_SCHEDULE_EVENT,
  publishAutoTrackSchedule,
} from "./autoTrackCoordinationClient";
import type { AutoTrackSchedule } from "@workspace/live-calc";

describe("publishAutoTrackSchedule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards canonical and due-now verdicts unchanged to the schedule adopter", () => {
    const schedule: AutoTrackSchedule = {
      runId: "run-1",
      generation: "run-1:42",
      atMs: 1_234,
      entries: [
        {
          channel: "case",
          dueAt: 4_000,
          nextDueAt: 4_000,
          dueNow: true,
          canonical: true,
          sequence: 4,
        },
        {
          channel: "sauce-barrel",
          dueAt: 800,
          nextDueAt: 1_000,
          dueNow: false,
          canonical: false,
        },
      ],
    };
    const listener = vi.fn();
    window.addEventListener(AUTO_TRACK_SCHEDULE_EVENT, listener);

    publishAutoTrackSchedule(schedule);

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toBe(schedule);
    window.removeEventListener(AUTO_TRACK_SCHEDULE_EVENT, listener);
  });

  it("ignores absent schedules instead of publishing an ownership verdict", () => {
    const listener = vi.fn();
    window.addEventListener(AUTO_TRACK_SCHEDULE_EVENT, listener);

    publishAutoTrackSchedule(null);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(AUTO_TRACK_SCHEDULE_EVENT, listener);
  });
});