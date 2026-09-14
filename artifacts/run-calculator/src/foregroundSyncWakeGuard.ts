/**
 * Coalesce wake signals that arrive while foreground reconciliation is active.
 * The returned promise stays shared until the reconciliation settles, allowing
 * focus, visibility, and online events to safely arrive in the same wake burst.
 */
export function createForegroundSyncWakeGuard(
  reconcile: () => Promise<boolean>,
): () => Promise<boolean> {
  let inFlight: Promise<boolean> | null = null;
  let queuedWake = false;

  const start = (): Promise<boolean> => {
    const work = (async () => {
      try {
        let firstError: unknown;
        let succeeded = false;
        try {
          succeeded = await reconcile();
        } catch (error) {
          firstError = error;
        }
        if (!succeeded && queuedWake) {
          // Keep the bounded retry inside this wake burst's shared promise. That
          // gives focus/visibility/online one completion owner instead of
          // detaching a second reconciliation that can release the barrier after
          // callers already observed the first attempt settle.
          queuedWake = false;
          return await reconcile();
        }
        if (firstError !== undefined) throw firstError;
        return succeeded;
      } finally {
        // A running reconciliation is never replaced: overlapping wakes only
        // set queuedWake and return this same promise.
        inFlight = null;
        queuedWake = false;
      }
    })();
    inFlight = work;
    return work;
  };

  return () => {
    if (inFlight) {
      queuedWake = true;
      return inFlight;
    }
    return start();
  };
}