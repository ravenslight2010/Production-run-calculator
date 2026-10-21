// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ScheduledDay } from "../scheduledDays";
import { todayStr } from "../utils";

const mocks = vi.hoisted(() => ({
  useHomeTabCtx: vi.fn(),
  useLiveRun: vi.fn(),
}));

vi.mock("../contexts/HomeTabCtx", () => ({
  useHomeTabCtx: mocks.useHomeTabCtx,
}));
vi.mock("../contexts/LiveRunContext", () => ({
  useLiveRun: mocks.useLiveRun,
}));

import LineMapDashboard from "./LineMapDashboard";

type Lifecycle = "pending" | "running" | "paused" | "ended";

function renderLineMap(
  runStatus: Lifecycle,
  options: {
    currentRun?: object | null;
    active?: boolean;
    scheduledDays?: ScheduledDay[];
  } = {},
) {
  const active = options.active ?? false;
  mocks.useHomeTabCtx.mockReturnValue({
    v: {
      traysOnLine: active ? 1 : 0,
      batchesReady: 0,
      sauceBarrelsMade: 0,
      sauceOzPerPizza: 0,
      app1OzPerPizza: 0,
      app2OzPerPizza: 0,
      pep1Type: "",
      pep1TypeB: "",
      pep2Type: "",
      pep2TypeB: "",
      casesNeeded: 100,
      casesPerSkid: 20,
      preTunnelMin: 2.5,
      postTunnelMin: 2.5,
    },
    ve: { freezerTime: 10 },
    currentRun: options.currentRun === undefined ? {} : options.currentRun,
    dayState: {},
    runStatus,
    scheduledDays: options.scheduledDays ?? [],
    activePackagingRows: [],
    activeWarehouseRows: [],
    navigate: vi.fn(),
  });
  mocks.useLiveRun.mockReturnValue({
    calc: {
      doughDepletionSec: 0,
      sauceBatches: active ? 1 : 0,
      sauceDepletionSec: 0,
      sauceEffBarrel: 0,
      pressCasesLeft: active ? 80 : 0,
      casesCompleted: active ? 20 : 0,
      ppm: 0,
      casesInFreezer: active ? 10 : 0,
      totalTimeSec: 0,
    },
    casesPct: 0,
    casesFreezerPct: 0,
    autoTrackSuggestion: null,
  });

  return render(<LineMapDashboard />);
}

