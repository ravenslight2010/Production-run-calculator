export const IMPORT_GOLD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const IMPORT_GOLD_RETENTION_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export type ImportGoldRetentionStatus =
  | "within_limit"
  | "due_soon"
  | "overdue"
  | "deletion_incomplete"
  | "verification_needed"
  | "verified";

export function importGoldDeleteBy(capturedAt: Date): Date {
  const time = capturedAt.getTime();
  if (!Number.isFinite(time)) throw new RangeError("Invalid import-gold capture time");
  return new Date(time + IMPORT_GOLD_RETENTION_MS);
}

export function importGoldRetentionStatus(
  record: {
    deleteBy: Date;
    casePresent: boolean;
    scoreHistoryPresent: boolean;
    verifiedAt: Date | null;
  },
  now = new Date(),
): ImportGoldRetentionStatus {
  if (record.verifiedAt) return "verified";
  if (!record.casePresent && record.scoreHistoryPresent) return "deletion_incomplete";
  if (!record.casePresent) return "verification_needed";

  const remaining = record.deleteBy.getTime() - now.getTime();
  if (remaining <= 0) return "overdue";
  if (remaining <= IMPORT_GOLD_RETENTION_REMINDER_MS) return "due_soon";
  return "within_limit";
}
