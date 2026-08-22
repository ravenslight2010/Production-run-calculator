// @vitest-environment jsdom
//
// The manager action queue is mounted from the manager attention surface. Its
// capability guard is a UX optimization only — the API remains authoritative —
// but it must avoid showing actionable controls or firing endpoints that are
// guaranteed to return 403 for ordinary staff.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  hasCapability: vi.fn(),
  fetchActionQueue: vi.fn(),
  fetchIncidentAssignees: vi.fn(),
  updateActionItem: vi.fn(),
}));

vi.mock("../useRole", () => ({
  useMe: () => ({
    hasCapability: mocks.hasCapability,
    isLoading: false,
  }),
}));

vi.mock("../actionQueue", () => ({
  fetchActionQueue: mocks.fetchActionQueue,
  fetchIncidentAssignees: mocks.fetchIncidentAssignees,
  updateActionItem: mocks.updateActionItem,
}));

vi.mock("../inventoryShared", () => ({
  fetchIncidentAssignees: mocks.fetchIncidentAssignees,
}));

import ManagerActionQueue from "./ManagerActionQueue";

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ManagerActionQueue />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.hasCapability.mockReset();
  mocks.fetchActionQueue.mockReset();
  mocks.fetchIncidentAssignees.mockReset();
  mocks.updateActionItem.mockReset();
});

describe("ManagerActionQueue access visibility", () => {
  it("hides manager controls and does not query protected endpoints for staff", async () => {
    mocks.hasCapability.mockReturnValue(false);

    renderQueue();

    expect(await screen.findByText(/restricted to managers/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.fetchActionQueue).not.toHaveBeenCalled();
    expect(mocks.fetchIncidentAssignees).not.toHaveBeenCalled();
  });

  it("shows the queue and fetches only when manage-staff is present", async () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.fetchActionQueue.mockResolvedValue({
      items: [],
      counts: { open: 0, in_progress: 0, deferred: 0, resolved: 0 },
    });
    mocks.fetchIncidentAssignees.mockResolvedValue([]);

    renderQueue();

    expect(await screen.findByTestId("manager-action-queue")).toBeTruthy();
    await waitFor(() => expect(mocks.fetchActionQueue).toHaveBeenCalledOnce());
    expect(mocks.fetchIncidentAssignees).toHaveBeenCalledOnce();
  });
});