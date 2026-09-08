// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  fetchSyncHealth: vi.fn(),
}));

vi.mock("../syncDiagnostics", () => ({
  fetchSyncHealth: mocks.fetchSyncHealth,
}));

vi.mock("../profileDataHealth", () => ({
  applyDataHealthRepairs: vi.fn(),
  applyAiRetentionCleanup: vi.fn(),
  fetchDataHealthWorkspace: vi.fn(),
  undoProfileDataHealthRepair: vi.fn(),
}));

vi.mock("@/masterData", () => ({
  MASTER_DATA_QUERY_KEY: ["master-data"],
}));

import DataHealthWorkspace from "./DataHealthWorkspace";

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DataHealthWorkspace />
    </QueryClientProvider>,
  );
}

const report = (status: "healthy" | "warning" | "failing") => ({
  contractVersion: 1 as const,
  scope: "live" as const,
  date: "2030-03-10",
  checkedAt: "2030-03-10T12:00:00.000Z",
  status,
  nextAction: status === "healthy" ? "No action required." : "Review the named invariant; no repair was performed.",
  checks: [{
    name: "canonical-document" as const,
    status,
    summary: status === "healthy" ? "Canonical row is present." : "Canonical evidence needs review.",
    nextAction: "Review the canonical row.",
  }],
  bounds: { maxLedgerRows: 100, maxHistoryRows: 100 },
  evidence: {
    dailyRowPresent: true,
    canonicalRevision: 3,
    snapshotId: "a".repeat(64),
    ledgerRowsScanned: 0,
    ledgerRowsTruncated: false,
    historyRowsScanned: 0,
    historyRowsTruncated: false,
  },
});

afterEach(() => {
  cleanup();
  mocks.fetchSyncHealth.mockReset();
});

describe("DataHealthWorkspace sync health sentinel", () => {
  it("runs only on manager action and renders a healthy result with timestamp", async () => {
    mocks.fetchSyncHealth.mockResolvedValue(report("healthy"));
    renderWorkspace();

    expect(mocks.fetchSyncHealth).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /run self-check/i }));

    expect((await screen.findByTestId("sync-health-status")).textContent).toContain("healthy");
    expect(screen.getByText(/checked/i)).toBeTruthy();
    await waitFor(() => expect(mocks.fetchSyncHealth).toHaveBeenCalledOnce());
  });

  it("renders warning/failing guidance without presenting the result as repaired", async () => {
    mocks.fetchSyncHealth.mockResolvedValue(report("failing"));
    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /run self-check/i }));

    expect((await screen.findByTestId("sync-health-status")).textContent).toContain("failing");
    expect(screen.getByText(/no repair was performed/i)).toBeTruthy();
  });
});