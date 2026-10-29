export type WorkbookAuditFailure = Record<string, unknown> & {
  sha256?: string;
  status?: string;
};

export function getWorkbookAuditFailureEntries(
  value: unknown,
): WorkbookAuditFailure[] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as { entries?: unknown }).entries)
  ) {
    throw new Error("Workbook audit failure ledger is missing its entries array.");
  }
  return (value as { entries: WorkbookAuditFailure[] }).entries;
}
