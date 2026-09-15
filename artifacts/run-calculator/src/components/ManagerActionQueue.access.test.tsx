// @vitest-environment jsdom
//
// The manager action queue is mounted from the manager attention surface. Its
// capability guard is a UX optimization only — the API remains authoritative —
// but it must avoid showing actionable controls or firing endpoints that are
// guaranteed to return 403 for ordinary staff.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function item(id: number, title: string) {
  return {
    id, scope: "live", dedupKey: `report:${id}`, category: "report" as const,
    severity: "warning" as const, title, description: "Fixture",
    sourceType: "report", sourceId: String(id), sourcePath: "#manager-action-queue",
    status: "open" as const, assigneeId: null, assigneeName: null,
    deferReason: null, resolutionNote: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1,
  };
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

  it("collects required transition text and keeps drafts isolated per queue item", async () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.fetchActionQueue.mockResolvedValue({
      items: [item(1, "First action"), item(2, "Second action")],
      counts: { open: 2, in_progress: 0, deferred: 0, resolved: 0 },
    });
    mocks.fetchIncidentAssignees.mockResolvedValue([]);
    mocks.updateActionItem.mockImplementation(async (_id, input) => ({
      ...item(_id, _id === 1 ? "First action" : "Second action"),
      ...input,
      version: 2,
    }));
    renderQueue();

    const first = (await screen.findByText("First action")).closest("div.rounded-md")!;
    const second = screen.getByText("Second action").closest("div.rounded-md")!;
    fireEvent.click(within(first).getByRole("button", { name: "Details" }));
    fireEvent.change(within(first).getByLabelText("Status for First action"), { target: { value: "deferred" } });
    expect(mocks.updateActionItem).not.toHaveBeenCalled();
    const firstDraft = within(first).getByLabelText("Defer reason for First action");
    fireEvent.change(firstDraft, { target: { value: "Waiting for source owner" } });

    fireEvent.click(within(second).getByRole("button", { name: "Details" }));
    fireEvent.change(within(second).getByLabelText("Status for Second action"), { target: { value: "resolved" } });
    expect((within(second).getByLabelText("Note for Second action") as HTMLInputElement).value).toBe("");
    expect((firstDraft as HTMLInputElement).value).toBe("Waiting for source owner");

    fireEvent.click(within(first).getByRole("button", { name: "Confirm deferred" }));
    await waitFor(() => expect(mocks.updateActionItem).toHaveBeenCalledWith(1, {
      version: 1,
      status: "deferred",
      deferReason: "Waiting for source owner",
    }));
  });

  it("keeps another item's draft when a stale update fails", async () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.fetchActionQueue.mockResolvedValue({
      items: [item(1, "First action"), item(2, "Second action")],
      counts: { open: 2, in_progress: 0, deferred: 0, resolved: 0 },
    });
    mocks.fetchIncidentAssignees.mockResolvedValue([]);
    mocks.updateActionItem.mockRejectedValue(new Error("This action item changed; refresh and try again."));
    renderQueue();

    const first = (await screen.findByText("First action")).closest("div.rounded-md")!;
    const second = screen.getByText("Second action").closest("div.rounded-md")!;
    fireEvent.click(within(second).getByRole("button", { name: "Details" }));
    fireEvent.change(within(second).getByLabelText("Status for Second action"), { target: { value: "deferred" } });
    const secondDraft = within(second).getByLabelText("Defer reason for Second action");
    fireEvent.change(secondDraft, { target: { value: "Waiting on the source owner" } });

    fireEvent.click(within(first).getByRole("button", { name: "Claim" }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed; refresh and try again");
    expect((secondDraft as HTMLInputElement).value).toBe("Waiting on the source owner");
  });
});