import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  fetchImportGoldRetention: vi.fn(),
  deleteImportGoldCase: vi.fn(),
  recordImportGoldCaseDeletionVerified: vi.fn(),
}));
vi.mock("@/importGold", () => api);
import ImportGoldRetentionCard from "./ImportGoldRetentionCard";

const revision = "a".repeat(64);
const changedRevision = "b".repeat(64);
const record = (caseId: number) => ({
  caseId, capturedAt: "2026-10-01T12:00:00.000Z", deleteBy: "2026-10-31T12:00:00.000Z",
  status: "overdue", verifiedAt: null, verifiedBy: null,
});
const firstPage = { revision, records: [record(1)], nextOffset: 100, hasMore: true };

afterEach(() => {
  cleanup();
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe("retention register pagination", () => {
  it("sends the first page revision when appending stable rows", async () => {
    api.fetchImportGoldRetention.mockResolvedValueOnce(firstPage).mockResolvedValueOnce({
      revision, records: [record(2)], nextOffset: null, hasMore: false,
    });
    const user = userEvent.setup();
    render(<ImportGoldRetentionCard />);
    await screen.findByTestId("gold-retention-record-1");
    await user.click(screen.getByTestId("button-load-more-gold-retention"));
    await screen.findByTestId("gold-retention-record-2");
    expect(screen.getAllByTestId(/^gold-retention-record-/)).toHaveLength(2);
    expect(api.fetchImportGoldRetention).toHaveBeenNthCalledWith(2, 100, undefined, revision);
  });

  it("discards old pages and reloads the first page after a concurrent insert", async () => {
    api.fetchImportGoldRetention.mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(Object.assign(new Error("Register changed"), { status: 409 }))
      .mockResolvedValueOnce({
        revision: changedRevision, records: [record(3), record(1)], nextOffset: 100, hasMore: true,
      })
      .mockResolvedValueOnce({
        revision: changedRevision, records: [record(2)], nextOffset: null, hasMore: false,
      });
    const user = userEvent.setup();
    render(<ImportGoldRetentionCard />);
    await screen.findByTestId("gold-retention-record-1");
    await user.click(screen.getByTestId("button-load-more-gold-retention"));
    await screen.findByTestId("gold-retention-record-3");
    expect(screen.getAllByTestId(/^gold-retention-record-/)).toHaveLength(2);
    expect(api.fetchImportGoldRetention).toHaveBeenNthCalledWith(2, 100, undefined, revision);
    expect(api.fetchImportGoldRetention).toHaveBeenNthCalledWith(3, 0, undefined);
    await user.click(screen.getByTestId("button-load-more-gold-retention"));
    await screen.findByTestId("gold-retention-record-2");
    await waitFor(() => expect(api.fetchImportGoldRetention).toHaveBeenNthCalledWith(4, 100, undefined, changedRevision));
    expect(api.deleteImportGoldCase).not.toHaveBeenCalled();
    expect(api.recordImportGoldCaseDeletionVerified).not.toHaveBeenCalled();
  });

  it("shows a failed restart instead of retaining a misleading partial list", async () => {
    api.fetchImportGoldRetention.mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(Object.assign(new Error("Register changed"), { status: 409 }))
      .mockRejectedValueOnce(new Error("Could not reload deadlines."));
    const user = userEvent.setup();
    render(<ImportGoldRetentionCard />);
    await screen.findByTestId("gold-retention-record-1");
    await user.click(screen.getByTestId("button-load-more-gold-retention"));
    await screen.findByText("Could not reload deadlines.");
    expect(screen.queryByTestId("gold-retention-record-1")).toBeNull();
    expect(screen.queryByTestId("button-load-more-gold-retention")).toBeNull();
    expect(api.fetchImportGoldRetention).toHaveBeenCalledTimes(3);
  });

  it("retains the selected status when a stale filtered continuation restarts", async () => {
    api.fetchImportGoldRetention.mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(Object.assign(new Error("Register changed"), { status: 409 }))
      .mockResolvedValueOnce({
        revision: changedRevision, records: [record(3)], nextOffset: null, hasMore: false,
      });
    const user = userEvent.setup();
    render(<ImportGoldRetentionCard />);
    await screen.findByTestId("gold-retention-record-1");
    await user.selectOptions(screen.getByRole("combobox"), "overdue");
    await waitFor(() => expect(api.fetchImportGoldRetention).toHaveBeenNthCalledWith(2, 0, "overdue"));
    await user.click(screen.getByTestId("button-load-more-gold-retention"));
    await screen.findByTestId("gold-retention-record-3");
    expect(api.fetchImportGoldRetention).toHaveBeenNthCalledWith(3, 100, "overdue", revision);
    expect(api.fetchImportGoldRetention).toHaveBeenNthCalledWith(4, 0, "overdue");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("overdue");
    expect(screen.queryByTestId("gold-retention-record-1")).toBeNull();
  });
});
