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
  let automaticRetryUsed = false;

  const start = (): Promise<boolean> => {
    const work = reconcile();
    inFlight = work;
    void work.then(
      (succeeded) => {
        if (inFlight !== work) return;
        inFlight = null;
        if (!succeeded && queuedWake && !automaticRetryUsed) {
          // A browser can deliver `online` or `focus` while the failed pull is
          // still unwinding. Coalescing that signal into the failed promise
          // leaves the client fenced with no request to recover it. Consume at
          // most one overlapping signal as an automatic retry; later signals
          // are allowed to start a fresh, explicit recovery pass.
          queuedWake = false;
          automaticRetryUsed = true;
          void start();
          return;
        }
        queuedWake = false;
        if (succeeded) automaticRetryUsed = false;
      },
      () => {
        if (inFlight !== work) return;
        inFlight = null;
        if (queuedWake && !automaticRetryUsed) {
          queuedWake = false;
          automaticRetryUsed = true;
          void start();
          return;
        }
        queuedWake = false;
      },
    );
    return work;
  };

  return () => {
    if (inFlight) {
      queuedWake = true;
      return inFlight;
    }
    automaticRetryUsed = false;
    return start();
  };
}