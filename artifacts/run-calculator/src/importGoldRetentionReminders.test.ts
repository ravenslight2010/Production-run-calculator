import { beforeEach, describe, expect, it, vi } from "vitest";
import { listImportGoldRetention } from "@workspace/api-client-react";
import { fetchImportGoldRetentionReminderCounts } from "./importGold";

vi.mock("@workspace/api-client-react", () => ({
  listImportGoldRetention: vi.fn(),
  recordImportGoldDeletionVerification: vi.fn(),
}));

const listRetention = vi.mocked(listImportGoldRetention);

function retentionRecord(
  caseId: number,
  status: "within_limit" | "due_soon" | "overdue" | "deletion_incomplete" | "verification_needed" | "verified",
) {
  return {
    caseId,
    capturedAt: "2026-10-01T12:00:00.000Z",
    deleteBy: "2026-10-31T12:00:00.000Z",
    status,
    verifiedAt: null,
    verifiedBy: null,
  };
}

describe("Gold Lab retention reminder counts", () => {
  beforeEach(() => {
    listRetention.mockReset();
  });

  it("paginates to count all reminders and stops after the deadline window", async () => {
    listRetention
      .mockResolvedValueOnce({
        records: [retentionRecord(1, "overdue"), retentionRecord(2, "deletion_incomplete")],
        hasMore: true,
        nextOffset: 100,
      })
      .mockResolvedValueOnce({
        records: [
          retentionRecord(3, "overdue"),
          retentionRecord(4, "due_soon"),
          retentionRecord(5, "within_limit"),
          retentionRecord(6, "due_soon"),
        ],
        hasMore: true,
        nextOffset: 200,
      });

    await expect(fetchImportGoldRetentionReminderCounts()).resolves.toEqual({
      dueSoonCount: 1,
      overdueCount: 2,
    });
    expect(listRetention).toHaveBeenCalledTimes(2);
    expect(listRetention).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(listRetention).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
  });

  it("returns zero counts for an empty retention register", async () => {
    listRetention.mockResolvedValueOnce({
      records: [],
      hasMore: false,
      nextOffset: null,
    });

    await expect(fetchImportGoldRetentionReminderCounts()).resolves.toEqual({
      dueSoonCount: 0,
      overdueCount: 0,
    });
  });
});
