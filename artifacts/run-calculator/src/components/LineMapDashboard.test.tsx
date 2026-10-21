// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

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
  options: { currentRun?: object | null; active?: boolean } = {},
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

function expectZoneStatus(zoneName: RegExp, label: string) {
  const zone = screen.getByRole("button", { name: zoneName });
  expect(within(zone).getByText(label)).toBeTruthy();
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
  });

  it("keeps inactive stations idle while a run is running", () => {
    renderLineMap("running");

    expectZoneStatus(/Press \/ Oven/, "Idle");
    expectZoneStatus(/Freeze Tunnel/, "Idle");
    expectZoneStatus(/Packaging/, "Idle");
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
  });

  it("shows stopped for stations when a run has ended", () => {
    renderLineMap("ended");

    expect(screen.getByText("RUN ENDED")).toBeTruthy();
    expectZoneStatus(/Press \/ Oven/, "Stopped");
    expectZoneStatus(/Freeze Tunnel/, "Stopped");
    expectZoneStatus(/Packaging/, "Stopped");
  });

  it("keeps stations idle when no run is selected", () => {
    renderLineMap("pending", { currentRun: null });

    expect(screen.getByText("NO ACTIVE RUN")).toBeTruthy();
    expectZoneStatus(/Press \/ Oven/, "Idle");
    expectZoneStatus(/Freeze Tunnel/, "Idle");
    expectZoneStatus(/Packaging/, "Idle");
  });
});
