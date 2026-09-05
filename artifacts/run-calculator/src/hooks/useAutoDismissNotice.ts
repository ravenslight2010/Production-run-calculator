import { useCallback, useEffect, useRef, type FocusEvent, type MouseEvent } from "react";

export const ADVISORY_AUTO_DISMISS_MS = {
  nonUrgent: 10_000,
  urgent: 30_000,
} as const;

export type AutoDismissNoticeArgs = {
  /** Stable identity for the currently visible notice. A null identity disables the timer. */
  identity: string | null;
  durationMs: number;
  onDismiss: () => void;
};

export type AutoDismissNoticeHandlers = {
  onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave: (event: MouseEvent<HTMLElement>) => void;
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
};

/**
 * Runs one countdown for one visible notice.
 *
 * The countdown stores remaining time rather than restarting from the full
 * duration when an operator moves the pointer or keyboard focus away. A notice
 * identity change always starts a fresh countdown, and effect cleanup cancels
 * any pending callback from the previous notice.
 */
export function useAutoDismissNotice({
  identity,
  durationMs,
  onDismiss,
}: AutoDismissNoticeArgs): AutoDismissNoticeHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const remainingMsRef = useRef(0);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  const pause = useCallback(() => {
    if (timerRef.current === null || startedAtRef.current === null) return;
    remainingMsRef.current = Math.max(
      0,
      remainingMsRef.current - (Date.now() - startedAtRef.current),
    );
    clearTimer();
  }, [clearTimer]);

  const schedule = useCallback(() => {
    if (identity === null || durationMs <= 0 || hoveredRef.current || focusedRef.current) return;
    if (timerRef.current !== null) return;
    if (remainingMsRef.current <= 0) {
      onDismissRef.current();
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      startedAtRef.current = null;
      remainingMsRef.current = 0;
      onDismissRef.current();
    }, remainingMsRef.current);
  }, [durationMs, identity]);

  const syncPauseState = useCallback(() => {
    if (hoveredRef.current || focusedRef.current) {
      pause();
    } else {
      schedule();
    }
  }, [pause, schedule]);

  useEffect(() => {
    clearTimer();
    remainingMsRef.current = identity === null ? 0 : Math.max(0, durationMs);
    if (identity === null) {
      hoveredRef.current = false;
      focusedRef.current = false;
    }
    schedule();

    return clearTimer;
  }, [clearTimer, durationMs, identity, schedule]);

  const onMouseEnter = useCallback((_event: MouseEvent<HTMLElement>) => {
    hoveredRef.current = true;
    syncPauseState();
  }, [syncPauseState]);

  const onMouseLeave = useCallback((_event: MouseEvent<HTMLElement>) => {
    hoveredRef.current = false;
    syncPauseState();
  }, [syncPauseState]);

  const onFocusCapture = useCallback((_event: FocusEvent<HTMLElement>) => {
    focusedRef.current = true;
    syncPauseState();
  }, [syncPauseState]);

  const onBlurCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    focusedRef.current = false;
    syncPauseState();
  }, [syncPauseState]);

  return { onMouseEnter, onMouseLeave, onFocusCapture, onBlurCapture };
}