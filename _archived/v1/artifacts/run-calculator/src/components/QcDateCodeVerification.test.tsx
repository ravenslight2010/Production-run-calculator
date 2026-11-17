// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const m = vi.hoisted(() => ({
  refs: { data: { items: [] as unknown[] }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  checkAsync: vi.fn(),
  checkState: { isPending: false, error: null as unknown },
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetQcDateCodeReferencesQueryKey: () => ["date-refs"],
  getGetQcHistoryQueryKey: () => ["history"],
  getGetQcRunQueryKey: (id: string) => ["run", id],
  useGetQcDateCodeReferences: () => m.refs,
  useRecordQcDateCodeCheck: () => ({ mutateAsync: m.checkAsync, reset: vi.fn(), ...m.checkState }),
  useSaveQcDateCodeReference: () => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
  useReviewQcDateCodeReference: () => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
}));

import QcDateCodeVerification from "./QcDateCodeVerification";

function renderIt(runId = "run-1") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <QcDateCodeVerification runId={runId} profileKey="brand__flavor" canRecordQc canManageQc={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.refs.data.items = [];
  m.checkAsync.mockReset();
  m.checkState.error = null;
  m.checkState.isPending = false;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("QcDateCodeVerification", () => {
  it("requires batch context and defaults to observation only", () => {
    renderIt();
    expect((screen.getByTestId("button-save-date-code-check") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("panel-date-code-observation-only")).toBeTruthy();
    expect(screen.queryByText(/pass/i)).toBeNull();
  });

  it("submits literal trimmed text with explicit readability and keeps id stable on retry", async () => {
    m.checkAsync.mockRejectedValueOnce(new Error("offline"));
    renderIt();
    fireEvent.change(screen.getByTestId("input-date-code-batch-context"), { target: { value: " Pallet 3 " } });
    fireEvent.change(screen.getByTestId("input-date-code-observed-productionCode"), { target: { value: " L2417 " } });
    fireEvent.click(screen.getByTestId("button-date-code-readability-bestByCode-missing"));
    await act(async () => { fireEvent.click(screen.getByTestId("button-save-date-code-check")); });
    const first = m.checkAsync.mock.calls[0][0].data;
    expect(first.batchContext).toBe("Pallet 3");
    expect(first.observed.productionCode).toBe("L2417");
    expect(first.readability.bestByCode).toBe("missing");
    expect(first.referenceEventId).toBeUndefined();
    expect(first).not.toHaveProperty("expected");
    expect(first).not.toHaveProperty("outcome");
    expect((screen.getByTestId("input-date-code-observed-productionCode") as HTMLInputElement).value).toBe(" L2417 ");
  });

  it("offers only references matching canonical product, exact run, batch and packaging context", () => {
    const reference = { referenceId: "ref-1", configurationEventId: 1, version: 1,
      runId: "run-1", productKey: "brand__flavor", batchContext: "B1", context: "shipper-case", state: "approved",
      expected: { productionCode: "P1", bestByCode: "", otherCode: "" }, requiredFields: ["productionCode"],
      sourceIdentity: "SYNTH", sourceVersion: "1", sourceDescription: "Synthetic." };
    m.refs.data.items = [
      reference,
      { ...reference, configurationEventId: 2, runId: "other-run" },
      { ...reference, configurationEventId: 3, batchContext: "other-batch" },
      { ...reference, configurationEventId: 4, context: "product-pack" },
      { ...reference, configurationEventId: 5, productKey: "other__product" },
      { ...reference, configurationEventId: 6, state: "draft" },
    ];
    renderIt();
    fireEvent.change(screen.getByTestId("input-date-code-batch-context"), { target: { value: "B1" } });
    const picker = screen.getByTestId("select-date-code-reference") as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.value)).toEqual(["", "1"]);
    fireEvent.change(picker, { target: { value: "1" } });
    expect(screen.getByTestId("panel-date-code-selected-reference")).toBeTruthy();
  });

  it("does not clear a newly selected run after a late acknowledgement from the original run", async () => {
    let acknowledge!: (response: unknown) => void;
    m.checkAsync.mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const view = (runId: string) => <QueryClientProvider client={client}>
      <QcDateCodeVerification runId={runId} profileKey="brand__flavor" canRecordQc canManageQc={false} />
    </QueryClientProvider>;
    const rendered = render(view("origin-run"));
    fireEvent.change(screen.getByTestId("input-date-code-batch-context"), { target: { value: "ORIGIN" } });
    fireEvent.click(screen.getByTestId("button-save-date-code-check"));
    rendered.rerender(view("next-run"));
    fireEvent.change(screen.getByTestId("input-date-code-batch-context"), { target: { value: "NEXT" } });
    await act(async () => acknowledge({ event: { runId: "origin-run", payload: {} } }));
    expect((screen.getByTestId("input-date-code-batch-context") as HTMLInputElement).value).toBe("NEXT");
    expect(screen.queryByTestId("status-date-code-check")).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["run", "origin-run"] });
  });
});
