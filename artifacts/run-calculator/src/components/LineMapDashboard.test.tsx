// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ScheduledDay } from "../scheduledDays";
import type { RecipeRow } from "../types";
import type { StationActivityEvidence } from "@workspace/live-calc";
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
    currentRun?: { id?: string; brand?: string; flavor?: string } | null;
    active?: boolean;
    scheduledDays?: ScheduledDay[];
    configuredApplicator?: 3 | 4;
    configuredPepperoni?: boolean;
    applicatorBatchesAvailable?: boolean;
    mixedFrontline?: boolean;
    applicatorRecipes?: Partial<Record<1 | 2 | 3 | 4, RecipeRow[]>>;
    sauceNeedsWithoutBatches?: boolean;
    sauceBarrelsMade?: number;
    sauceBatches?: number;
    sauceNeedsWithBatches?: boolean;
    stationActivity?: Record<string, StationActivityEvidence> | null;
    stationActivityNowMs?: number;
    confirmStationActivity?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const active = options.active ?? false;
  const configuredApplicator = options.configuredApplicator;
  const configuredPepperoni = options.configuredPepperoni ?? false;
  const applicatorBatchesAvailable = options.applicatorBatchesAvailable ?? true;
  const mixedFrontline = options.mixedFrontline ?? false;
  const sauceNeedsWithoutBatches = options.sauceNeedsWithoutBatches ?? false;
  const sauceNeedsWithBatches = options.sauceNeedsWithBatches ?? false;
  const confirmStationActivity = options.confirmStationActivity ?? vi.fn().mockResolvedValue(undefined);
  const context = {
    v: {
      traysOnLine: active ? 1 : 0,
      batchesReady: 0,
      sauceBarrelsMade: options.sauceBarrelsMade ?? 0,
      sauceOzPerPizza:
        mixedFrontline || sauceNeedsWithoutBatches || sauceNeedsWithBatches ? 2 : 0,
      app1OzPerPizza: mixedFrontline ? 2 : 0,
      app2OzPerPizza: mixedFrontline ? 2 : 0,
      app1Type: mixedFrontline ? "Mozzarella" : "",
      app2Type: mixedFrontline ? "Cheddar" : "",
      app3OzPerPizza: mixedFrontline || configuredApplicator === 3 ? 2 : 0,
      app4OzPerPizza: mixedFrontline || configuredApplicator === 4 ? 2 : 0,
      app3Type: mixedFrontline || configuredApplicator === 3 ? "Cheese" : "",
      app4Type: mixedFrontline || configuredApplicator === 4 ? "Cheese" : "",
      app1CheeseRecipe: options.applicatorRecipes?.[1] ?? [],
      app2CheeseRecipe: options.applicatorRecipes?.[2] ?? [],
      app3CheeseRecipe: options.applicatorRecipes?.[3] ?? [],
      app4CheeseRecipe: options.applicatorRecipes?.[4] ?? [],
      pep1Type: mixedFrontline || configuredPepperoni ? "Pepperoni" : "",
      pep1TypeB: mixedFrontline ? "Sausage" : "",
      pep2Type: "",
      pep2TypeB: "",
      pep1Combined: false,
      casesNeeded: 100,
      casesPerSkid: 20,
      preTunnelMin: 2.5,
      postTunnelMin: 2.5,
    },
    ve: { freezerTime: 10 },
    currentRun: options.currentRun === undefined ? { id: "run-1" } : options.currentRun,
    dayState: {},
    runStatus,
    scheduledDays: options.scheduledDays ?? [],
    activePackagingRows: [],
    activeWarehouseRows: [],
    navigate: vi.fn(),
    confirmStationActivity,
    isOnline: true,
  };
  mocks.useHomeTabCtx.mockReturnValue(context);
  mocks.useLiveRun.mockReturnValue({
    calc: {
      doughDepletionSec: 0,
      sauceBatches: options.sauceBatches ?? (sauceNeedsWithBatches ? 3 : active ? 1 : 0),
      sauceDepletionSec: 0,
      sauceEffBarrel:
        mixedFrontline || sauceNeedsWithoutBatches || sauceNeedsWithBatches ? 50 : 0,
      app1Lbs: mixedFrontline ? 20 : 0,
      app1Batches: mixedFrontline ? 1 : 0,
      app2Lbs: mixedFrontline ? 30 : 0,
      app2Batches: mixedFrontline ? 2 : 0,
      app3Lbs: mixedFrontline || configuredApplicator === 3 ? 40 : 0,
      app3Batches:
        (mixedFrontline || configuredApplicator === 3) && applicatorBatchesAvailable
          ? 2
          : 0,
      app4Lbs: mixedFrontline ? 60 : configuredApplicator === 4 ? 40 : 0,
      app4Batches: mixedFrontline
        ? applicatorBatchesAvailable ? 3 : 0
        : configuredApplicator === 4 && applicatorBatchesAvailable ? 2 : 0,
      pep1Lbs: mixedFrontline || configuredPepperoni ? 12 : 0,
      pep1Batches: mixedFrontline ? 1 : 0,
      pep1LbsB: mixedFrontline ? 8 : 0,
      pep1BatchesB: 0,
      pep2Lbs: 0,
      pep2Batches: 0,
      pep2LbsB: 0,
      pep2BatchesB: 0,
      pressCasesLeft: active ? 80 : 0,
      casesCompleted: active ? 20 : 0,
      ppm: 0,
      casesInFreezer: active ? 10 : 0,
      totalTimeSec: 0,
    },
    casesPct: 0,
    casesFreezerPct: 0,
    autoTrackSuggestion: null,
    stationActivity: options.stationActivity ?? null,
    stationActivityNowMs: options.stationActivityNowMs ?? 100_000,
  });

  return { ...render(<LineMapDashboard />), context };
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
  const zone = getZoneNavigationButton(zoneName);
  expect(within(zone).getByText(label)).toBeTruthy();
}

