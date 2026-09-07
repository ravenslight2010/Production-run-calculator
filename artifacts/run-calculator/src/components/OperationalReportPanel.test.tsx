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
const healthyProofKeyHealth = {
  status: "healthy",
  activeKeyId: "current",
  storedProofKeyIds: ["current"],
  availableStoredProofKeyIds: ["current"],
  missingStoredProofKeyIds: [],
  scan: { limit: 100, checkedDistinctKeyIds: 1, truncated: false },
  message: "Every stored finalized-report proof key checked by this audit is retained in the configured keyring.",
  remediation: null,
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/operational/finalized/proof-key-health");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/reports/operational");
    const request = fetchMock.mock.calls[1][1] as RequestInit;
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
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
    expect(screen.getAllByText("15/20")).toHaveLength(2);
    expect(screen.getAllByText("7m")).toHaveLength(2);
    expect(screen.getByText(/Quality: UNAVAILABLE — Unavailable in local\/offline fallback/i)).toBeTruthy();
    expect(screen.getByText(/Incidents: UNAVAILABLE — Unavailable in local\/offline fallback/i)).toBeTruthy();
    expect(screen.getByText(/Inventory flags: UNAVAILABLE — Unavailable in local\/offline fallback/i)).toBeTruthy();
    expect(screen.getByText(/Only unfinished production runs on this device/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Excel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print / PDF" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Finalize" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("finalizes only an authoritative preview and lets a manager browse and view archived reports", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null, role: null, capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents", isManager: true, isLoading: false,
    });
    const archived = {
      id: "11111111-1111-4111-8111-111111111111",
      reportScope: "day",
      periodStart: "2026-09-04", periodEnd: "2026-09-04",
      finalizedAt: "2026-09-04T13:00:00.000Z", finalizedBy: "manager",
      contentHash: "a".repeat(64), report,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => healthyProofKeyHealth })
      .mockResolvedValueOnce({ ok: true, json: async () => report })
      .mockResolvedValueOnce({ ok: true, json: async () => archived })
      .mockResolvedValueOnce({ ok: true, json: async () => [archived] })
      .mockResolvedValueOnce({ ok: true, json: async () => archived });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Preview report" }));
    await userEvent.click(screen.getByRole("button", { name: "Finalize" }));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/reports/operational/finalize");
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toEqual({
      scope: "day", date: expect.any(String),
    });
    expect(await screen.findByText(/Authoritative report finalized/i)).toBeTruthy();
    expect(screen.getByText(/Finalized report results/i)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Finalized report history" }).textContent).toContain("Day");
    expect(String(fetchMock.mock.calls[3][0])).toMatch(/startDate=.*&endDate=.*&limit=100/);
    await userEvent.click(screen.getByRole("button", { name: "View finalized report" }));
    expect(fetchMock.mock.calls[4][0]).toBe(`/api/reports/operational/finalized/${archived.id}`);
    expect(await screen.findByText(/Viewing immutable finalized report/i)).toBeTruthy();
  });

  it("shows missing key IDs and links managers back to the finalized archive audit", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null, role: null, capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents", isManager: true, isLoading: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...healthyProofKeyHealth,
        status: "attention-required",
        storedProofKeyIds: ["current", "retired-2024"],
        availableStoredProofKeyIds: ["current"],
        missingStoredProofKeyIds: ["retired-2024"],
        scan: { limit: 100, checkedDistinctKeyIds: 2, truncated: false },
        message: "Finalized report proof-key retention needs manager attention.",
        remediation: "Restore the retained signing key for proof key ID retired-2024.",
      }),
    }));
    renderPanel();
    expect(await screen.findByText(/Report verification needs attention/i)).toBeTruthy();
    expect(screen.getAllByText(/retired-2024/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /finalized report archive audit/i }).getAttribute("href")).toBe("#finalized-report-archive-heading");
    expect(screen.queryByText(/test-operational-report-signing-key/i)).toBeNull();
  });

  it("keeps unauthorized and unavailable health states safe for the archive", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null, role: null, capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents", isManager: true, isLoading: false,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    expect(await screen.findByText(/verification health is available to managers only/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Preview report/i })).toBeTruthy();

    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    cleanup();
    renderPanel();
    expect(await screen.findByText(/temporarily unavailable/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/temporarily unavailable/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("labels a bounded partial result without hiding the affected archive workflow", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null, role: null, capabilities: ["review-incidents"],
      hasCapability: (cap) => cap === "review-incidents", isManager: true, isLoading: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...healthyProofKeyHealth,
        status: "attention-required",
        scan: { limit: 100, checkedDistinctKeyIds: 100, truncated: true },
        message: "Finalized report proof-key retention needs manager attention.",
        remediation: "Run a complete offline audit before rotating keys.",
      }),
    }));
    renderPanel();
    expect(await screen.findByText(/verification health audit is partial/i)).toBeTruthy();
    expect(screen.getByText(/checked 100 of more than 100 distinct stored key IDs/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /finalized report archive audit/i })).toBeTruthy();
  });

});