// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchImportGoldRetention, recordImportGoldCaseDeletionVerified, type ImportGoldRetentionRecord } from "@/importGold";
import ImportGoldRetentionCard from "./ImportGoldRetentionCard";

vi.mock("@/importGold", () => ({
  fetchImportGoldRetention: vi.fn(),
  deleteImportGoldCase: vi.fn(),
  recordImportGoldCaseDeletionVerified: vi.fn(),
}));

const list = vi.mocked(fetchImportGoldRetention);
const record = (caseId: number, status: ImportGoldRetentionRecord["status"]): ImportGoldRetentionRecord => ({
  caseId, status,
  capturedAt: "2026-10-01T12:00:00.000Z",
  deleteBy: "2026-10-31T12:00:00.000Z",
  verifiedAt: null,
  verifiedBy: null,
});
const page = (records: ImportGoldRetentionRecord[], nextOffset: number | null = null) => ({
  records, nextOffset, hasMore: nextOffset !== null, revision: "a".repeat(64),
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("retention register status filtering", () => {
  it("resets pagination on a filter change, keeps the filter on later pages and returns to all statuses", async () => {
    list.mockResolvedValueOnce(page([record(1, "overdue")], 100))
      .mockResolvedValueOnce(page([record(2, "due_soon")], 100))
      .mockResolvedValueOnce(page([record(3, "due_soon")]))
      .mockResolvedValueOnce(page([record(1, "overdue")], 100));
    render(<ImportGoldRetentionCard standalone />);
    await screen.findByTestId("gold-retention-record-1");
    expect(screen.getByRole("combobox").className).toContain("dark:[color-scheme:dark]");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "due_soon" } });
    await screen.findByTestId("gold-retention-record-2");
    expect(screen.queryByTestId("gold-retention-record-1")).toBeNull();
    expect(list).toHaveBeenLastCalledWith(0, "due_soon");
    fireEvent.click(screen.getByTestId("button-load-more-gold-retention"));
    await screen.findByTestId("gold-retention-record-3");
    expect(list).toHaveBeenLastCalledWith(100, "due_soon", "a".repeat(64));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
    await screen.findByTestId("gold-retention-record-1");
    expect(screen.queryByTestId("gold-retention-record-2")).toBeNull();
    expect(list).toHaveBeenLastCalledWith(0, undefined);
  });

  it("does not replace the selected filter's results with an older request", async () => {
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(page([record(2, "due_soon")]));
    render(<ImportGoldRetentionCard standalone />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "due_soon" } });
    await screen.findByTestId("gold-retention-record-2");
    await act(async () => { resolveOld(page([record(1, "overdue")])); });
    expect(screen.queryByTestId("gold-retention-record-1")).toBeNull();
    expect(screen.getByTestId("gold-retention-record-2")).toBeTruthy();
  });

  it("keeps the chosen status after verification removes a record from that queue", async () => {
    list.mockResolvedValueOnce(page([record(1, "overdue")]))
      .mockResolvedValueOnce(page([record(2, "verification_needed")]))
      .mockResolvedValueOnce(page([]));
    vi.mocked(recordImportGoldCaseDeletionVerified).mockResolvedValue(undefined);
    render(<ImportGoldRetentionCard standalone />);
    await screen.findByTestId("gold-retention-record-1");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "verification_needed" } });
    await screen.findByTestId("gold-retention-record-2");
    fireEvent.click(screen.getByTestId("button-verify-gold-case-2"));
    await screen.findByText("No case deadlines match this status in this scope.");
    expect(list).toHaveBeenLastCalledWith(0, "verification_needed");
    expect(vi.mocked(recordImportGoldCaseDeletionVerified)).toHaveBeenCalledWith(2);
  });

  it("does not show old records as filtered results when the filtered request fails", async () => {
    list.mockResolvedValueOnce(page([record(1, "overdue")]))
      .mockRejectedValueOnce(new Error("Could not load deletion deadlines."));
    render(<ImportGoldRetentionCard standalone />);
    await screen.findByTestId("gold-retention-record-1");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "due_soon" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not load"));
    expect(screen.queryByTestId("gold-retention-record-1")).toBeNull();
  });
});
