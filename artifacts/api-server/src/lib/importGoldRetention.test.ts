import { describe, expect, it } from "vitest";
import {
  IMPORT_GOLD_RETENTION_MS,
  IMPORT_GOLD_RETENTION_REMINDER_MS,
  importGoldDeleteBy,
  importGoldRetentionStatus,
} from "./importGoldRetention";

describe("Import Gold retention deadlines", () => {
  const capturedAt = new Date("2026-01-01T12:34:56.000Z");

  it("sets the deadline exactly 30 days after capture as an elapsed UTC duration", () => {
    expect(importGoldDeleteBy(capturedAt).toISOString()).toBe("2026-01-31T12:34:56.000Z");
    expect(importGoldDeleteBy(capturedAt).getTime() - capturedAt.getTime()).toBe(IMPORT_GOLD_RETENTION_MS);
  });

  it("rejects invalid capture timestamps instead of creating unusable deadlines", () => {
    expect(() => importGoldDeleteBy(new Date(Number.NaN))).toThrow(RangeError);
  });

  it("marks the exact deadline overdue and uses a seven-day inclusive reminder window", () => {
    const deleteBy = new Date("2026-01-31T12:34:56.000Z");
    expect(importGoldRetentionStatus({
      deleteBy, casePresent: true, scoreHistoryPresent: false, verifiedAt: null,
    }, deleteBy))
      .toBe("overdue");
    expect(importGoldRetentionStatus(
      { deleteBy, casePresent: true, scoreHistoryPresent: false, verifiedAt: null },
      new Date(deleteBy.getTime() - IMPORT_GOLD_RETENTION_REMINDER_MS),
    )).toBe("due_soon");
    expect(importGoldRetentionStatus(
      { deleteBy, casePresent: true, scoreHistoryPresent: false, verifiedAt: null },
      new Date(deleteBy.getTime() - IMPORT_GOLD_RETENTION_REMINDER_MS - 1),
    )).toBe("within_limit");
  });

  it("prioritizes deletion verification state over deadline state", () => {
    const deleteBy = new Date("2026-01-31T12:34:56.000Z");
    expect(importGoldRetentionStatus({
      deleteBy, casePresent: false, scoreHistoryPresent: false, verifiedAt: null,
    }))
      .toBe("verification_needed");
    expect(importGoldRetentionStatus({
      deleteBy, casePresent: false, scoreHistoryPresent: true, verifiedAt: null,
    }))
      .toBe("deletion_incomplete");
    expect(importGoldRetentionStatus({
      deleteBy, casePresent: false, scoreHistoryPresent: false, verifiedAt: capturedAt,
    }))
      .toBe("verified");
  });
});
