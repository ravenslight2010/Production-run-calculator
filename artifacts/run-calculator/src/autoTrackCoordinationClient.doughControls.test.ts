import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  adoptDoughTimerControls, DOUGH_TIMER_CONTROL_EVENT, publishDoughTimerControl,
  readDoughTimerControlProjection, setDoughTimerControlOwner,
} from "./autoTrackCoordinationClient";

beforeEach(() => { localStorage.clear(); setDoughTimerControlOwner("live:operator"); });
afterEach(() => { vi.restoreAllMocks(); setDoughTimerControlOwner(undefined); });
const controls = { run: { generation: "run:100", pausedAt: 1000, resumeAt: 2000, updatedAt: 1000 } };

it("retains pre-mount hydration, but never adopts another account or sandbox's recovery", () => {
  adoptDoughTimerControls(controls);
  expect(readDoughTimerControlProjection()).toEqual(controls);
  setDoughTimerControlOwner("sandbox:operator");
  expect(readDoughTimerControlProjection()).toBeUndefined();
  setDoughTimerControlOwner("live:other-operator");
  expect(readDoughTimerControlProjection()).toBeUndefined();
  setDoughTimerControlOwner("live:operator");
  expect(readDoughTimerControlProjection()).toEqual(controls);
  adoptDoughTimerControls({});
  expect(readDoughTimerControlProjection()).toEqual({});
});

it("keeps an in-memory confirmed projection when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
  adoptDoughTimerControls(controls);
  expect(readDoughTimerControlProjection()).toEqual(controls);
  setDoughTimerControlOwner("sandbox:operator");
  expect(readDoughTimerControlProjection()).toBeUndefined();
});

it("stores clock-adjusted anchors without changing durations, and refuses an undurable optimistic hold", () => {
  const request = { runId: "run", ...controls.run };
  expect(publishDoughTimerControl(request, 3_600_000)).toBe(true);
  const stored = JSON.parse(localStorage.getItem("run-calculator:dough-timer-controls")!);
  expect(stored.run.pausedAt).toBe(3_601_000);
  expect(stored.run.resumeAt - stored.run.pausedAt).toBe(1000);
  const reject = (event: Event) => event.preventDefault();
  window.addEventListener(DOUGH_TIMER_CONTROL_EVENT, reject);
  try {
    expect(publishDoughTimerControl({ ...request, pausedAt: 0, resumeAt: 0 })).toBe(false);
    expect(JSON.parse(localStorage.getItem("run-calculator:dough-timer-controls")!)).toEqual(stored);
  } finally { window.removeEventListener(DOUGH_TIMER_CONTROL_EVENT, reject); }
});
