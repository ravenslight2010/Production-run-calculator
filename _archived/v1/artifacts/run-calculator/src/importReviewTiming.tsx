import { useEffect } from "react";
import { recordMemorySample, recordPerformance } from "./performanceDiagnostics";

type ImportKind = "spec" | "premix" | "cheese";
const pendingReviews = new WeakMap<object, { kind: ImportKind; startedAt: number }>();

/** Start after preparation, before publishing the result to the review UI. */
export function startImportReviewTiming(prepared: object, kind: ImportKind): void {
  if (typeof performance === "undefined") return;
  pendingReviews.set(prepared, { kind, startedAt: performance.now() });
}

/**
 * Mount only in the ready review branch, not its loading/error placeholder.
 * Waiting for the next frame includes deferred loading, React's commit and
 * review-state initialization without delaying or changing the import itself.
 */
export function ImportReviewTiming({ prepared }: { prepared: object }) {
  useEffect(() => {
    const pending = pendingReviews.get(prepared);
    if (!pending) return;
    const frame = requestAnimationFrame(() => {
      // A prepared result is measured once, including under StrictMode or reopen.
      if (pendingReviews.get(prepared) !== pending) return;
      pendingReviews.delete(prepared);
      const name = `import-${pending.kind}-review-open`;
      recordPerformance(name, performance.now() - pending.startedAt, "render");
      recordMemorySample(name);
    });
    return () => cancelAnimationFrame(frame);
  }, [prepared]);
  return null;
}
