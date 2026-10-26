// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Incident } from "../inventoryShared";

const mocks = vi.hoisted(() => ({
  fetchIncidents: vi.fn(),
  fetchFieldChecks: vi.fn(),
  fetchIncidentAssignees: vi.fn(),
}));

vi.mock("../inventoryShared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../inventoryShared")>();
  return {
    ...actual,
    fetchIncidents: mocks.fetchIncidents,
    fetchFieldChecks: mocks.fetchFieldChecks,
    fetchIncidentAssignees: mocks.fetchIncidentAssignees,
  };
});
vi.mock("../useRole", () => ({
  useMe: () => ({
    hasCapability: () => true,
    role: "manager",
    isLoading: false,
  }),
}));
vi.mock("../hooks/useIdle", () => ({ useIdle: () => false }));
vi.mock("./IncidentPatternsPanel", () => ({ IncidentPatternsPanel: () => null }));
vi.mock("./FieldEvidenceFilters", () => ({ FieldEvidenceFilters: () => null }));

import IncidentsTab from "./IncidentsTab";

function renderIncidents() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IncidentsTab />
    </QueryClientProvider>,
  );
}

function incidentWithHttpStatus(status: number): Incident {
  return {
    id: `incident-${status}`,
    source: "auto_crash",
    reporterId: null,
    reporterName: "Staff",
    reporterRole: "manager",
    screen: "/",
    appPlatform: "web",
    appVersion: "build-a",
    context: {
      errorMessage: `API ${status}`,
      correlationId: `incident-reference-${status}`,
      requestOperationCategory: status === 403 ? "other" : "sync",
      requestRoute: status === 403 ? "other" : "sync_manual_section",
      requestOutcome: "http_client_error",
      requestHttpStatus: status,
      ...(status === 400 ? { requestReasonCode: "SYNC_VALIDATION_FAILED" } : {}),
      requestObservedAt: "2026-10-26T11:00:00.000Z",
      requestElapsedMs: 150,
      requestBackgroundInvolvement: "not_observed",
    },
    diagnosis: null,
    workaround: null,
    recurrence: null,
    status: "new",
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    resolvedAt: null,
    priority: "normal",
    workflowState: "new",
    assigneeId: null,
    assigneeName: null,
    notes: [],
    activity: [],
  };
}

afterEach(() => {
  cleanup();
  mocks.fetchIncidents.mockReset();
  mocks.fetchFieldChecks.mockReset();
  mocks.fetchIncidentAssignees.mockReset();
  window.location.hash = "";
});

describe("manager incident cancellation guidance", () => {
  it("does not recommend retry or reload for a cancellation with unknown cause", async () => {
    const incident: Incident = {
      id: "incident-1",
      source: "auto_crash",
      reporterId: null,
      reporterName: "Staff",
      reporterRole: "manager",
      screen: "/",
      appPlatform: "web",
      appVersion: "build-a",
      context: {
        errorMessage: "API request cancelled",
        correlationId: "incident-reference-1",
        requestOperationCategory: "authentication",
        requestRoute: "authentication",
        requestOutcome: "cancelled",
        requestElapsedMs: 46,
        requestBackgroundInvolvement: "not_observed",
      },
      diagnosis: null,
      workaround: null,
      recurrence: null,
      status: "new",
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      resolvedAt: null,
      priority: "normal",
      workflowState: "new",
      assigneeId: null,
      assigneeName: null,
      notes: [],
      activity: [],
    };
    mocks.fetchIncidents.mockResolvedValue([incident]);
    mocks.fetchFieldChecks.mockResolvedValue({
      checks: [],
      actionableCount: 0,
      overallStatus: "healthy",
    });
    mocks.fetchIncidentAssignees.mockResolvedValue([]);

    renderIncidents();

    expect(await screen.findByText(/this request ended before a response/)).toBeTruthy();
    expect(screen.getByText("Incident reference:").parentElement?.textContent)
      .toContain("incident-reference-1");
    expect(screen.getByText(/does not show that the server rejected the session/)).toBeTruthy();
    expect(screen.getByText(/the cancellation source is unknown/)).toBeTruthy();
    expect(screen.queryByText(/Related request reference/)).toBeNull();
    expect(screen.queryByText(/retry once|reload or update/i)).toBeNull();
    // The browser fixture must not assume a new issue starts collapsed.
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeTruthy();
    const header = screen.getByRole("button", { name: /Auto-captured crash/i });
    fireEvent.click(header);
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    fireEvent.click(header);
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeTruthy();
  });

  it("explains sync validation rejections without suggesting an unchanged retry", async () => {
    mocks.fetchIncidents.mockResolvedValue([incidentWithHttpStatus(400)]);
    mocks.fetchFieldChecks.mockResolvedValue({ checks: [], actionableCount: 0, overallStatus: "healthy" });
    mocks.fetchIncidentAssignees.mockResolvedValue([]);

    renderIncidents();

    expect(await screen.findByText(/This sync update did not pass a validation check/)).toBeTruthy();
    expect(screen.getByText("Support code:").parentElement?.textContent).toContain("SYNC_VALIDATION_FAILED");
    expect(screen.getByText(/Do not retry the unchanged action/)).toBeTruthy();
    expect(screen.getByText(/App activity:/).parentElement?.textContent).toContain("Syncing saved changes");
    expect(screen.getByText(/Observed by this browser at/)).toBeTruthy();
    expect(screen.getByText(/The browser wait is not server processing time/)).toBeTruthy();
  });

  async function assertPlainLanguageStatus(status: number, expectedSummary: string) {
    const incident = incidentWithHttpStatus(status);
    mocks.fetchIncidents.mockResolvedValue([incident]);
    mocks.fetchFieldChecks.mockResolvedValue({ checks: [], actionableCount: 0, overallStatus: "healthy" });
    mocks.fetchIncidentAssignees.mockResolvedValue([]);

    renderIncidents();

    expect(await screen.findByRole("button", { name: /Auto-captured crash/i })).toBeTruthy();
    expect(screen.getByText(new RegExp(expectedSummary))).toBeTruthy();
    expect(screen.queryByText(/retry once/i)).toBeNull();
    expect(screen.getByText("Incident reference:").parentElement?.textContent)
      .toContain(`incident-reference-${status}`);
  }

  it("explains a 403 permission denial in plain language", async () => {
    await assertPlainLanguageStatus(403, "This request was denied because this account does not currently have permission");
    expect(screen.getByText(/support route: not identified in the available diagnostics/)).toBeTruthy();
  });

  it("explains a 409 conflict in plain language", async () => {
    await assertPlainLanguageStatus(409, "The shared value changed before this save reached the server");
  });
});
