// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  getWarehouseSwitchoverBannerModel,
  WarehouseSwitchoverBanner,
} from "./WarehouseSwitchoverBanner";
import { useHomeCtx } from "../contexts/HomeCtx";
import { useLiveRun } from "../contexts/LiveRunContext";

vi.mock("../contexts/HomeCtx", () => ({ useHomeCtx: vi.fn() }));
vi.mock("../contexts/LiveRunContext", () => ({ useLiveRun: vi.fn() }));

const NOW = 1_700_000_000_000;

function makeInput(overrides: Partial<Parameters<typeof getWarehouseSwitchoverBannerModel>[0]> = {}) {
  return {
    currentRun: { endedAt: null },
    runStatus: "running" as const,
    casesPerSkid: 20,
    casesNeeded: 200,
    ppm: 100,
    pressCasesLeft: 100,
    adjustedTimeSec: 15 * 60,
    freezerTimeMin: 10,
    nowMs: NOW,
    upcomingRunLabels: ["Run 2 — Cheese", "Run 3 — Pepperoni"],
    ...overrides,
  };
}

describe("WarehouseSwitchoverBanner", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the under-one-skid packaging handoff with live operational details", () => {
    vi.mocked(useHomeCtx).mockReturnValue({
      currentRun: { endedAt: null },
      runStatus: "running",
      upcomingRunLabels: ["Run 2 — Cheese", "Run 3 — Pepperoni"],
      v: { casesPerSkid: 20, casesNeeded: 200 },
      ve: { freezerTime: 10 },
    });
    vi.mocked(useLiveRun).mockReturnValue({
      calc: {
        ppm: 100,
        pressCasesLeft: 12,
        adjustedTimeSec: 15 * 60,
      },
      nowTime: new Date(NOW),
    });

    render(<WarehouseSwitchoverBanner />);

    expect(screen.getByTestId("banner-warehouse-switchover")).toBeTruthy();
    expect(screen.getByText(/0\.6 skids to switchover — stage packaging/)).toBeTruthy();
    expect(screen.getByTestId("text-switchover-packaging-stage").textContent)
      .toContain("frontline should already be staged; packaging goes now");
    expect(screen.getByText(/12 cases left at the press/)).toBeTruthy();
    expect(screen.getByText(/press stops ~/)).toBeTruthy();
    expect(screen.getByText(/line clear ~/)).toBeTruthy();
    expect(screen.getByText(/Next up: Run 2 — Cheese\./)).toBeTruthy();
  });

  it.each([
    ["more than two skids remain", { pressCasesLeft: 41 }],
    ["the press is complete", { pressCasesLeft: 0 }],
    ["the run is paused", { runStatus: "paused" as const, pressCasesLeft: 12 }],
    ["the run is ended", { currentRun: { endedAt: NOW }, pressCasesLeft: 12 }],
    ["the press timing basis is unavailable", { ppm: 0, pressCasesLeft: 12 }],
    ["the skid count is unavailable", { casesPerSkid: 0, pressCasesLeft: 12 }],
    ["the requested count is unavailable", { casesNeeded: 0, pressCasesLeft: 12 }],
  ])("hides the banner when %s", (_reason, overrides) => {
    expect(getWarehouseSwitchoverBannerModel(makeInput(overrides))).toBeNull();
  });

  it("keeps the alert out of the Run tab after the presentation moves to Warehouse", () => {
    const runTabSource = readFileSync(
      "src/components/live-stations/LiveRunTabContent.tsx",
      "utf8",
    );
    expect(runTabSource).not.toContain('data-testid="banner-warehouse-switchover"');
  });
});