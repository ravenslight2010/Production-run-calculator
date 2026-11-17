import { useEffect, useRef } from "react";

/**
 * useBackButtonTrap
 *
 * Intercepts the hardware/browser back button (Android PWA, Android Chrome)
 * by keeping a sentinel entry in the history stack.
 *
 * How it works:
 *   1. On mount, pushes `{ _backTrap: true }` onto history so there is always
 *      one "fake" entry between the current page and whatever came before it.
 *   2. Listens for `popstate`. When it fires the browser has already popped
 *      the sentinel — we call `onBack` and immediately re-push the sentinel
 *      so the next back press is also intercepted.
 *   3. On unmount the listener is removed. We do NOT pop the sentinel here
 *      because doing so would navigate the browser, which is rarely desired
 *      when a component is being replaced by another that installs its own trap.
 *
 * Behaviour by platform:
 *   - Android (PWA standalone / Chrome tab): fires popstate → intercepted ✓
 *   - iOS Safari: no hardware back button; `popstate` may fire from swipe-back
 *     gesture in browser tabs, but NOT in standalone PWA mode (safe to use).
 *   - Desktop: `popstate` fires on browser back button — intercepted only when
 *     this hook is mounted (Home is always mounted, so desktop back is
 *     intercepted too; the handler falls back gracefully to the "stay in app"
 *     branch when the stack is empty and we're already on the run tab).
 *
 * @param onBack Called whenever a back gesture / button press is detected.
 */
export function useBackButtonTrap(onBack: () => void): void {
  // Keep the latest callback in a ref so the stable popstate handler always
  // sees the current version without needing to re-register.
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    // Seed the sentinel — without this the very first back press exits the app.
    history.pushState({ _backTrap: true }, "");

    function handlePopState() {
      // Invoke the caller's handler (close modal / navigate tab / stay in app).
      onBackRef.current();
      // Always re-push so subsequent back presses also hit this handler.
      history.pushState({ _backTrap: true }, "");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once — sentinel is pushed on mount only
}