function expectZoneReason(zoneName: RegExp, reason: string) {
  const zone = getZoneNavigationButton(zoneName);
  expect(within(zone).getByText(reason)).toBeTruthy();
}

function getZoneNavigationButton(zoneName: RegExp): HTMLElement {
  const card = screen.getAllByTestId(/^station-card-/).find((candidate) =>
    zoneName.test(candidate.textContent ?? ""),
  );
  if (!card) throw new Error(`No station card matched ${zoneName}`);
  return within(card).getAllByRole("button")[0]!;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LineMapDashboard current product identity", () => {
  it("shows the active run's brand and flavor in the header", () => {
    renderLineMap("running", {
      currentRun: { id: "run-1", brand: "Acme", flavor: "Supreme" },
    });

    expect(screen.getByTestId("line-map-current-product").textContent).toBe(
      "Acme – Supreme",
    );
  });

  it.each([
    [{ id: "run-1", brand: "Acme", flavor: "" }, "Acme"],
    [{ id: "run-1", brand: "", flavor: "Supreme" }, "Supreme"],
    [{ id: "run-1", brand: "  Acme  ", flavor: "   " }, "Acme"],
  ])("shows only non-empty name parts", (currentRun, expected) => {
    renderLineMap("running", { currentRun });

    expect(screen.getByTestId("line-map-current-product").textContent).toBe(
      expected,
    );
    expect(screen.getByTestId("line-map-current-product").textContent).not.toMatch(
      /[–-]\s*$|^\s*[–-]/,
    );
  });

  it("updates the header when the selected run changes", () => {
    const rendered = renderLineMap("running", {
      currentRun: { id: "run-1", brand: "Acme", flavor: "Supreme" },
    });

    expect(screen.getByTestId("line-map-current-product").textContent).toBe(
      "Acme – Supreme",
    );

    mocks.useHomeTabCtx.mockReturnValue({
      ...rendered.context,
      currentRun: { id: "run-2", brand: "Northstar", flavor: "Pepperoni" },
    });
    rendered.rerender(<LineMapDashboard />);

    expect(screen.getByTestId("line-map-current-product").textContent).toBe(
      "Northstar – Pepperoni",
    );
    expect(screen.queryByText("Acme – Supreme")).toBeNull();
  });

  it("keeps the no-run empty state without a product label", () => {
    renderLineMap("pending", { currentRun: null });

    expect(screen.queryByTestId("line-map-current-product")).toBeNull();
    expect(screen.getByText("Start a run to see the line map")).toBeTruthy();
    expect(screen.getByText("NO ACTIVE RUN")).toBeTruthy();
  });

  it("omits the product label when the selected run has no name parts", () => {
    renderLineMap("pending", {
      currentRun: { id: "run-1", brand: " ", flavor: "" },
    });

    expect(screen.queryByTestId("line-map-current-product")).toBeNull();
  });
});

