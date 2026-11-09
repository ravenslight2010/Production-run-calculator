// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  fetchSyncHealth: vi.fn(),
  submitAndWaitForServerJob: vi.fn(),
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

vi.mock("../serverJobs", () => ({
  submitAndWaitForServerJob: mocks.submitAndWaitForServerJob,
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
  legacySyncReadiness: {
    compatibilityMode: "accept" as const,
    status: "not-ready" as const,
    acceptedLegacyWrites: 0,
    rejectedLegacyWrites: 0,
    requiredAcceptedLegacyWrites: 0 as const,
    windowMs: 86_400_000,
    observedFrom: "2030-03-10T06:00:00.000Z",
    observedUntil: "2030-03-10T12:00:00.000Z",
    fullWindowObserved: false,
    expiresAt: "2030-03-10T12:05:00.000Z",
  },
  syncPeerFrames: {
    windowMs: 45_000,
    exactSnapshotSkipped: 3,
    partialSent: 2,
    completeSent: 1,
  },
});

afterEach(() => {
  cleanup();
  mocks.fetchSyncHealth.mockReset();
  mocks.submitAndWaitForServerJob.mockReset();
});

describe("DataHealthWorkspace sync health sentinel", () => {
  it("runs only on manager action and renders a healthy result with timestamp", async () => {
    mocks.fetchSyncHealth.mockResolvedValue(report("healthy"));
    renderWorkspace();

    expect(mocks.fetchSyncHealth).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /run self-check/i }));

    expect((await screen.findByTestId("sync-health-status")).textContent).toContain("healthy");
    expect(screen.getByText(/checked/i)).toBeTruthy();
    expect(screen.getByTestId("legacy-sync-readiness").textContent).toContain("zero accepted legacy writes");
    expect(screen.getByTestId("legacy-sync-readiness").textContent).toContain("not cutoff proof");
    expect(screen.getByTestId("legacy-sync-readiness").textContent).toContain("Evidence expires");
    expect(screen.getByTestId("sync-peer-frames").textContent).toContain("Exact-snapshot updates skipped: 3");
    expect(screen.getByTestId("sync-peer-frames").textContent).toContain("Partial frames sent: 2");
    expect(screen.getByTestId("sync-peer-frames").textContent).toContain("Complete frames sent: 1");
    expect(screen.getByTestId("sync-peer-frames").textContent).toContain("Current telemetry window: 45 seconds");
    await waitFor(() => expect(mocks.fetchSyncHealth).toHaveBeenCalledOnce());
  });

  it("renders warning/failing guidance without presenting the result as repaired", async () => {
    mocks.fetchSyncHealth.mockResolvedValue(report("failing"));
    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /run self-check/i }));

    expect((await screen.findByTestId("sync-health-status")).textContent).toContain("failing");
    expect(screen.getByText(/no repair was performed/i)).toBeTruthy();
  });

  it("requires confirmation and reports a verified scoped projection backfill", async () => {
    mocks.fetchSyncHealth.mockResolvedValue(report("warning"));
    mocks.submitAndWaitForServerJob.mockResolvedValue({
      status: "completed",
      examinedDays: 98,
      projectedRuns: 12,
    });
    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /run self-check/i }));
    await userEvent.click(await screen.findByRole("button", { name: /prepare one-time backfill/i }));
    expect(mocks.submitAndWaitForServerJob).not.toHaveBeenCalled();
    expect(screen.getByText(/does not change those snapshots or scheduled alert audit records/i)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /confirm backfill/i }));

    expect(await screen.findByText(/verified 98 day snapshots and 12 projected runs/i)).toBeTruthy();
    expect(mocks.submitAndWaitForServerJob).toHaveBeenCalledWith({
      type: "freezer-alert-projection-backfill",
      input: { expectedScope: "live" },
      pollIntervalMs: 2_000,
    });
  });

  it("shows a safe recovery message if projection backfill fails", async () => {
    mocks.fetchSyncHealth.mockResolvedValue(report("warning"));
    mocks.submitAndWaitForServerJob.mockRejectedValue(new Error("database details must not be shown"));
    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /run self-check/i }));
    await userEvent.click(await screen.findByRole("button", { name: /prepare one-time backfill/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm backfill/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Daily snapshots and alert audit records were not changed");
    expect(alert.textContent).not.toContain("database details");
  });

  it("rejects malformed projection backfill results", async () => {
    mocks.fetchSyncHealth.mockResolvedValue(report("warning"));
    mocks.submitAndWaitForServerJob.mockResolvedValue({
      status: "completed",
      examinedDays: "98",
      projectedRuns: 12,
    });
    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /run self-check/i }));
    await userEvent.click(await screen.findByRole("button", { name: /prepare one-time backfill/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm backfill/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/verified 98 day snapshots/i)).toBeNull();
  });
});
