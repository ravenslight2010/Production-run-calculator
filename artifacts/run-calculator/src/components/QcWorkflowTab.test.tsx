// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QcAllergenReviewInput, QcEvent } from "@workspace/api-client-react";
import type { Ingredient } from "@workspace/ingredient-catalog";
import type { IngredientSubstitution } from "@workspace/inventory-math";
import { DEFAULT_VALUES, type FormValues } from "../types";
import QcWorkflowTab from "./QcWorkflowTab";
import QcLabelVerification from "./QcLabelVerification";

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
      brixTargets: [] as Array<{
        ingredientId: string;
        ingredientName: string;
        targetBrix: number | null;
        toleranceBrix: number | null;
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
      componentChecklist: {
        status: "complete",
        issues: [] as Array<{ setting: string; message: string }>,
        expectedComponents: [] as Array<{ componentId: string; group: string; name: string; ingredientId?: string }>,
        source: {
          kind: "current-day-canonical-settings",
          date: "2030-03-10",
          revision: "1",
        } as { kind: "current-day-canonical-settings" | "completed-run-snapshot"; date: string; revision: string } | null,
      },
      signoff: null,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  ingredients: [] as Ingredient[],
  runs: {} as Record<string, unknown>,
  history: {
    data: { items: [], hasMore: false },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  activity: {
    data: {
      date: "2026-10-16",
      sources: {
        endedRuns: { status: "available", reason: null, count: 0 },
        activeRuns: { status: "available", reason: null, count: 1 },
        qcEvents: { status: "available", reason: null, count: 0 },
      },
      runs: [{
        runId: "run-1",
        label: "A Plain",
        source: "active-day-state",
        manualAllergen: { status: "recorded", value: "none" },
        derivedReviewState: "no-review",
        allergenReviews: [],
        cleaningEvents: [],
      }],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
    labelReferences: {
      data: { items: [] as Array<Record<string, any>> },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
  mutation: {
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    error: null,
    isPending: false,
  },
  brixMutation: {
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    error: null,
    isPending: false,
  },
  brixTargetMutation: {
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    error: null,
    isPending: false,
  },
    labelCheckOptions: undefined as undefined | {
      mutation: { onSuccess: (response: { event: QcEvent }) => Promise<void> };
    },
    labelCheckMutation: {
      mutate: vi.fn(),
      error: null,
      isPending: false,
    },
    labelReferenceMutation: {
      mutate: vi.fn(),
      error: null,
      isPending: false,
    },
    labelReviewMutation: {
      mutate: vi.fn(),
      error: null,
      isPending: false,
    },
}));

vi.mock("@workspace/api-client-react", () => ({
  exportQcHistoryCsv: vi.fn(),
  getGetQcHistoryQueryKey: (...args: unknown[]) => ["qc-history", ...args],
  getGetQcLabelReferencesQueryKey: (...args: unknown[]) => ["qc-label-references", ...args],
  getGetQcAllergenActivityQueryKey: (...args: unknown[]) => ["qc-allergen-activity", ...args],
  getGetQcRunQueryKey: (...args: unknown[]) => ["qc-run", ...args],
  getGetQcTargetsQueryKey: (...args: unknown[]) => ["qc-targets", ...args],
  useCorrectQcEvent: () => qcMocks.mutation,
  useGetQcHistory: () => qcMocks.history,
  useGetQcLabelReferences: () => qcMocks.labelReferences,
  useGetQcAllergenActivity: () => qcMocks.activity,
  useGetQcRun: (runId: string) => (qcMocks.runs[runId] as typeof qcMocks.run | undefined) ?? qcMocks.run,
  useGetQcTargets: () => qcMocks.targets,
  useRecordQcAllergenReview: () => qcMocks.mutation,
  useRecordQcComponentCheck: () => qcMocks.mutation,
  useRecordQcCleaning: () => qcMocks.mutation,
  useRecordQcBrixCheck: () => qcMocks.brixMutation,
  useRecordQcLabelCheck: (options: typeof qcMocks.labelCheckOptions) => {
    qcMocks.labelCheckOptions = options;
    return qcMocks.labelCheckMutation;
  },
  useSaveQcLabelReference: () => qcMocks.labelReferenceMutation,
  useReviewQcLabelReference: () => qcMocks.labelReviewMutation,
  useRecordQcLot: () => qcMocks.mutation,
  useRecordQcWeightCheck: () => qcMocks.mutation,
  useRedactQcEvent: () => qcMocks.mutation,
  useSetQcTarget: () => qcMocks.mutation,
  useSetQcBrixTarget: () => qcMocks.brixTargetMutation,
  useSignoffQcRun: () => qcMocks.mutation,
  useVerifyQcCleaning: () => qcMocks.mutation,
}));

vi.mock("../masterData", () => ({
  useMasterDataSlice: () => ({
    data: qcMocks.ingredients,
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
  qcMocks.ingredients = [{
    id: "flour",
    name: "Flour",
    categories: ["dough"],
    mergedInto: null,
    enabled: true,
    allergens: [],
    allergensReviewed: false,
  }];
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
    brixTargets: [{
      ingredientId: "flour",
      ingredientName: "Flour",
      targetBrix: null,
      toleranceBrix: null,
      source: "not-configured",
      state: "not-evaluated",
      reason: "No manager-reviewed Brix target is configured.",
    }],
  };
  qcMocks.run.data = {
    runId: "run-1",
    items: [],
    hasMore: false,
    weightCheckEvents: [],
    weightCheckEventsComplete: true,
    componentChecklist: {
      status: "complete",
      issues: [],
      expectedComponents: [],
      source: {
        kind: "current-day-canonical-settings",
        date: "2030-03-10",
        revision: "1",
      },
    },
    signoff: null,
  };
  qcMocks.runs = {};
  qcMocks.mutation.mutate.mockClear();
  qcMocks.mutation.error = null;
  qcMocks.mutation.isPending = false;
  qcMocks.brixMutation.mutate.mockClear();
  qcMocks.brixMutation.error = null;
  qcMocks.brixMutation.isPending = false;
  qcMocks.brixTargetMutation.mutate.mockClear();
  qcMocks.brixTargetMutation.error = null;
  qcMocks.brixTargetMutation.isPending = false;
  qcMocks.labelCheckMutation.mutate.mockClear();
  qcMocks.labelCheckMutation.error = null;
  qcMocks.labelCheckMutation.isPending = false;
  qcMocks.labelReferenceMutation.mutate.mockClear();
  qcMocks.labelReferenceMutation.error = null;
  qcMocks.labelReferenceMutation.isPending = false;
  qcMocks.labelReviewMutation.mutate.mockClear();
  qcMocks.labelReviewMutation.error = null;
  qcMocks.labelReviewMutation.isPending = false;
});

const stagedIngredients: QcAllergenReviewInput["stagedIngredients"] = [
  { area: "Dough", name: "Flour", quantity: "5", unit: "lbs", staged: true },
  { area: "Sauce", name: "Tomato sauce", quantity: "2", unit: "lbs", staged: false },
];

it("keeps a late label-save acknowledgement attached to its originating run", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  const view = (runId: string) => (
    <QueryClientProvider client={client}>
      <QcLabelVerification runId={runId} profileKey="brand__flavor" canRecordQc canManageQc={false} />
    </QueryClientProvider>
  );
  const { rerender } = render(view("origin-run"));
  expect(screen.getByLabelText("Packaging context").className).toContain("appearance-none");
  const acknowledgeOrigin = qcMocks.labelCheckOptions!.mutation.onSuccess;
  rerender(view("next-run"));
  fireEvent.change(screen.getByLabelText("Observed product name"), { target: { value: "Next run text" } });
  await act(async () => acknowledgeOrigin({ event: { runId: "origin-run" } as QcEvent }));
  expect((screen.getByLabelText("Observed product name") as HTMLInputElement).value).toBe("Next run text");
  expect(screen.queryByText(/Label observation saved\./)).toBeNull();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["qc-run", "origin-run"] });
});

it("offers only approved references bound to the current product and packaging context", () => {
  qcMocks.labelReferences.data.items = [
    { referenceId: "matching", state: "approved", context: "shipper-case", productKey: "brand__flavor", version: 1 },
    { referenceId: "other-product", state: "approved", context: "shipper-case", productKey: "other__product", version: 1 },
    { referenceId: "other-context", state: "approved", context: "carton-label", productKey: "brand__flavor", version: 1 },
    { referenceId: "missing-brand", state: "approved", context: "shipper-case", productKey: "__flavor", version: 1 },
    { referenceId: "ambiguous-key", state: "approved", context: "shipper-case", productKey: "brand__ambiguous__flavor", version: 1 },
  ];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (profileKey: string) => (
    <QueryClientProvider client={client}>
      <QcLabelVerification runId="test-run" profileKey={profileKey} canRecordQc canManageQc={false} />
    </QueryClientProvider>
  );
  const { rerender } = render(view("brand__flavor"));
  const values = () => Array.from((screen.getByLabelText("Approved reference") as HTMLSelectElement).options).map((option) => option.value);
  expect(values()).toEqual(["", "matching"]);
  rerender(view("__flavor"));
  expect(values()).toEqual([""]);
  rerender(view("brand__ambiguous__flavor"));
  expect(values()).toEqual([""]);
});

type RenderOptions = {
  runId?: string;
  values?: FormValues;
  substitutions?: IngredientSubstitution[];
  runStartedAt?: number | null;
  runStoppages?: Array<{ type?: string; startedAt: number; endedAt?: number }>;
  runIsActive?: boolean;
  canManageQc?: boolean;
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
        values={currentOptions.values ?? DEFAULT_VALUES}
        substitutions={currentOptions.substitutions ?? []}
        stagedIngredients={stagedIngredients}
        canRecordQc
        canManageQc={currentOptions.canManageQc ?? false}
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
  it("lets QC staff save observed label text without an approved reference or client-supplied expected values", () => {
    renderTab();
    expect(screen.getByText("Observation-only mode").textContent).toBe("Observation-only mode");
    fireEvent.change(screen.getByLabelText("Observed product name"), {
      target: { value: "Observed synthetic cheese" },
    });
    fireEvent.change(screen.getByLabelText("Observed lot text"), {
      target: { value: "LOT-TEST" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save observation" }));

    expect(qcMocks.labelCheckMutation.mutate).toHaveBeenCalledTimes(1);
    const request = qcMocks.labelCheckMutation.mutate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(request.data).toMatchObject({
      runId: "run-1",
      context: "shipper-case",
      observed: {
        productName: "Observed synthetic cheese",
        lotText: "LOT-TEST",
        dateText: "",
      },
    });
    expect(request.data).not.toHaveProperty("expected");
    expect(request.data).not.toHaveProperty("outcome");
    expect(screen.queryByTestId("qc-label-reference-manager")).toBeNull();
  });

  it("shows the selected run's mapped, unknown, and substituted footprint without stale run details", () => {
    qcMocks.ingredients = [
      {
        id: "flour",
        name: "Flour",
        categories: ["dough"],
        mergedInto: null,
        enabled: true,
        allergens: ["wheat"],
        allergensReviewed: true,
      },
      {
        id: "substitute",
        name: "Sample Substitute",
        categories: ["dough"],
        mergedInto: null,
        enabled: true,
        allergens: ["soy"],
        allergensReviewed: true,
      },
    ];
    const values: FormValues = {
      ...DEFAULT_VALUES,
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", ingredientId: "flour", lbs: 20 }],
      pep1Type: "Unmapped Pep Type",
    };
    const substitutions: IngredientSubstitution[] = [{
      id: "sub-flour",
      ingredient: "Flour",
      action: "swap",
      substitute: "Sample Substitute",
    }];
    const { rerenderTab } = renderTab({ runId: "run-1", values, substitutions });
    const panel = screen.getByTestId("qc-run-allergen-footprint");

    expect(screen.getByTestId("qc-allergen-run-id").textContent).toBe("Run run-1");
    expect(screen.getByTestId("run-allergen-soy").textContent).toContain("Sample Substitute");
    expect(screen.queryByTestId("run-allergen-wheat")).toBeNull();
    expect(
      screen.getAllByTestId("run-allergen-unknown-ingredient")
        .map((row) => row.textContent)
        .join(" "),
    ).toContain("Unmapped Pep Type — not found in the ingredient catalog");

    rerenderTab({ runId: "run-2", values, substitutions: [] });

    expect(screen.getByTestId("qc-allergen-run-id").textContent).toBe("Run run-2");
    expect(panel.textContent).not.toContain("Run run-1");
    expect(screen.getByTestId("run-allergen-wheat").textContent).toContain("Flour");
    expect(screen.queryByTestId("run-allergen-soy")).toBeNull();
  });

  it("submits observations only for server-resolved expected components", () => {
    qcMocks.run.data.componentChecklist = {
      status: "complete",
      issues: [],
      expectedComponents: [
        { componentId: "dough:0", group: "Dough", name: "Flour", ingredientId: "flour" },
      ],
      source: {
        kind: "current-day-canonical-settings",
        date: "2030-03-10",
        revision: "2",
      },
    };
    renderTab();

    expect(screen.getByText("Expected values: canonical run settings · 2030-03-10")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Observation for Flour (Dough)"), {
      target: { value: "present-correct" },
    });
    fireEvent.change(screen.getByLabelText("Checklist note (optional)"), {
      target: { value: "Verified at setup" },
    });
    fireEvent.click(screen.getByTestId("button-record-component-check"));

    expect(qcMocks.mutation.mutate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: "run-1",
        observations: [{ componentId: "dough:0", observation: "present-correct" }],
        note: "Verified at setup",
      }),
    });
    expect(screen.getByText(/does not clear a production or shipping hold/i)).toBeTruthy();
  });

  it("keeps incomplete expected lists visibly not fully evaluated", () => {
    qcMocks.run.data.componentChecklist = {
      status: "incomplete",
      reason: "The configured dough recipe has no component rows.",
      issues: [
        {
          setting: "Dough recipe",
          message: "Add at least one named component to the saved dough recipe.",
        },
        {
          setting: "Frontline (Sauce) recipe",
          message: "Add a name to every configured Frontline (Sauce) recipe component.",
        },
        {
          setting: "Applicator 1",
          message: "Select a saved recipe or add named component rows for Applicator 1.",
        },
        {
          setting: "Pepperoni 1",
          message: "Review the saved pepperoni 1; required values are missing or invalid.",
        },
        {
          setting: "Production-day substitutions",
          message: "Ask a manager to correct the saved substitution list before evaluating expected components.",
        },
        {
          setting: "Saved component settings",
          message: "Confirm that at least one component is configured in the saved run settings.",
        },
        {
          setting: "Canonical run settings",
          message: "The current run snapshot is incomplete or ambiguous.",
        },
      ],
      expectedComponents: [],
      source: null,
    };
    renderTab();

    expect(screen.getByText("Not fully evaluated")).toBeTruthy();
    expect(screen.getByText("Saved settings to review")).toBeTruthy();
    const issueItems = screen.getAllByTestId(/^qc-component-setting-issue-/);
    const issueText = issueItems.map((item) => item.textContent).join(" ");
    expect(issueText).toContain("Dough recipe:");
    expect(issueText).toContain("Frontline (Sauce) recipe:");
    expect(issueText).toContain("Applicator 1:");
    expect(issueText).toContain("Pepperoni 1:");
    expect(issueText).toContain("Production-day substitutions:");
    expect(issueText).toContain("Saved component settings:");
    expect(issueText).toContain("Canonical run settings:");
    expect(screen.getByText(/cannot replace the server-resolved expected list/i)).toBeTruthy();
    expect(screen.queryByLabelText(/expected component/i)).toBeNull();
    fireEvent.click(screen.getByTestId("button-record-component-check"));
    expect(qcMocks.mutation.mutate).toHaveBeenCalledWith({
      data: expect.objectContaining({ runId: "run-1", observations: [] }),
    });
  });

  it("shows a read-only daily report with separate manual and derived states", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("button-toggle-allergen-activity"));

    expect(screen.getByRole("heading", { name: "Daily allergen activity" })).toBeTruthy();
    expect(screen.getByTestId("text-manual-allergen-run-1").textContent).toContain("none · recorded");
    expect(screen.getByTestId("text-derived-review-run-1").textContent).toBe("No review recorded");
    expect(screen.getByText(/does not establish cleaning between runs/)).toBeTruthy();
    expect(screen.queryByText("No derived-footprint review event was recorded for this run."))
      .toBeTruthy();
  });

  it("shows audit reasons and recorded actors only to QC managers without revealing redacted notes", () => {
    qcMocks.activity.data = {
      date: "2026-10-16",
      sources: {
        endedRuns: { status: "available", reason: null, count: 1 },
        activeRuns: { status: "not-applicable", reason: null, count: null },
        qcEvents: { status: "available", reason: null, count: 3 },
      },
      runs: [{
        runId: "run-1",
        label: "A Plain",
        source: "completed-snapshot",
        manualAllergen: { status: "recorded", value: "none" },
        derivedReviewState: "reviewed",
        allergenReviews: [{
          eventId: 77,
          recordedAt: "2026-10-16T18:00:00.000Z",
          state: "reviewed",
          allergens: ["milk"],
          unknownIngredients: [],
          missingComponents: [],
          note: "[redacted]",
          corrected: true,
          redactedFields: ["payload.note"],
          auditDetails: [
            {
              action: "correction",
              actorId: "qc-manager-id",
              reason: "Correct the allergen review",
              recordedAt: "2026-10-16T18:10:00.000Z",
            },
            {
              action: "redaction",
              actorId: "privacy-manager-id",
              reason: "Remove private note",
              recordedAt: "2026-10-16T18:15:00.000Z",
            },
          ],
        }],
        cleaningEvents: [{
          eventId: 90,
          recordedAt: "2026-10-16T18:20:00.000Z",
          method: "deep",
          startedAt: "2026-10-16T18:00:00.000Z",
          endedAt: "2026-10-16T18:10:00.000Z",
          note: "[redacted]",
          verification: {
            status: "recorded",
            recordedAt: "2026-10-16T18:30:00.000Z",
            note: null,
            auditDetails: [{
              action: "redaction",
              actorId: "verification-manager-id",
              reason: "Remove verification note",
              recordedAt: "2026-10-16T18:35:00.000Z",
            }],
          },
          corrected: true,
          redactedFields: ["payload.note"],
          auditDetails: [{
            action: "correction",
            actorId: "qc-manager-id",
            reason: "Correct the cleaning method",
            recordedAt: "2026-10-16T18:25:00.000Z",
          }],
        }],
      }],
    } as typeof qcMocks.activity.data;

    renderTab({ canManageQc: true });
    fireEvent.click(screen.getByTestId("button-toggle-allergen-activity"));
    expect(screen.getByText("Correct the allergen review")).toBeTruthy();
    expect(screen.getByText("Correct the cleaning method")).toBeTruthy();
    expect(screen.getByText("Remove verification note")).toBeTruthy();
    expect(document.body.textContent?.match(/qc-manager-id/g)).toHaveLength(2);
    expect(document.body.textContent).toContain("verification-manager-id");
    expect(document.body.textContent).toContain("[redacted]");
    expect(screen.queryByText("Original private note")).toBeNull();

    cleanup();
    renderTab();
    fireEvent.click(screen.getByTestId("button-toggle-allergen-activity"));
    expect(screen.queryByText("Correct the allergen review")).toBeNull();
    expect(screen.queryByText("Correct the cleaning method")).toBeNull();
    expect(screen.queryByText("Remove verification note")).toBeNull();
  });

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
      componentChecklist: {
        status: "incomplete",
        issues: [{ setting: "Canonical run settings", message: "The current run snapshot is incomplete or ambiguous." }],
        expectedComponents: [],
        source: null,
      },
      signoff: null,
    };
    renderTab({ runIsActive: true, runStartedAt: now - 2 * 60 * 60_000 });

    expect(screen.getByText(/more weight records than can be summarized/).textContent)
      .toContain("more weight records than can be summarized");
    expect(screen.queryByTestId("qc-weight-reminder-flour")).toBeNull();
  });

  it("uses a saved check to set the next reminder and recalculates when switching runs", () => {
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
    qcMocks.runs["run-1"] = {
      ...qcMocks.run,
      data: {
        runId: "run-1",
        items: [],
        hasMore: true,
        weightCheckEvents: [{
          ingredientId: "flour",
          checkType: "30-minute",
          createdAt: new Date(start + 30 * 60_000).toISOString(),
        }],
        weightCheckEventsComplete: true,
        componentChecklist: {
          status: "complete",
          issues: [],
          expectedComponents: [],
          source: null,
        },
      },
    };
    qcMocks.runs["run-2"] = {
      ...qcMocks.run,
      data: {
        runId: "run-2",
        items: [],
        hasMore: false,
        weightCheckEvents: [],
        weightCheckEventsComplete: true,
        componentChecklist: {
          status: "complete",
          issues: [],
          expectedComponents: [],
          source: null,
        },
        signoff: null,
      },
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
      componentChecklist: {
        status: "complete",
        issues: [],
        expectedComponents: [],
        source: null,
      },
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
      componentChecklist: {
        status: "complete",
        issues: [],
        expectedComponents: [],
        source: null,
      },
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

  it("records a zero Brix reading with stable retry identity and no client-supplied result", () => {
    renderTab();
    fireEvent.click(screen.getByRole("tab", { name: "Brix" }));
    fireEvent.change(screen.getByLabelText("Brix ingredient"), { target: { value: "flour" } });
    expect(screen.getByTestId("qc-brix-target-status").textContent).toContain("Not evaluated");

    fireEvent.change(screen.getByLabelText("Actual Brix (°Bx)"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("button-record-brix-check"));

    expect(qcMocks.brixMutation.mutate).toHaveBeenCalledTimes(1);
    const first = qcMocks.brixMutation.mutate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(first.data).toMatchObject({
      runId: "run-1",
      profileKey: "brand::flavor",
      ingredientId: "flour",
      checkType: "pre-run",
      station: "dough",
      actualBrix: 0,
    });
    expect(first.data).not.toHaveProperty("targetBrix");
    expect(first.data).not.toHaveProperty("toleranceBrix");
    expect(first.data).not.toHaveProperty("outcome");

    qcMocks.brixMutation.error = new Error("Temporary network failure");
    fireEvent.change(screen.getByLabelText("Brix note (optional)"), { target: { value: "Retry context" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry or correct the input" }));
    expect(qcMocks.brixMutation.mutate).toHaveBeenCalledTimes(2);
    const retry = qcMocks.brixMutation.mutate.mock.calls[1]?.[0] as { data: Record<string, unknown> };
    expect(retry.data.operationId).toBe(first.data.operationId);
    expect(retry.data.note).toBe("Retry context");
  });

  it("lets a QC manager explicitly configure a zero Brix target and zero tolerance", () => {
    renderTab({ canManageQc: true });
    fireEvent.change(screen.getByLabelText("Brix target ingredient"), { target: { value: "flour" } });
    fireEvent.change(screen.getByLabelText("Target Brix (°Bx)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Brix tolerance (°Bx)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Brix target review reason"), { target: { value: "Reviewed reference" } });
    fireEvent.click(screen.getByTestId("button-save-brix-target"));

    expect(qcMocks.brixTargetMutation.mutate).toHaveBeenCalledTimes(1);
    const request = qcMocks.brixTargetMutation.mutate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(request.data).toMatchObject({
      profileKey: "brand::flavor",
      ingredientId: "flour",
      targetBrix: 0,
      toleranceBrix: 0,
      reason: "Reviewed reference",
    });
    expect(request.data).not.toHaveProperty("unit");
  });
});
