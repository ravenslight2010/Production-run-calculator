/**
 * Module-level sauce barrel timer store.
 *
 * Lives outside LiveSauceTabContent so barrel state (anchor, count, alert
 * latches) survives Radix TabsContent unmounts. Radix unmounts inactive tab
 * panels by default; without this store the barrel anchor and notification
 * latches reset to zero every time the operator navigates away and back.
 *
 * Keyed by run ID. Entries are lazily created on first access. Switching runs
 * hydrates the destination entry; entries are only explicitly wiped when a run
 * ends.
 */

export interface SauceBarrelEntry {
  /** Net-elapsed seconds when the current barrel started (0 = run start). */
  lastBarrelNetSec: number;
  /** How many barrels the crew has consumed so far in this run. */
  barrelsMade: number;
  /** Latch key for the nearly-exhausted alert (prevents re-firing same barrel). */
  barrelDueKey: string;
  /** Latch key for the packaging quick check (prevents re-firing same interval). */
  quickCheckKey: string;
  /** Whether the barrel nearly-exhausted banner is currently visible. */
  showBarrelDue: boolean;
  /** Whether the packaging quick check banner is currently visible. */
  showQuickCheck: boolean;
}

const _store = new Map<string, SauceBarrelEntry>();

/** Return the entry for `runId`, creating a zeroed entry if absent. */
export function getSauceBarrelEntry(runId: string): SauceBarrelEntry {
  if (!_store.has(runId)) {
    _store.set(runId, {
      lastBarrelNetSec: 0,
      barrelsMade: 0,
      barrelDueKey: "",
      quickCheckKey: "",
      showBarrelDue: false,
      showQuickCheck: false,
    });
  }
  return _store.get(runId)!;
}

/** Reset (and overwrite) the entry for `runId` to zeroed state. */
export function resetSauceBarrelEntry(runId: string): void {
  _store.set(runId, {
    lastBarrelNetSec: 0,
    barrelsMade: 0,
    barrelDueKey: "",
    quickCheckKey: "",
    showBarrelDue: false,
    showQuickCheck: false,
  });
}

/**
 * Exposed for integration tests ONLY — do not use in production code paths.
 * Lets tests inspect the live store state to verify that React remounts
 * correctly restore the stored values.
 */
export const _storeForTest = _store;
