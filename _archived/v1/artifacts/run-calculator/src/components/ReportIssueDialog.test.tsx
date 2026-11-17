import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportIssueDialog from "./ReportIssueDialog";
import { reportIncident, type IncidentDiagnosis } from "../inventoryShared";

vi.mock("../inventoryShared", () => ({
  InventoryApiError: class InventoryApiError extends Error {},
  reportIncident: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportIssueDialog confirmation", () => {
  it("keeps the description after a failed send and confirms a successful manual retry", async () => {
    const response: IncidentDiagnosis = {
      incidentId: "incident-retry",
      correlationId: "corr-retry-visible",
      diagnosis: null,
      workaround: null,
      recurrence: null,
      aiGenerated: false,
    };
    vi.mocked(reportIncident)
      .mockRejectedValueOnce(new Error("Internal request details"))
      .mockResolvedValueOnce(response);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReportIssueDialog
          open
          onOpenChange={vi.fn()}
          screen="live-run"
        />
      </QueryClientProvider>,
    );

    const description = "The Save button did not respond";
    const textarea = screen.getByPlaceholderText(/tapped Save/i);
    await userEvent.type(textarea, description);
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));

    expect(
      await screen.findByText("Couldn't send your report. Please try again."),
    ).not.toBeNull();
    expect(screen.queryByText("Internal request details")).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe(description);

    await userEvent.click(screen.getByRole("button", { name: "Send report" }));

    expect(
      await screen.findByText("Your report was recorded for manager review."),
    ).not.toBeNull();
    expect(screen.getByText("corr-retry-visible")).not.toBeNull();
    expect(reportIncident).toHaveBeenCalledTimes(2);
    expect(reportIncident).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ description }),
    );
    expect(reportIncident).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ description }),
    );
  });

  it("confirms a recorded report and keeps its diagnostic reference without recurrence history", async () => {
    const response: IncidentDiagnosis = {
      incidentId: "incident-123",
      correlationId: "corr-visible",
      diagnosis: null,
      workaround: null,
      recurrence: {
        count: 2,
        lastWorkaround: "Restart the app",
      },
      aiGenerated: false,
    };
    vi.mocked(reportIncident).mockResolvedValueOnce(response);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReportIssueDialog
          open
          onOpenChange={vi.fn()}
          screen="live-run"
        />
      </QueryClientProvider>,
    );

    await userEvent.type(
      screen.getByPlaceholderText(/tapped Save/i),
      "The Save button did not respond",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Your report was recorded for manager review.")).not.toBeNull();
    expect(screen.getByText("corr-visible")).not.toBeNull();
    expect(screen.queryByText(/seen before|last time this helped|kind of problem has come up before/i)).toBeNull();
    expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      source: "user_report",
      screen: "live-run",
      appPlatform: "web",
      description: "The Save button did not respond",
    }));
  });
});
