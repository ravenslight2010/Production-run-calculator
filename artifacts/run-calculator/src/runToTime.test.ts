import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_TO_TIME,
  formatRunToTimeInput,
  minutesUntilRunToTime,
  parseRunToTimeInput,
} from "./runToTime";

describe("Run to Time values", () => {
  it("uses 7:15 PM as the default", () => {
    expect(DEFAULT_RUN_TO_TIME).toBe("19:15");
    expect(formatRunToTimeInput(DEFAULT_RUN_TO_TIME)).toBe("7:15 PM");
  });

  it("accepts 24-hour and AM/PM input and normalizes it for sync", () => {
    expect(parseRunToTimeInput("07:15")).toBe("07:15");
    expect(parseRunToTimeInput("7:15 PM")).toBe("19:15");
    expect(parseRunToTimeInput("12:05 am")).toBe("00:05");
    expect(parseRunToTimeInput("12:05 PM")).toBe("12:05");
    expect(parseRunToTimeInput("24:00")).toBeNull();
    expect(parseRunToTimeInput("7:60 PM")).toBeNull();
  });

  it("round-trips every minute of the day through the displayed input format", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 1) {
        const synced = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        expect(parseRunToTimeInput(formatRunToTimeInput(synced))).toBe(synced);
      }
    }
  });

  it("counts only the remaining time today", () => {
    const now = new Date(2026, 9, 9, 18, 0, 0, 0);
    expect(minutesUntilRunToTime("19:15", now)).toBe(75);
    expect(minutesUntilRunToTime("18:00", now)).toBe(0);
    expect(minutesUntilRunToTime("17:59", now)).toBe(0);
    expect(minutesUntilRunToTime("invalid", now)).toBe(0);
  });
});
