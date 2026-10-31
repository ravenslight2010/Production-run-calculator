import { beforeEach, describe, expect, it, vi } from "vitest";
import { listImportGoldRetention } from "@workspace/api-client-react";
import { fetchImportGoldRetentionReminderCounts } from "./importGold";

vi.mock("@workspace/api-client-react", () => ({
  listImportGoldRetention: vi.fn(),
  recordImportGoldDeletionVerification: vi.fn(),
}));

const listRetention = vi.mocked(listImportGoldRetention);
const revision = "a".repeat(64);
const changedRevision = "b".repeat(64);

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
        revision,
        records: [retentionRecord(1, "overdue"), retentionRecord(2, "deletion_incomplete")],
        hasMore: true,
        nextOffset: 100,
      })
      .mockResolvedValueOnce({
        revision,
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
    expect(listRetention).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100, revision });
  });

  it("stops at the verified-record boundary because later pages cannot contain reminders", async () => {
    listRetention
      .mockResolvedValueOnce({
        revision,
        records: [retentionRecord(1, "due_soon")],
        hasMore: true,
        nextOffset: 100,
      })
      .mockResolvedValueOnce({
        revision,
        records: [
          retentionRecord(2, "verified"),
          retentionRecord(3, "overdue"),
        ],
        hasMore: true,
        nextOffset: 200,
      });

    await expect(fetchImportGoldRetentionReminderCounts()).resolves.toEqual({
      dueSoonCount: 1,
      overdueCount: 0,
    });
    expect(listRetention).toHaveBeenCalledTimes(2);
    expect(listRetention).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100, revision });
  });

  it("returns zero counts for an empty retention register", async () => {
    listRetention.mockResolvedValueOnce({
      revision,
      records: [],
      hasMore: false,
      nextOffset: null,
    });

    await expect(fetchImportGoldRetentionReminderCounts()).resolves.toEqual({
      dueSoonCount: 0,
      overdueCount: 0,
    });
  });

  it("discards partial totals and restarts when an earlier-deadline case arrives", async () => {
    listRetention
      .mockResolvedValueOnce({
        revision,
        records: [retentionRecord(1, "overdue"), retentionRecord(2, "due_soon")],
        hasMore: true, nextOffset: 100,
      })
      .mockRejectedValueOnce(Object.assign(new Error("Register changed"), { status: 409 }))
      .mockResolvedValueOnce({
        revision: changedRevision,
        records: [retentionRecord(3, "overdue"), retentionRecord(1, "overdue")],
        hasMore: true, nextOffset: 100,
      })
      .mockResolvedValueOnce({
        revision: changedRevision,
        records: [retentionRecord(2, "due_soon"), retentionRecord(4, "within_limit")],
        hasMore: false, nextOffset: null,
      });

    await expect(fetchImportGoldRetentionReminderCounts()).resolves.toEqual({
      overdueCount: 2, dueSoonCount: 1,
    });
    expect(listRetention.mock.calls.map(([params]) => params)).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100, revision },
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100, revision: changedRevision },
    ]);
  });

  it("fails rather than reporting partial totals when concurrent changes keep happening", async () => {
    const conflict = Object.assign(new Error("Register changed"), { status: 409 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      listRetention.mockResolvedValueOnce({
        revision, records: [retentionRecord(1, "overdue")], hasMore: true, nextOffset: 100,
      }).mockRejectedValueOnce(conflict);
    }
    await expect(fetchImportGoldRetentionReminderCounts()).rejects.toBe(conflict);
    expect(listRetention).toHaveBeenCalledTimes(6);
  });

  it.each([401, 403, 500])("does not retry HTTP %s or return partial counts", async (status) => {
    const failure = Object.assign(new Error("Request failed"), { status });
    listRetention.mockResolvedValueOnce({
      revision, records: [retentionRecord(1, "overdue")], hasMore: true, nextOffset: 100,
    }).mockRejectedValueOnce(failure);
    await expect(fetchImportGoldRetentionReminderCounts()).rejects.toBe(failure);
    expect(listRetention).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "not-a-revision", changedRevision])("rejects an invalid continuation revision %s", async (invalidRevision) => {
    listRetention.mockResolvedValueOnce({
      revision, records: [retentionRecord(1, "overdue")], hasMore: true, nextOffset: 100,
    }).mockResolvedValueOnce({
      revision: invalidRevision as string,
      records: [], hasMore: false, nextOffset: null,
    });
    await expect(fetchImportGoldRetentionReminderCounts()).rejects.toThrow("Refresh to retry");
  });
});
