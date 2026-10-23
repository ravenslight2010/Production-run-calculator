import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mutate = vi.fn();
const refetch = vi.fn(() => Promise.resolve({ isError: false }));
let detail: Record<string, unknown>;
let badges: { pending: number; rejected: number } | undefined;

vi.mock("@workspace/api-client-react", () => ({
  getGetQcImportReviewBadgesQueryKey: () => ["badges"],
  getGetQcImportReviewQueryKey: (id: string) => ["detail", id],
  getListQcImportReviewsQueryKey: (p?: unknown) => ["list", p],
  useDecideQcImportReview: () => ({ mutate, isPending: false }),
  useGetQcImportReview: () => ({ data: detail, isLoading: false, isError: false, refetch }),
  useGetQcImportReviewBadges: () => ({ data: badges }),
  useListQcImportReviews: (_p: unknown, o: { query: { enabled: boolean } }) => ({
    data: o.query.enabled ? { items: [detail], nextCursor: null } : undefined, isLoading: false, isError: false, refetch,
  }),
}));

import QcImportReview, { QcImportReviewBadge } from "./QcImportReview";

const hash = "a".repeat(64);
function base() {
  return {
    operationId: "op-1", resultHash: hash, importType: "workbook", createdAt: "2025-01-01T00:00:00Z",
    applyStatus: "applied", qcStatus: "pending", revision: 3, evidenceAvailable: true,
    summary: { entities: [{ entity: "recipes", before: 2, after: 3, created: 1, updated: 0, deleted: 0 }], changes: [], omittedChanges: 4 },
    summaryLimitation: "Only 30 changes retained.", decisions: [], undo: { available: false, guidance: "Use guarded Undo from Imports." },
  };
}
function renderOpen() {
  render(<QueryClientProvider client={new QueryClient()}><QcImportReview canManageQc /></QueryClientProvider>);
  fireEvent.click(screen.getByTestId("button-qc-import-item-op-1"));
}
beforeEach(() => { detail = base(); badges = undefined; mutate.mockReset(); });
afterEach(cleanup);

it("requires rationale and sends frozen decision payload", () => {
  renderOpen();
  expect(screen.getByTestId("text-qc-import-omitted").textContent).toContain("4");
  expect((screen.getByTestId("button-qc-import-verify") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByTestId("textarea-qc-import-reason"), { target: { value: "Looks right" } });
  fireEvent.click(screen.getByTestId("button-qc-import-verify"));
  const [vars] = mutate.mock.calls[0];
  expect(vars.operationId).toBe("op-1");
  expect(vars.data).toMatchObject({ expectedResultHash: hash, expectedRevision: 3, status: "verified", reason: "Looks right" });
});

it("retries network failure with the exact same decisionId and payload", () => {
  renderOpen();
  fireEvent.change(screen.getByTestId("textarea-qc-import-reason"), { target: { value: "bad rows" } });
  mutate.mockImplementationOnce((_v, o) => o.onError(new TypeError("Failed to fetch")));
  fireEvent.click(screen.getByTestId("button-qc-import-reject"));
  expect(screen.getByTestId("alert-qc-import-network")).toBeTruthy();
  expect((screen.getByTestId("button-qc-import-reject") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("button-qc-import-retry"));
  expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
});

it("does not acknowledge an invalid receipt and keeps the exact retry", () => {
  renderOpen();
  fireEvent.change(screen.getByTestId("textarea-qc-import-reason"), { target: { value: "Synthetic review" } });
  mutate.mockImplementationOnce((_v, o) => o.onSuccess({ operationId: "wrong-operation", resultHash: hash, qcStatus: "verified", revision: 4, replayed: false }));
  fireEvent.click(screen.getByTestId("button-qc-import-verify"));
  expect(screen.queryByTestId("status-qc-import-receipt")).toBeNull();
  expect(screen.getByTestId("alert-qc-import-network")).toBeTruthy();
  fireEvent.click(screen.getByTestId("button-qc-import-retry"));
  expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
});

it("permits an audited superseding decision on a rejected active Apply, never an applying result", () => {
  detail.qcStatus = "rejected";
  renderOpen();
  expect(screen.getByTestId("textarea-qc-import-reason")).toBeTruthy();
  cleanup();
  detail.applyStatus = "applying";
  renderOpen();
  expect(screen.queryByTestId("form-qc-import-decision")).toBeNull();
});

it("conflict asks to refresh without auto-retry; success shows receipt", () => {
  renderOpen();
  fireEvent.change(screen.getByTestId("textarea-qc-import-reason"), { target: { value: "x" } });
  mutate.mockImplementationOnce((_v, o) => o.onError(Object.assign(new Error("conflict"), { status: 409 })));
  fireEvent.click(screen.getByTestId("button-qc-import-verify"));
  expect(screen.getByTestId("alert-qc-import-conflict")).toBeTruthy();
  expect(screen.queryByTestId("button-qc-import-retry")).toBeNull();
  expect(mutate).toHaveBeenCalledTimes(1);
  mutate.mockImplementationOnce((_v, o) => o.onSuccess({ operationId: "op-1", resultHash: hash, qcStatus: "verified", revision: 4, replayed: false }));
  fireEvent.click(screen.getByTestId("button-qc-import-verify"));
  expect(screen.getByTestId("status-qc-import-receipt").textContent).toContain("verified");
});

it("legacy and failed imports are not actionable", () => {
  detail = { ...base(), evidenceAvailable: false, resultHash: null, summary: null };
  renderOpen();
  expect(screen.getByTestId("text-qc-import-legacy")).toBeTruthy();
  expect(screen.getByTestId("text-qc-import-not-actionable")).toBeTruthy();
  cleanup();
  detail = { ...base(), applyStatus: "undone" };
  renderOpen();
  expect(screen.queryByTestId("form-qc-import-decision")).toBeNull();
});

it("hides review for non-managers and badge shows counts only", () => {
  render(<QcImportReview canManageQc={false} />);
  expect(screen.queryByTestId("section-qc-import-review")).toBeNull();
  badges = { pending: 2, rejected: 1 };
  render(<QcImportReviewBadge />);
  const badge = screen.getByTestId("badge-qc-import-review");
  expect(badge.textContent).toContain("2 pending");
  expect(badge.querySelector("a,button")).toBeNull();
});
