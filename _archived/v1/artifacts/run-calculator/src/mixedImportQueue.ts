export const MIXED_IMPORT_TYPES = ["spec", "premix", "cheese", "shipping", "sauce", "dough", "schedule"] as const;
export type MixedImportType = typeof MIXED_IMPORT_TYPES[number];
export type MixedImportStatus = "queued" | "preparing" | "reviewing" | "applying" | "applied" | "partial" | "failed" | "cancelled" | "uncertain";
export type MixedImportItem = {
  id: string;
  file: File;
  type: MixedImportType;
  status: MixedImportStatus;
  detail?: string;
};
export const MIXED_IMPORT_LABELS: Record<MixedImportType, string> = {
  spec: "Spec / recipe workbook", premix: "Premix", cheese: "Cheese",
  shipping: "Shipping guide", sauce: "Sauce guide", dough: "Dough guide", schedule: "Schedule",
};
export const MAX_MIXED_IMPORT_FILES = 20;
export const WORKBOOK_ACCEPT = ".xlsx,.xls,.xlsm,.xlsb,.csv,.ods,.docx,.doc,.txt";
export type WorkbookFileSelection = { target: { files: FileList | readonly File[] | null; value: string } };
export function isSupportedReviewWorkbook(name: string): boolean {
  return /\.(xlsx|xls|xlsm|xlsb|csv|ods)$/i.test(name);
}
export function isSupportedReviewFile(name: string, type: MixedImportType): boolean {
  return type === "sauce" ? /\.(docx|doc|txt)$/i.test(name) : isSupportedReviewWorkbook(name);
}
export function canStartMixedImport(item: MixedImportItem, active: boolean): boolean {
  return !active && ["queued", "cancelled", "failed"].includes(item.status);
}
export function cancelQueuedMixedImports(items: MixedImportItem[]): MixedImportItem[] {
  return items.map((item) => item.status === "queued"
    ? { ...item, status: "cancelled", detail: "Cancelled before preparation. Nothing applied." } : item);
}