describe("LineMapDashboard station lifecycle statuses", () => {
  it("shows Sauce needs in batches when both Sauce pounds and batches are available", () => {
    renderLineMap("running", { sauceNeedsWithBatches: true });

    const frontline = screen.getByRole("button", { name: /Frontline/ });
    const sauceNeed = within(frontline).getByText("Sauce").parentElement?.textContent;
    expect(sauceNeed).toContain("3.00 batches");
    expect(sauceNeed).not.toContain("lbs");
  });

  it("shows Sauce pounds across multiple barrels when no batches are needed", () => {
    renderLineMap("running", {
      sauceNeedsWithoutBatches: true,
      sauceBarrelsMade: 3,
      sauceBatches: 0,
    });

    const frontline = screen.getByRole("button", { name: /Frontline/ });
    expect(within(frontline).getByText("Sauce").parentElement?.textContent)
      .toContain("150.00 lbs");
  });

  it.each([3, 4] as const)(
    "shows the need for applicator %i when it is the only configured Frontline item",
    (slot) => {
      renderLineMap("running", { configuredApplicator: slot });

      const frontline = screen.getByRole("button", { name: /Frontline/ });
      expect(within(frontline).getByText(`App ${slot} — Cheese`).parentElement?.textContent)
        .toContain("2.00 batches");
      expect(within(frontline).queryByText("App 1 — Mozzarella")).toBeNull();
      expect(within(frontline).queryByText("App 2 — Cheddar")).toBeNull();
  });

  it("keeps the aggregate applicator need when recipe components are not usable", () => {
    renderLineMap("running", {
      configuredApplicator: 3,
      applicatorRecipes: {
        3: [
          { ingredient: "", lbs: 20 },
          { ingredient: "Zero-weight ingredient", lbs: 0 },
        ],
      },
    });

    const frontline = screen.getByRole("button", { name: /Frontline/ });
    expect(within(frontline).getByText("App 3 — Cheese").parentElement?.textContent)
      .toContain("2.00 batches");
    expect(within(frontline).queryByTestId("frontline-components-3")).toBeNull();
  });

  it("shows all configured Frontline needs together", () => {
    renderLineMap("running", { mixedFrontline: true });

    const frontline = screen.getByRole("button", { name: /Frontline/ });
    for (const label of [
      "Sauce",
      "App 1 — Mozzarella",
      "App 2 — Cheddar",
      "Pep 1 — Pepperoni",
      "Pep 1 — Sausage",
      "App 3 — Cheese",
      "App 4 — Cheese",
    ]) {
      expect(within(frontline).getByText(label)).toBeTruthy();
    }
  });

  it("confirms activity at the warehouse station", async () => {
    const confirmStationActivity = vi.fn().mockResolvedValue(undefined);
    renderLineMap("running", { confirmStationActivity });

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm activity at Warehouse" }),
    );
    await waitFor(() =>
      expect(confirmStationActivity).toHaveBeenCalledWith("warehouse"),
    );
  });

  it("does not show an activity age for active stations or non-running lifecycle states", () => {
    renderLineMap("running", { active: true });
    expect(
      within(screen.getByRole("button", { name: /Press \/ Oven/ })).queryByTestId(
        "station-activity-age-press",
      ),
    ).toBeNull();
    cleanup();

    renderLineMap("paused");
    expect(screen.queryByTestId("station-activity-age-press")).toBeNull();
    cleanup();

    renderLineMap("pending");
    expect(screen.queryByTestId("station-activity-age-press")).toBeNull();
    cleanup();

    renderLineMap("ended");
    expect(screen.queryByTestId("station-activity-age-press")).toBeNull();
    cleanup();

    renderLineMap("pending", { currentRun: null });
    expect(screen.queryByTestId("station-activity-age-press")).toBeNull();
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
