export const QC_IMPORT_REVIEW_OPEN_REQUEST_EVENT = "run-calculator:open-qc-import-review";

export function requestOpenQcImportReview(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QC_IMPORT_REVIEW_OPEN_REQUEST_EVENT));
  }
}