function dateOffset(days: number): string {
  const date = new Date(`${todayStr()}T12:00:00`);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function expectZoneStatus(zoneName: RegExp, label: string) {
  const zone = screen.getByRole("button", { name: zoneName });
  expect(within(zone).getByText(label)).toBeTruthy();
}

function expectZoneReason(zoneName: RegExp, reason: string) {
  const zone = screen.getByRole("button", { name: zoneName });
  expect(within(zone).getByText(reason)).toBeTruthy();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LineMapDashboard station lifecycle statuses", () => {
  it("shows waiting for stations on a pending run", () => {
    renderLineMap("pending");

    expect(screen.getByText("LINE WAITING")).toBeTruthy();
    expectZoneStatus(/Press \/ Oven/, "Waiting");
    expectZoneStatus(/Freeze Tunnel/, "Waiting");
    expectZoneStatus(/Packaging/, "Waiting");
    expectZoneReason(/Press \/ Oven/, "Run is waiting to start");
    expectZoneReason(/Freeze Tunnel/, "Run is waiting to start");
    expectZoneReason(/Packaging/, "Run is waiting to start");
    expect(
      screen.getByRole("button", {
        name: /Press \/ Oven.*Run is waiting to start/,
      }),
    ).toBeTruthy();
  });

  it("shows active only for running stations with current activity", () => {
    renderLineMap("running", { active: true });

    expect(screen.getByText("LINE RUNNING")).toBeTruthy();
    expectZoneStatus(/Dough/, "Running");
    expectZoneStatus(/Sauce/, "Running");
    expectZoneStatus(/Press \/ Oven/, "Running");
    expectZoneStatus(/Frontline/, "Running");
    expectZoneStatus(/Freeze Tunnel/, "Running");
    expectZoneStatus(/Packaging/, "Running");
    expectZoneReason(/Warehouse/, "No current station activity");
    expect(
      within(screen.getByRole("button", { name: /Dough/ })).queryByText(
        "No current station activity",
      ),
    ).toBeNull();
  });

  it("keeps inactive stations idle while a run is running", () => {
    renderLineMap("running");

    expectZoneStatus(/Press \/ Oven/, "Idle");
    expectZoneStatus(/Freeze Tunnel/, "Idle");
    expectZoneStatus(/Packaging/, "Idle");
    expectZoneReason(/Press \/ Oven/, "No current station activity");
    expectZoneReason(/Freeze Tunnel/, "No current station activity");
    expectZoneReason(/Packaging/, "No current station activity");
  });

  it("does not show station activity while the line is paused", () => {
    renderLineMap("paused", { active: true });

    expect(screen.getByText("LINE PAUSED")).toBeTruthy();
    expectZoneStatus(/Dough/, "Idle");
    expectZoneStatus(/Sauce/, "Idle");
    expectZoneStatus(/Press \/ Oven/, "Idle");
    expectZoneStatus(/Frontline/, "Idle");
    expectZoneStatus(/Freeze Tunnel/, "Idle");
    expectZoneStatus(/Packaging/, "Idle");
    expectZoneReason(/Dough/, "Line is paused");
    expectZoneReason(/Press \/ Oven/, "Line is paused");
    expect(screen.queryByText("No current station activity")).toBeNull();
  });

  it("shows stopped for stations when a run has ended", () => {
    renderLineMap("ended");

    expect(screen.getByText("RUN ENDED")).toBeTruthy();
    expectZoneStatus(/Press \/ Oven/, "Stopped");
    expectZoneStatus(/Freeze Tunnel/, "Stopped");
    expectZoneStatus(/Packaging/, "Stopped");
    expect(screen.queryByText("Run is waiting to start")).toBeNull();
    expect(screen.queryByText("Line is paused")).toBeNull();
    expect(screen.queryByText("No current station activity")).toBeNull();
  });

  it("keeps stations idle when no run is selected", () => {
    renderLineMap("pending", { currentRun: null });

    expect(screen.getByText("NO ACTIVE RUN")).toBeTruthy();
    expect(screen.getByText("Start a run to see the line map")).toBeTruthy();
    expectZoneStatus(/Press \/ Oven/, "Idle");
    expectZoneStatus(/Freeze Tunnel/, "Idle");
    expectZoneStatus(/Packaging/, "Idle");
    expectZoneReason(/Press \/ Oven/, "No active run selected");
    expectZoneReason(/Freeze Tunnel/, "No active run selected");
    expectZoneReason(/Packaging/, "No active run selected");
  });

  it("previews the earliest named run in the upcoming schedule", () => {
    renderLineMap("pending", {
      currentRun: null,
      scheduledDays: [
        {
          date: dateOffset(4),
          runCount: 1,
          runs: [{
            id: "later-run",
            brand: "Later Brand",
            flavor: "Later Flavor",
            casesNeeded: 100,
            dieType: "",
          }],
        },
        {
          date: dateOffset(-1),
          runCount: 1,
          runs: [{
            id: "past-run",
            brand: "Past Brand",
            flavor: "Past Flavor",
            casesNeeded: 100,
            dieType: "",
          }],
        },
        {
          date: dateOffset(1),
          runCount: 2,
          runs: [
            {
              id: "next-run",
              brand: "Next Brand",
              flavor: "Classic",
              casesNeeded: 100,
              dieType: "",
            },
            {
              id: "same-day-later-run",
              brand: "Same Day Later",
              flavor: "Flavor",
              casesNeeded: 100,
              dieType: "",
            },
          ],
        },
      ],
    });

    const preview = screen.getByTestId("line-map-next-scheduled-run");
    expect(preview.textContent).toContain("Next scheduled run: Next Brand – Classic");
    expect(preview.textContent).not.toContain("Past Brand");
    expect(preview.textContent).not.toContain("Later Brand");
    expect(preview.textContent).not.toContain("Same Day Later");
    expect(screen.getByText("Start a run to see the line map")).toBeTruthy();
  });

  it("keeps the empty-state guidance when no schedule is available", () => {
    renderLineMap("pending", { currentRun: null, scheduledDays: [] });

    expect(screen.getByText("Start a run to see the line map")).toBeTruthy();
    expect(screen.queryByTestId("line-map-next-scheduled-run")).toBeNull();
  });
});
