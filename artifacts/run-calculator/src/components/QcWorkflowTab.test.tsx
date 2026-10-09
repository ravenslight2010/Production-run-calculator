// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      }],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  run: {
    data: { items: [], signoff: null },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
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
  useGetQcRun: () => qcMocks.run,
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

afterEach(cleanup);

const stagedIngredients: QcAllergenReviewInput["stagedIngredients"] = [
  { area: "Dough", name: "Flour", quantity: "5", unit: "lbs", staged: true },
  { area: "Sauce", name: "Tomato sauce", quantity: "2", unit: "lbs", staged: false },
];

function renderTab(runIsActive = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QcWorkflowTab
        runId="run-1"
        profileKey="brand::flavor"
        runIsActive={runIsActive}
        values={DEFAULT_VALUES}
        substitutions={[]}
        stagedIngredients={stagedIngredients}
        canRecordQc
        canManageQc={false}
        canViewPhotos={false}
      />
    </QueryClientProvider>,
  );
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
    renderTab(true);
    fireEvent.click(screen.getByRole("tab", { name: "Weights" }));

    expect(screen.getByLabelText("Check timing").textContent).toContain("30-minute active-run check");
  });
});
