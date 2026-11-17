import type { ImportEntityChange } from "@workspace/spec-import/import-changes";

export type ImportSafetyReview = {
  title: string;
  recovery: string;
  changes: ImportEntityChange[];
  baseline: {
    status: string;
    label: string;
    changes: ImportEntityChange[];
  };
};
type Listener = (review: ImportSafetyReview | null) => void;
export class ImportReviewCancelledError extends Error {
  constructor() {
    super("Import review cancelled. No changes were saved.");
    this.name = "ImportReviewCancelledError";
  }
}
let listener: Listener | null = null;
let resolveReview: ((approved: boolean) => void) | null = null;
let identityEpoch = 0;
export const importReviewIdentityEpoch = (): number => identityEpoch;
export function resetImportReviewIdentity(): void {
  identityEpoch += 1;
  finishImportSafetyReview(false);
}

export function subscribeImportSafetyReview(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) {
      listener = null;
      finishImportSafetyReview(false);
    }
  };
}
export function finishImportSafetyReview(approved: boolean): void {
  const resolve = resolveReview;
  resolveReview = null;
  listener?.(null);
  resolve?.(approved);
}
/** No DOM fallback may silently approve. Test/server callers do not own UI. */
export function requestImportSafetyReview(review: ImportSafetyReview, expectedEpoch = identityEpoch): Promise<boolean> {
  if (expectedEpoch !== identityEpoch) return Promise.reject(new Error("Your sign-in changed during import review. Reopen the import in the current account."));
  if (typeof window === "undefined") return Promise.resolve(true);
  if (!listener || resolveReview) return Promise.reject(new Error("Import review is unavailable. Close the import and try again."));
  return new Promise((resolve) => {
    resolveReview = resolve;
    listener!(review);
  });
}
