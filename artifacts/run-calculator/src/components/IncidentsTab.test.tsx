// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  });
});
