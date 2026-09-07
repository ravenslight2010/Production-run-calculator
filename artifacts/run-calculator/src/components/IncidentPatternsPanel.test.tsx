// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { requestIncidentClusters } = vi.hoisted(() => ({
  requestIncidentClusters: vi.fn(),
}));
vi.mock("../inventoryShared", () => ({
  requestIncidentClusters,
}));

import { IncidentPatternsPanel } from "./IncidentPatternsPanel";

function renderPanel(disabled = false) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IncidentPatternsPanel disabled={disabled} />
    </QueryClientProvider>,
  );
}

const clusters = [
  {
    theme: "Low volume",
    rootCauseHypothesis: "A low priority pattern",
    recommendedAction: "Observe",
    severity: "low",
    incidentIds: ["4"],
    incidentCount: 9,
  },
  {
    theme: "High repeated",
    rootCauseHypothesis: "The most useful pattern",
    recommendedAction: "Inspect first",
    severity: "high",
    incidentIds: ["1", "2"],
    incidentCount: 7,
  },
  {
    theme: "Medium repeated",
    rootCauseHypothesis: "",
    recommendedAction: "Inspect next",
    severity: "medium",
    incidentIds: ["3"],
    incidentCount: 10,
  },
  {
    theme: "High single",
    rootCauseHypothesis: "",
    recommendedAction: "",
    severity: "high",
    incidentIds: ["5"],
    incidentCount: 1,
  },
] as const;

afterEach(() => {
  cleanup();
  requestIncidentClusters.mockReset();
});

describe("IncidentPatternsPanel", () => {
  it("shows a compact metadata summary before revealing prioritized details", async () => {
    requestIncidentClusters.mockResolvedValue({
      clusters,
      totalIncidents: 27,
      generatedAt: Date.UTC(2026, 8, 7, 12),
      evidence: {
        windowDays: 30,
        sampleCount: 27,
        platforms: ["web", "mobile"],
        builds: ["build-a", "build-b"],
        screens: ["/run"],
        confidence: "strong",
      },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("27");

    expect(requestIncidentClusters).toHaveBeenCalledWith();
    expect(screen.getByText("30 days")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText(/Confidence is strong/)).toBeTruthy();
    expect(screen.queryByText("High repeated")).toBeNull();

    const disclosure = screen.getByRole("button", { name: "Review pattern details" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await user.click(disclosure);

    const results = screen.getByTestId("incident-clusters-result");
    const articles = within(results).getAllByRole("article");
    expect(articles).toHaveLength(3);
    expect(articles[0].textContent).toContain("High repeated");
    expect(articles[1].textContent).toContain("High single");
    expect(articles[2].textContent).toContain("Medium repeated");
    expect(screen.queryByText("Low volume")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show all 4 patterns" }));
    expect(screen.getByText("Low volume")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show top 3" })).toBeTruthy();
  });

  it("preserves insufficient-evidence, refresh, loading, and error behavior", async () => {
    requestIncidentClusters.mockResolvedValueOnce({
      clusters: [],
      totalIncidents: 1,
      note: "Not enough incidents yet to find a pattern.",
      generatedAt: Date.now(),
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("Not enough incidents yet to find a pattern.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();

    let rejectRefresh!: (error: Error) => void;
    requestIncidentClusters.mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByText("Analyzing the last 30 days…")).toBeTruthy();
    rejectRefresh(new Error("failed"));
    await waitFor(() =>
      expect(screen.getByText("Couldn't group the incident log.")).toBeTruthy(),
    );
  });

  it("disables analysis when the incident surface is unavailable", () => {
    renderPanel(true);
    expect(screen.getByRole("button", { name: "Analyze" }).hasAttribute("disabled")).toBe(true);
  });
});