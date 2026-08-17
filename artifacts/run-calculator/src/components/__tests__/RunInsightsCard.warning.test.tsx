// @vitest-environment jsdom
//
// Render guard: confirms the no-profile warning in RunInsightsCard appears in
// exactly the right cases and that Accept still fires even when it is visible.
//
// The warning element (data-testid="text-run-insights-accept-warning") is
// driven by the `getAcceptWarning` prop.  home.tsx supplies
// getRunSuggestionAcceptWarning, which returns a non-empty string when the
// suggestion targets a product whose brand/flavor has no saved profile AND is
// not the currently-open run.  These tests verify the component wiring:
//
//   1. getAcceptWarning returns a non-empty string → warning element is shown
//   2. getAcceptWarning returns null (isCurrentRun=true case) → no warning
//   3. getAcceptWarning returns null (profile-exists case) → no warning
//   4. Accept button calls onAccept even when the warning is visible

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RunInsightsCard from "../RunInsightsCard";
import type { RunSuggestion } from "../../runInsights";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../runInsights", async () => {
  const actual = await vi.importActual<typeof import("../../runInsights")>(
    "../../runInsights",
  );
  return {
    ...actual,
    fetchRunSuggestions: vi.fn(),
    updateRunSuggestion: vi.fn(),
  };
});

import { fetchRunSuggestions, updateRunSuggestion } from "../../runInsights";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSuggestion(overrides: Partial<RunSuggestion> = {}): RunSuggestion {
  return {
    id: "sug-1",
    type: "speed-target",
    brand: "Acme",
    flavor: "Pepperoni",
    dieType: "",
    observedValue: 14,
    configuredValue: 12,
    recommendedValue: 14,
    unit: "fpm",
    runCount: 5,
    statsLine: "Avg 14 fpm over 5 runs",
    narrative: "Consider updating cycle speed to 14 fpm.",
    status: "pending",
    followUpNote: "",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderCard(
  getAcceptWarning: (s: RunSuggestion) => string | null | undefined,
  onAccept: (s: RunSuggestion) => Promise<string> = () => Promise.resolve("Applied."),
) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <RunInsightsCard onAccept={onAccept} getAcceptWarning={getAcceptWarning} />
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(fetchRunSuggestions).mockResolvedValue([makeSuggestion()]);
  vi.mocked(updateRunSuggestion).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RunInsightsCard — accept warning visibility", () => {
  it("shows the warning element when getAcceptWarning returns a non-empty string", async () => {
    renderCard(() => "No saved setup for this product — open its Setup profile first.");

    // Wait for the pending suggestion to render
    await waitFor(() =>
      expect(screen.getByTestId("suggestion-speed-target")).toBeTruthy(),
    );

    expect(screen.getByTestId("text-run-insights-accept-warning")).toBeTruthy();
    expect(screen.getByTestId("text-run-insights-accept-warning").textContent).toContain(
      "No saved setup for this product",
    );
  });

  it("hides the warning element when getAcceptWarning returns null (isCurrentRun=true case)", async () => {
    // Simulates: the suggestion targets the currently-open run → no warning needed
    renderCard(() => null);

    await waitFor(() =>
      expect(screen.getByTestId("suggestion-speed-target")).toBeTruthy(),
    );

    expect(screen.queryByTestId("text-run-insights-accept-warning")).toBeNull();
  });

  it("hides the warning element when getAcceptWarning returns null (profile-exists case)", async () => {
    // Simulates: a real saved profile exists → Accept will succeed → no warning
    renderCard(() => null);

    await waitFor(() =>
      expect(screen.getByTestId("suggestion-speed-target")).toBeTruthy(),
    );

    expect(screen.queryByTestId("text-run-insights-accept-warning")).toBeNull();
  });

  it("Accept button calls onAccept even when the warning is visible", async () => {
    const onAccept = vi.fn().mockResolvedValue("Applied.");
    renderCard(
      () => "No saved setup for this product — open its Setup profile first.",
      onAccept,
    );

    await waitFor(() =>
      expect(screen.getByTestId("suggestion-speed-target")).toBeTruthy(),
    );

    // Warning is visible
    expect(screen.getByTestId("text-run-insights-accept-warning")).toBeTruthy();

    // Accept button is present and clickable
    const acceptBtn = screen.getByTestId("button-run-insights-accept");
    expect(acceptBtn).toBeTruthy();

    await userEvent.click(acceptBtn);

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: "sug-1" }));
  });
});
