// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QcAllergenReviewInput } from "@workspace/api-client-react";
import { DEFAULT_VALUES } from "../types";
import QcWorkflowTab from "./QcWorkflowTab";

const qcMocks = vi.hoisted(() => ({
  targets: {
    data: {
      profileKey: "brand::flavor",
      targets: [{
        ingredientId: "flour",
        ingredientName: "Flour",
        targetValue: null,
        unit: null,
        toleranceValue: null,
        source: "not-configured",
        state: "not-evaluated",
        reason: "No explicit target is available.",
      }] as Array<{
        ingredientId: string;
        ingredientName: string;
        targetValue: number | null;
        unit: string | null;
        toleranceValue: number | null;
        source: string;
        state: string;
        reason?: string;
      }>,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  run: {
    data: {
      runId: "run-1",
      items: [] as Array<{
        id: number;
        eventType: string;
        ingredientId: string | null;
        payload: Record<string, unknown>;
        createdAt: string;
      }>,
      hasMore: false,
      weightCheckEvents: [] as Array<{
        ingredientId: string;
        checkType: "pre-run" | "30-minute";
        createdAt: string;
      }>,
      weightCheckEventsComplete: true,
      signoff: null,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  runs: {} as Record<string, unknown>,
  history: {
    data: { items: [], hasMore: false },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  mutation: {
    mutateAsync: vi.fn(),
    error: null,
    isPending: false,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  exportQcHistoryCsv: vi.fn(),
  getGetQcHistoryQueryKey: (...args: unknown[]) => ["qc-history", ...args],
  getGetQcRunQueryKey: (...args: unknown[]) => ["qc-run", ...args],
  getGetQcTargetsQueryKey: (...args: unknown[]) => ["qc-targets", ...args],
  useCorrectQcEvent: () => qcMocks.mutation,
  useGetQcHistory: () => qcMocks.history,
  useGetQcRun: (runId: string) => (qcMocks.runs[runId] as typeof qcMocks.run | undefined) ?? qcMocks.run,
  useGetQcTargets: () => qcMocks.targets,
  useRecordQcAllergenReview: () => qcMocks.mutation,
  useRecordQcCleaning: () => qcMocks.mutation,
  useRecordQcLot: () => qcMocks.mutation,
  useRecordQcWeightCheck: () => qcMocks.mutation,
  useRedactQcEvent: () => qcMocks.mutation,
  useSetQcTarget: () => qcMocks.mutation,
  useSignoffQcRun: () => qcMocks.mutation,
  useVerifyQcCleaning: () => qcMocks.mutation,
}));

vi.mock("../masterData", () => ({
  useMasterDataSlice: () => ({
    data: [{
      id: "flour",
      name: "Flour",
      categories: ["dough"],
      mergedInto: null,
      enabled: true,
      allergens: [],
      allergensReviewed: false,
    }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("./QualityHistoryTab", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useRealTimers();
  qcMocks.targets.data = {
    profileKey: "brand::flavor",
    targets: [{
      ingredientId: "flour",
      ingredientName: "Flour",
      targetValue: null,
      unit: null,
      toleranceValue: null,
      source: "not-configured",
      state: "not-evaluated",
      reason: "No explicit target is available.",
    }] as Array<{
      ingredientId: string;
      ingredientName: string;
      targetValue: number | null;
      unit: string | null;
      toleranceValue: number | null;
      source: string;
      state: string;
      reason?: string;
    }>,
  };
  qcMocks.run.data = {
    runId: "run-1",
    items: [],
    hasMore: false,
    weightCheckEvents: [],
    weightCheckEventsComplete: true,
    signoff: null,
  };
  qcMocks.runs = {};
});

const stagedIngredients: QcAllergenReviewInput["stagedIngredients"] = [
  { area: "Dough", name: "Flour", quantity: "5", unit: "lbs", staged: true },
  { area: "Sauce", name: "Tomato sauce", quantity: "2", unit: "lbs", staged: false },
];

type RenderOptions = {
  runId?: string;
  runStartedAt?: number | null;
  runStoppages?: Array<{ type?: string; startedAt: number; endedAt?: number }>;
  runIsActive?: boolean;
};

function renderTab(options: RenderOptions = {}) {
  let currentOptions = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderUi = () => (
    <QueryClientProvider client={queryClient}>
      <QcWorkflowTab
        runId={currentOptions.runId ?? "run-1"}
        runStartedAt={currentOptions.runStartedAt ?? null}
        runStoppages={currentOptions.runStoppages ?? []}
        profileKey="brand::flavor"
        runIsActive={currentOptions.runIsActive ?? false}
        values={DEFAULT_VALUES}
        substitutions={[]}
        stagedIngredients={stagedIngredients}
        canRecordQc
        canManageQc={false}
        canViewPhotos={false}
      />
    </QueryClientProvider>
  );
  const rendered = render(renderUi());
  return {
    ...rendered,
    rerenderTab: (nextOptions: RenderOptions) => {
      currentOptions = nextOptions;
      rendered.rerender(renderUi());
    },
  };
}

describe("QC workflow UI", () => {
  it("keeps unknown allergen and staging states visible and shows not-evaluated targets", () => {
    renderTab();

    expect(screen.getByRole("heading", { name: "Quality checks" })).toBeTruthy();
    expect(screen.getByTestId("qc-staged-ingredients-snapshot")).toBeTruthy();
    expect(screen.getByText("1/2 marked staged")).toBeTruthy();
    expect(screen.getByText("Not marked")).toBeTruthy();
    expect(screen.getByText("Coverage unknown / incomplete")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Weights" }));
    fireEvent.change(screen.getByLabelText("Ingredient"), {
      target: { value: "flour" },
    });

    expect(screen.getByText("Not evaluated — a valid QC target is not configured.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Lots" })).toBeTruthy();
  });

  it("labels active-run weight checks as 30-minute checks", () => {
    renderTab({ runIsActive: true });
    fireEvent.click(screen.getByRole("tab", { name: "Weights" }));

    expect(screen.getByLabelText("Check timing").textContent).toContain("30-minute active-run check");
  });

  it("shows each configured target's next check time and marks due and overdue reminders", () => {
    const now = Date.parse("2025-01-01T00:31:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    qcMocks.targets.data.targets = [{
      ingredientId: "flour",
      ingredientName: "Flour",
      targetValue: 12,
      unit: "oz",
      toleranceValue: 0.1,
      source: "spec-import",
      state: "configured",
    }];
    renderTab({ runIsActive: true, runStartedAt: now - 31 * 60_000 });

    const reminder = screen.getByTestId("qc-weight-reminder-flour");
    expect(reminder.textContent).toContain("Due now");
    expect(reminder.querySelector("time")?.getAttribute("datetime"))
      .toBe(new Date(now - 60_000).toISOString());
    expect(screen.queryByTestId("qc-weight-reminder-unknown")).toBeNull();

    act(() => {
      vi.setSystemTime(now + 30 * 60_000);
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByTestId("qc-weight-reminder-flour").textContent).toContain("Overdue");
  });

  it("does not show misleading reminder times when the weight-check timeline is truncated", () => {
    const now = Date.parse("2025-01-01T02:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    qcMocks.targets.data.targets = [{
      ingredientId: "flour",
      ingredientName: "Flour",
      targetValue: 12,
      unit: "oz",
      toleranceValue: 0.1,
      source: "spec-import",
      state: "configured",
    }];
    qcMocks.run.data = {
      runId: "run-1",
      items: [],
      hasMore: false,
      weightCheckEvents: [],
      weightCheckEventsComplete: false,
      signoff: null,
    };
    renderTab({ runIsActive: true, runStartedAt: now - 2 * 60 * 60_000 });

    expect(screen.getByRole("status").textContent)
      .toContain("more weight records than can be summarized");
    expect(screen.queryByTestId("qc-weight-reminder-flour")).toBeNull();
  });

  it("uses a saved check to set the next reminder and recalculates when switching runs", () => {
    const start = Date.parse("2025-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start + 45 * 60_000);
    qcMocks.targets.data.targets = [{
      ingredientId: "flour",
      ingredientName: "Flour",
      targetValue: 12,
      unit: "oz",
      toleranceValue: 0.1,
      source: "spec-import",
      state: "configured",
    }];
    qcMocks.runs["run-1"] = {
      ...qcMocks.run,
      data: {
        runId: "run-1",
        items: [],
        hasMore: true,
        weightCheckEvents: [{
          ingredientId: "flour",
          checkType: "30-minute",
          createdAt: new Date(start + 20 * 60_000).toISOString(),
        }],
        weightCheckEventsComplete: true,
      },
    };
    qcMocks.runs["run-2"] = {
      ...qcMocks.run,
      data: { runId: "run-2", items: [] },
    };
    const rendered = renderTab({
      runId: "run-1",
      runIsActive: true,
      runStartedAt: start,
    });
    expect(screen.getByTestId("qc-weight-reminder-flour").querySelector("time")?.getAttribute("datetime"))
      .toBe(new Date(start + 50 * 60_000).toISOString());

    rendered.rerenderTab({
      runId: "run-2",
      runIsActive: true,
      runStartedAt: start + 40 * 60_000,
    });
    expect(screen.getByTestId("qc-weight-reminder-flour").querySelector("time")?.getAttribute("datetime"))
      .toBe(new Date(start + 70 * 60_000).toISOString());
  });

  it("keeps reminders paused and resumes on the active-time schedule", () => {
    const start = Date.parse("2025-01-01T00:00:00.000Z");
    const pauseStart = start + 35 * 60_000;
    const resumedAt = start + 55 * 60_000;
    vi.useFakeTimers();
    vi.setSystemTime(resumedAt);
    qcMocks.targets.data.targets = [{
      ingredientId: "flour",
      ingredientName: "Flour",
      targetValue: 12,
      unit: "oz",
      toleranceValue: 0.1,
      source: "spec-import",
      state: "configured",
    }];
    qcMocks.run.data = {
      runId: "run-1",
      items: [{
        id: 1,
        eventType: "weight",
        ingredientId: "flour",
        payload: { checkType: "30-minute" },
        createdAt: new Date(start + 30 * 60_000).toISOString(),
      }],
      signoff: null,
    };
    const rendered = renderTab({
      runIsActive: false,
      runStartedAt: start,
      runStoppages: [{ type: "pause", startedAt: pauseStart }],
    });
    expect(screen.queryByTestId("qc-weight-reminders")).toBeNull();

    rendered.rerenderTab({
      runIsActive: true,
      runStartedAt: start + 20 * 60_000,
      runStoppages: [{ type: "pause", startedAt: pauseStart, endedAt: resumedAt }],
    });
    expect(screen.getByTestId("qc-weight-reminder-flour").querySelector("time")?.getAttribute("datetime"))
      .toBe(new Date(start + 80 * 60_000).toISOString());
  });

  it("recreates the same reminder after remounting with persisted run data", () => {
    const start = Date.parse("2025-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start + 50 * 60_000);
    qcMocks.targets.data.targets = [{
      ingredientId: "flour",
      ingredientName: "Flour",
      targetValue: 12,
      unit: "oz",
      toleranceValue: 0.1,
      source: "spec-import",
      state: "configured",
    }];
    qcMocks.run.data = {
      runId: "run-1",
      items: [{
        id: 1,
        eventType: "weight",
        ingredientId: "flour",
        payload: { checkType: "30-minute" },
        createdAt: new Date(start + 30 * 60_000).toISOString(),
      }],
      signoff: null,
    };
    const options = { runIsActive: true, runStartedAt: start };
    const firstMount = renderTab(options);
    const firstDueTime = screen.getByTestId("qc-weight-reminder-flour").querySelector("time")?.getAttribute("datetime");
    firstMount.unmount();

    renderTab(options);
    expect(screen.getByTestId("qc-weight-reminder-flour").querySelector("time")?.getAttribute("datetime"))
      .toBe(firstDueTime);
  });
});
