/**
 * Pure helpers for the auto-track suppression window (dough-timer pause /
 * resume).  Extracted from RunContext so the logic can be unit-tested without
 * the React-Native import graph.
 *
 * These functions mutate the mutable ref objects in place (matching how React
 * useRef values are updated) and return the new reactive-state value the caller
 * should commit via setState.
 *
 * Mirrors / fixes RunContext.tsx:
 *   suppressAutoTrack  → applySuppress  (lines 3314-3318)
 *   resumeAutoTrack    → applyResume    (lines 3320-3330, + trayLastMsRef /
 *                                        batchLastMsRef zeroing added here)
 */

/** Mutable ref objects owned by RunContext that drive auto-track timing. */
export interface AutoTrackRefs {
  /** Source of truth for the suppression window (ms since epoch, 0 = off). */
  autoSuppressRef: { current: number };
  /** Next-due wall-clock timestamps for each counter (0 = fire immediately). */
  caseNextDueMsRef: { current: number };
  trayNextDueMsRef: { current: number };
  batchNextDueMsRef: { current: number };
  /**
   * Wall-clock ms of each consumption counter's last tick.  Used to compute
   * the actual elapsed duration for incremental tray/batch decrements.
   * Must be zeroed on resume so the first post-resume tick uses ONE full
   * period (not the accumulated pause span) — preventing a tray/batch jump.
   */
  trayLastMsRef: { current: number };
  batchLastMsRef: { current: number };
}

/**
 * Begin a 1-minute suppression window (operator is manually editing a counter).
 * Returns the new `autoSuppressUntil` value to commit via setAutoSuppressUntil.
 */
export function applySuppress(refs: AutoTrackRefs, nowMs: number): number {
  const until = nowMs + 60_000;
  refs.autoSuppressRef.current = until;
  return until;
}

/**
 * Cancel the active suppression window and force every counter's next tick to
 * fire immediately without a catch-up jump.
 *
 * Mirrors the web pauseDoughTimers / resumeDoughTimers contract:
 *  • autoSuppressRef = 0        — disables the suppression gate
 *  • *NextDueMsRef   = 0        — next tick fires on the very next render
 *  • trayLastMsRef   = 0        — first post-resume duration = one full period
 *  • batchLastMsRef  = 0          (not the accumulated pause span)
 *
 * Returns the new `autoSuppressUntil` value (always 0) to commit via
 * setAutoSuppressUntil.
 */
export function applyResume(refs: AutoTrackRefs): 0 {
  refs.autoSuppressRef.current = 0;
  refs.caseNextDueMsRef.current = 0;
  refs.trayNextDueMsRef.current = 0;
  refs.batchNextDueMsRef.current = 0;
  // Zero last-tick refs so the first post-resume tick computes durationMin from
  // a 0 prevMs baseline (one full period) instead of using the stale pre-pause
  // timestamp — which would inflate the elapsed span and consume extra trays/
  // batches on resume (the "jump" bug, web useAutoTrack parity).
  refs.trayLastMsRef.current = 0;
  refs.batchLastMsRef.current = 0;
  return 0;
}
