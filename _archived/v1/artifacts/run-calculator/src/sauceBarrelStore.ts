/**
 * Module-level sauce barrel timer store.
 *
 * Lives outside LiveSauceTabContent so canonical barrel progress (anchor and
 * count) survives Radix TabsContent unmounts. Radix unmounts inactive tab
 * panels by default; without this store the progress mirror would reset every
 * time the operator navigates away and back.
 *
 * Keyed by run ID. Entries are lazily created on first access and can be
 * explicitly reset by lifecycle code and tests.
 */

export interface SauceBarrelEntry {
  /** Net-elapsed seconds when the current barrel started (0 = run start). */
  lastBarrelNetSec: number;
  /** How many barrels the crew has consumed so far in this run. */
  barrelsMade: number;
}

const _store = new Map<string, SauceBarrelEntry>();

/** Return the entry for `runId`, creating a zeroed entry if absent. */
export function getSauceBarrelEntry(runId: string): SauceBarrelEntry {
  if (!_store.has(runId)) {
    _store.set(runId, {
      lastBarrelNetSec: 0,
      barrelsMade: 0,
    });
  }
  return _store.get(runId)!;
}

/** Reset (and overwrite) the entry for `runId` to zeroed state. */
export function resetSauceBarrelEntry(runId: string): void {
  _store.set(runId, {
    lastBarrelNetSec: 0,
    barrelsMade: 0,
  });
}

/** Mirror canonical form values into the tab-surviving UI register. */
export function mirrorSauceBarrelProgress(
  runId: string,
  progress: Pick<SauceBarrelEntry, "barrelsMade" | "lastBarrelNetSec">,
): void {
  const entry = getSauceBarrelEntry(runId);
  entry.barrelsMade = Math.max(0, Math.floor(progress.barrelsMade));
  entry.lastBarrelNetSec = Math.max(0, progress.lastBarrelNetSec);
}

/**
 * Exposed for integration tests ONLY — do not use in production code paths.
 * Lets tests inspect the live store state to verify that React remounts
 * correctly restore the stored values.
 */
export const _storeForTest = _store;
