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
      <RunInsightsCard
        brand="Acme"
        flavor="Pepperoni"
        onAccept={onAccept}
        getAcceptWarning={getAcceptWarning}
      />
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
  it("renders only suggestions for the product being reviewed", async () => {
    vi.mocked(fetchRunSuggestions).mockResolvedValue([
      makeSuggestion(),
      makeSuggestion({
        id: "sug-other",
        brand: "Other Brand",
        flavor: "Other Flavor",
        updatedAt: Date.now() + 1,
      }),
    ]);

    renderCard(() => null);

    await waitFor(() =>
      expect(screen.getByTestId("suggestion-speed-target")).toBeTruthy(),
    );

    expect(screen.getByTestId("suggestion-speed-target").textContent).toContain("Acme Pepperoni");
    expect(screen.queryByText(/Other Brand Other Flavor/)).toBeNull();
  });

  it("cancels the suggestions query when the card unmounts", async () => {
    let querySignal: AbortSignal | undefined;
    vi.mocked(fetchRunSuggestions).mockImplementation((signal) => {
      querySignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const { unmount } = renderCard(() => null);
    await waitFor(() => expect(querySignal).toBeInstanceOf(AbortSignal));

    unmount();

    expect(querySignal?.aborted).toBe(true);
  });

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

  it("warning clears automatically when getAcceptWarning switches to null (profile saved mid-session)", async () => {
    // Start with a warning — no profile saved yet
    const onAccept = vi.fn().mockResolvedValue("Applied.");
    const qc = makeQueryClient();

    let getAcceptWarningFn: (s: RunSuggestion) => string | null | undefined =
      () => "No saved setup for this product — open its Setup profile first.";

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <RunInsightsCard
          brand="Acme"
          flavor="Pepperoni"
          onAccept={onAccept}
          getAcceptWarning={(s) => getAcceptWarningFn(s)}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("suggestion-speed-target")).toBeTruthy(),
    );

    // Warning is shown before the profile is saved
    expect(screen.getByTestId("text-run-insights-accept-warning")).toBeTruthy();

    // Simulate manager saving the profile — getAcceptWarning now returns null
    getAcceptWarningFn = () => null;

    rerender(
      <QueryClientProvider client={qc}>
        <RunInsightsCard
          brand="Acme"
          flavor="Pepperoni"
          onAccept={onAccept}
          getAcceptWarning={(s) => getAcceptWarningFn(s)}
        />
      </QueryClientProvider>,
    );

    // Warning must be gone without a manual refresh
    expect(screen.queryByTestId("text-run-insights-accept-warning")).toBeNull();

    // Accept button is still present and functional
    const acceptBtn = screen.getByTestId("button-run-insights-accept");
    expect(acceptBtn).toBeTruthy();

    await userEvent.click(acceptBtn);

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: "sug-1" }));
  });
});
