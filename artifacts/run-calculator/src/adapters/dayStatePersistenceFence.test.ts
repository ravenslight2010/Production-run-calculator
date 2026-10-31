// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyResetWipe } from "./browserResetPersistence";
import { loadDayState, saveDayState } from "../storage";

describe("day-state reset persistence fence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("does not let a pending in-memory save restore the wiped day", () => {
    const staleDay = loadDayState();
    localStorage.setItem("run-calc-day", JSON.stringify(staleDay));

    expect(applyResetWipe(1)).toBe(true);
    expect(localStorage.getItem("run-calc-day")).toBeNull();

    saveDayState(staleDay, { stampMeta: false });
    expect(localStorage.getItem("run-calc-day")).toBeNull();
  });
});
