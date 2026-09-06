// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperationalReport } from "@workspace/day-summary";
import OperationalReportPanel from "./OperationalReportPanel";
import type { SummaryRunInput } from "../aiSummary";
import { useMe } from "../useRole";

vi.mock("../useRole", () => ({ useMe: vi.fn() }));
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

function renderPanel(runs: SummaryRunInput[] = []) {
  return render(
    <OperationalReportPanel
      buildInput={(scope, date) => ({ scope, date, nowMs: 0, runs })}
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

  it("posts only the canonical scope and date and uses the authoritative response", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null,
      role: null,
      capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents",
      isManager: false,
      isLoading: false,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => report,
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Preview report" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/operational");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body as string)).toEqual({
      scope: "day",
      date: expect.any(String),
    });
    expect(await screen.findByText(/Quality: Unavailable — Quality history unavailable/i)).toBeTruthy();
    expect(screen.getByText(/60\/100/)).toBeTruthy();
    expect(screen.getByText("Stoppages")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/authoritative and deterministic/i);
    expect(screen.getByText(/authoritative source values/i)).toBeTruthy();
  });

  it("renders a clearly labeled local/offline aggregate when the report request fails", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null,
      role: null,
      capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents",
      isManager: false,
      isLoading: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    renderPanel([{
      brand: "Local",
      flavor: "Run",
      casesPlanned: 20,
      casesProduced: 15,
      finished: false,
      downtimeMinutes: 7,
      stoppageCount: 2,
    }]);

    await userEvent.click(screen.getByRole("button", { name: "Preview report" }));

    expect(await screen.findByText(/Local\/offline fallback ready/i)).toBeTruthy();
    expect(screen.getByText(/local\/offline fallback:.*not authoritative/i)).toBeTruthy();
    expect(screen.getByText("15/20")).toBeTruthy();
    expect(screen.getByText("7m")).toBeTruthy();
    expect(screen.getByText(/Quality: Unavailable — Unavailable in local\/offline fallback/i)).toBeTruthy();
    expect(screen.getByText(/Incidents: Unavailable — Unavailable in local\/offline fallback/i)).toBeTruthy();
    expect(screen.getByText(/Inventory flags: Unavailable — Unavailable in local\/offline fallback/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Export .txt/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

});