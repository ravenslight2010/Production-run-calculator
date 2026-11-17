// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FormEvent, ReactNode } from "react";
import QcIntelligenceReport from "./QcIntelligenceReport";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  exportCsv: vi.fn(),
  refetch: vi.fn(),
  error: false,
  retrying: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetQcIntelligenceQueryKey: (params: unknown) => ["qc-intelligence", params],
  useGetQcIntelligence: (...args: unknown[]) => mocks.query(...args),
  exportQcIntelligenceCsv: (...args: unknown[]) => mocks.exportCsv(...args),
}));
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Box, LineChart: Box, CartesianGrid: Empty, Legend: Empty,
    Line: Empty, Tooltip: Empty, XAxis: Empty, YAxis: Empty,
  };
});
const base = {
  dateBasis: "event-created-at-utc",
  filters: {
    from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z",
    ingredientId: null, station: null, runId: null, checkType: null,
  },
  coverage: { status: "complete", sampledEvents: 2, includedEvents: 2, maxEvents: 1000, moreAvailable: false, reason: null },
};
const trends = {
  ...base, view: "trends", recordedMeasurements: 1, redactedMeasurementsExcluded: 1,
  groups: [{
    metric: "weight", ingredientId: "ingredient-1", ingredientName: "Synthetic Flour",
    profileKey: "synthetic__cheese", station: "dough", checkType: "pre-run",
    actualUnit: "oz", targetUnit: "oz", targetVersion: "override:1", targetRecordedAt: null,
    points: [{ eventId: 1, recordedAt: "2026-10-02T12:00:00Z", actual: 12, target: 12, tolerance: 0.1, outcome: "pass" }],
  }],
};
const results = {
  ...base, view: "results", recordedChecks: 2,
  byCheckType: [{ key: "weight:pre-run", label: "weight · pre-run", pass: 1, fail: 0, notEvaluated: 1, denominator: 2 }],
  byStation: [], byIngredient: [],
};

beforeEach(() => {
  mocks.error = false;
  mocks.exportCsv.mockReset().mockResolvedValue('"coverage","complete"\r\n');
  mocks.query.mockReset().mockImplementation((params: { view: string }) => ({
    data: params.view === "results" ? results : trends,
    isError: mocks.error, isRefetchError: false,
    isLoading: false, isFetching: mocks.retrying, fetchStatus: mocks.retrying ? "fetching" : "idle",
    failureCount: mocks.retrying ? 1 : 0, refetch: mocks.refetch,
  }));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:qc-fixture"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("QC intelligence report controls", () => {
  it("refreshes inside the calculator form without submitting or nesting forms", () => {
    const submit = vi.fn((event: FormEvent) => event.preventDefault());
    const { container } = render(<form onSubmit={submit}><QcIntelligenceReport canManageQc /></form>);
    expect(container.querySelectorAll("form")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("button-apply-qc-intelligence-filters"));
    expect(fireEvent.keyDown(screen.getByLabelText("Run ID filter"), { key: "Enter" })).toBe(false);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });
  it("shows separated trend context and an accessible table, then recorded denominators", () => {
    render(<QcIntelligenceReport canManageQc />);
    expect((screen.getByRole("combobox", { name: "Trend context" }) as HTMLSelectElement).value).toContain("override:1");
    expect(screen.getByRole("table", { name: "Trend values and outcomes" })).toBeTruthy();
    expect(screen.getByTestId("qc-intelligence-coverage").textContent).toContain("Unrecorded checks are not included as passes");
    fireEvent.click(screen.getByRole("button", { name: "Recorded outcomes" }));
    expect(screen.getByText("Denominator: 2 recorded checks in this report.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "By check type" }).textContent).toContain("Not evaluated");
  });

  it("sends the same effective filters to CSV and reports export failure explicitly", async () => {
    render(<QcIntelligenceReport canManageQc />);
    fireEvent.change(screen.getByLabelText("Station filter"), { target: { value: "sauce" } });
    fireEvent.change(screen.getByLabelText("Ingredient ID filter"), { target: { value: "ingredient-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Export filtered CSV" }));
    await waitFor(() => expect(mocks.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ view: "trends", station: "sauce", ingredientId: "ingredient-1", limit: 1000 }),
      { responseType: "text" },
    ));
    mocks.exportCsv.mockRejectedValueOnce(new Error("not allowed"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Export filtered CSV" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Export filtered CSV" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be downloaded"));
  });

  it("does not display cached manager data after capability loss and does not assume an empty error result", () => {
    const rendered = render(<QcIntelligenceReport canManageQc />);
    rendered.rerender(<QcIntelligenceReport canManageQc={false} />);
    expect(screen.queryByText("Synthetic Flour")).toBeNull();
    expect(screen.getByText("QC manager access is required to view these reports.")).toBeTruthy();
    rendered.unmount();
    mocks.error = true;
    render(<QcIntelligenceReport canManageQc />);
    expect(screen.getByRole("alert").textContent).toContain("No empty or passing result is assumed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("hides stale report values and offers a manual retry during an automatic refresh retry", () => {
    mocks.retrying = true;
    render(<QcIntelligenceReport canManageQc />);
    expect(screen.getByRole("alert").textContent).toContain("No empty or passing result is assumed");
    expect(screen.getByText(/retrying/)).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Trend values and outcomes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry now" })).toBeTruthy();
  });
});
