// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperationalReport } from "@workspace/day-summary";
import OperationalReportPanel from "./OperationalReportPanel";
import { useMe } from "../useRole";
import { requestSummary } from "../aiSummary";

vi.mock("../useRole", () => ({ useMe: vi.fn() }));
vi.mock("../aiSummary", () => ({
  requestSummary: vi.fn(),
  summaryErrorMessage: () => "narration unavailable",
}));

const report: OperationalReport = {
  scope: "day",
  date: "2026-09-04",
  periodStart: "2026-09-04",
  periodEnd: "2026-09-04",
  generatedAt: "2026-09-04T12:00:00.000Z",
  production: {
    scope: "day",
    date: "2026-09-04",
    runsPlanned: 1,
    runsFinished: 0,
    casesPlanned: 100,
    casesProduced: 60,
    attainmentPct: 60,
    totalDowntimeMinutes: 15,
    totalStoppages: 2,
    topDowntime: { label: "Acme Cheese", minutes: 15 },
    unfinishedRuns: ["Acme Cheese"],
    incidentCount: 0,
    wasteFlaggedCount: 0,
    hasData: true,
  },
  quality: { availability: "unavailable", value: null, note: "Quality history unavailable." },
  incidents: { availability: "available", value: { total: 0, unresolved: 0 } },
  inventory: {
    availability: "available",
    value: {
      flaggedItems: 0,
      historical: { availability: "available", value: { totalEvents: 0, consumptionEvents: 0, wasteEvents: 0, adjustmentEvents: 0 } },
    },
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel() {
  return render(
    <OperationalReportPanel
      buildInput={(scope, date) => ({ scope, date, runs: [] })}
    />,
  );
}

describe("OperationalReportPanel", () => {
  it("protects the report surface when the capability is absent", () => {
    vi.mocked(useMe).mockReturnValue({
      me: null,
      role: null,
      capabilities: [],
      hasCapability: () => false,
      isManager: false,
      isLoading: false,
    });
    renderPanel();
    expect(screen.getByText(/available to managers only/i)).toBeTruthy();
    expect(screen.queryByTestId("operational-report")).toBeNull();
  });

  it("previews unavailable sections instead of turning them into zeroes", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null,
      role: null,
      capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents",
      isManager: false,
      isLoading: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => report,
    }));
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Preview report" }));
    expect(await screen.findByText(/Quality: Unavailable — Quality history unavailable/i)).toBeTruthy();
    expect(screen.getByText("Stoppages")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/authoritative and deterministic/i);
  });

  it("keeps optional narration separate and labels its source", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null,
      role: null,
      capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents",
      isManager: false,
      isLoading: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => report,
    }));
    vi.mocked(requestSummary).mockResolvedValue({
      summary: "One run remains unfinished.",
      stats: report.production,
      generatedAt: Date.now(),
      aiGenerated: true,
    });
    renderPanel();
    await userEvent.click(screen.getByLabelText(/Include optional narration/i));
    await userEvent.click(screen.getByRole("button", { name: "Preview report" }));
    expect((await screen.findByTestId("operational-report-narrative")).textContent).toContain("Optional AI narration");
    expect(screen.getByText(/does not change the authoritative statistics/i)).toBeTruthy();
  });
});