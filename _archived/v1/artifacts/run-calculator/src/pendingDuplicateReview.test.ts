import { describe, expect, it } from "vitest";
import {
  PENDING_DUPLICATE_REVIEW_SCAN,
  loadPendingDuplicateReview,
  pendingDuplicateReviewAfterResolution,
  pendingDuplicateReviewAfterScan,
  savePendingDuplicateReview,
} from "./pendingDuplicateReview";

function memoryStorage(initial?: string) {
  let value: string | null = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
  };
}

describe("pending duplicate review", () => {
  it("survives immediate navigation or reload while the import scan is pending", () => {
    const storage = memoryStorage();
    savePendingDuplicateReview(storage, PENDING_DUPLICATE_REVIEW_SCAN);

    const reloaded = loadPendingDuplicateReview(storage);
    expect(reloaded).toBe(PENDING_DUPLICATE_REVIEW_SCAN);
    expect(pendingDuplicateReviewAfterScan(reloaded, null)).toBe(PENDING_DUPLICATE_REVIEW_SCAN);
  });

  it("clears only after a completed zero-result scan", () => {
    expect(pendingDuplicateReviewAfterScan(2, null)).toBe(2);
    expect(pendingDuplicateReviewAfterScan(2, 0)).toBe(0);
  });

  it("tracks remaining groups and clears after the last resolution", () => {
    const storage = memoryStorage("2");
    const remaining = pendingDuplicateReviewAfterResolution(1);
    savePendingDuplicateReview(storage, remaining);
    expect(loadPendingDuplicateReview(storage)).toBe(1);

    savePendingDuplicateReview(storage, pendingDuplicateReviewAfterResolution(0));
    expect(loadPendingDuplicateReview(storage)).toBe(0);
  });
});