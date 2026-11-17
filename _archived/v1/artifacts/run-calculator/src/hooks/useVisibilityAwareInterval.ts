import { useEffect, useRef } from "react";

/**
 * Runs an interval only while the page is visible. When a visible page regains
 * focus, the callback runs immediately before the interval is restarted.
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  delay: number,
  enabled = true,
  restartKey?: unknown,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };

    const start = () => {
      stop();
      if (enabled && !document.hidden) {
        id = setInterval(() => callbackRef.current(), delay);
      }
    };

    const resume = () => {
      if (!enabled || document.hidden) {
        stop();
        return;
      }
      callbackRef.current();
      start();
    };

    start();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [delay, enabled, restartKey]);
}