const STORAGE_KEY = "run-calc-pending-duplicate-review-count";

export const PENDING_DUPLICATE_REVIEW_SCAN = -1;

export function loadPendingDuplicateReview(storage: Pick<Storage, "getItem">): number {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === "pending") return PENDING_DUPLICATE_REVIEW_SCAN;
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function savePendingDuplicateReview(
  storage: Pick<Storage, "setItem" | "removeItem">,
  count: number,
): void {
  if (count === PENDING_DUPLICATE_REVIEW_SCAN) {
    storage.setItem(STORAGE_KEY, "pending");
  } else if (Number.isFinite(count) && count > 0) {
    storage.setItem(STORAGE_KEY, String(Math.floor(count)));
  } else {
    storage.removeItem(STORAGE_KEY);
  }
}

export function pendingDuplicateReviewAfterScan(
  current: number,
  completedCount: number | null,
): number {
  return completedCount === null ? current : Math.max(0, Math.floor(completedCount));
}

export function pendingDuplicateReviewAfterResolution(remainingGroups: number): number {
  return Math.max(0, Math.floor(remainingGroups));
}