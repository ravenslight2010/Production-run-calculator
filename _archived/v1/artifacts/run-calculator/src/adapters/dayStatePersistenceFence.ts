/**
 * Prevent this document from restoring day state after it adopts a newer
 * reset epoch. Reset handlers reload immediately; this fence stops pending
 * React effects from repopulating the cache before the document unloads.
 */
let dayStateWritesBlockedForReset = false;

export function blockDayStatePersistenceForReset(): void {
  dayStateWritesBlockedForReset = true;
}

export function isDayStatePersistenceBlocked(): boolean {
  return dayStateWritesBlockedForReset;
}
