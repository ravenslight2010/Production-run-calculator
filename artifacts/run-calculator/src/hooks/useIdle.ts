import { useSyncExternalStore } from "react";

const IDLE_MS = 3 * 60 * 1_000;
const ACTIVITY_EVENTS = ["touchstart", "mousedown", "keydown"] as const;

// ── Module-level singleton ────────────────────────────────────────────────────
// One shared idle state and ONE set of window listeners, regardless of how
// many hooks call useIdle(). Listeners are added on first subscriber and
// removed when the last subscriber unmounts.

let isIdleValue = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let mountCount = 0;
const callbacks = new Set<() => void>();

function notify(): void {
  callbacks.forEach(fn => fn());
}

function onActivity(): void {
  if (idleTimer) clearTimeout(idleTimer);
  const wasIdle = isIdleValue;
  isIdleValue = false;
  idleTimer = setTimeout(() => {
    isIdleValue = true;
    notify();
  }, IDLE_MS);
  if (wasIdle) notify();
}

function addGlobalListeners(): void {
  ACTIVITY_EVENTS.forEach(ev =>
    window.addEventListener(ev, onActivity, { passive: true }),
  );
  onActivity(); // arm timer immediately
}

function removeGlobalListeners(): void {
  ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  isIdleValue = false;
}

// useSyncExternalStore subscribe contract: returns an unsubscribe function.
function subscribe(callback: () => void): () => void {
  callbacks.add(callback);
  if (++mountCount === 1) addGlobalListeners();
  return () => {
    callbacks.delete(callback);
    if (--mountCount === 0) removeGlobalListeners();
  };
}

function getSnapshot(): boolean { return isIdleValue; }
function getServerSnapshot(): boolean { return false; }

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the user has not interacted with the page for 3 minutes.
 * Resets immediately on touchstart, mousedown, or keydown.
 *
 * Backed by a module-level singleton: all consumers share ONE set of window
 * event listeners no matter how many times this hook is called. Polling hooks
 * use the result to slow their refetch intervals while the device is idle,
 * reducing battery drain and network radio usage on floor tablets.
 */
export function useIdle(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
