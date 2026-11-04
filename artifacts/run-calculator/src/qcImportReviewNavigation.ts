type QcImportReviewOpenListener = () => void;

const listeners = new Set<QcImportReviewOpenListener>();
let pendingOpenRequest = false;

export function requestOpenQcImportReview(): void {
  if (listeners.size === 0) {
    pendingOpenRequest = true;
    return;
  }

  for (const listener of [...listeners]) listener();
}

export function subscribeToQcImportReviewOpenRequests(
  listener: QcImportReviewOpenListener,
): () => void {
  listeners.add(listener);
  if (pendingOpenRequest) {
    pendingOpenRequest = false;
    for (const current of [...listeners]) current();
  }

  return () => {
    listeners.delete(listener);
  };
}
