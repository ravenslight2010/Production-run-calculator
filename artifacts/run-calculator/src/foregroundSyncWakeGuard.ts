/**
 * Coalesce wake signals that arrive while foreground reconciliation is active.
 * The returned promise stays shared until the reconciliation settles, allowing
 * focus, visibility, and online events to safely arrive in the same wake burst.
 */
export function createForegroundSyncWakeGuard(
  reconcile: () => Promise<boolean>,
): () => Promise<boolean> {
  let inFlight: Promise<boolean> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const work = reconcile();
    inFlight = work;
    const clearInFlight = () => {
      if (inFlight === work) inFlight = null;
    };
    void work.then(clearInFlight, clearInFlight);
    return work;
  };
}