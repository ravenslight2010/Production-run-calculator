/** Keeps repair failure degradation stable and testable without importing server startup. */
export function classifyStartupRepairFailure(error: unknown): {
  repairId?: string;
  errorCode: string;
} {
  const repairId = error && typeof error === "object" && "repairId" in error &&
    typeof (error as { repairId?: unknown }).repairId === "string"
    ? (error as { repairId: string }).repairId
    : undefined;
  return { repairId, errorCode: repairId ? `data_heals_failed:${repairId}` : "data_heals_failed" };
}