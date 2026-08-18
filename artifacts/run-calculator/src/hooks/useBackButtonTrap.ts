import { useEffect, useRef } from "react";

/**
 * Intercepts the Android hardware back button (and any browser back navigation)
 * so it closes in-app overlays / tabs instead of exiting the PWA.
 *
 * Usage: call once inside the main app shell component. Pass an `onBack`
 * callback that closes the topmost open thing (modal → tab history → stay).
 *
 * Technique: a "sentinel" history entry is pushed on mount so there is always
 * something to pop before the browser can navigate away. After every popstate
 * we immediately re-push so the next back press also hits this handler.
 *
 * iOS / desktop: popstate from user back-button gestures behaves identically,
 * but iOS has no hardware back button and the browser chrome on desktop handles
 * navigation — the sentinel means a single extra click to leave, which is
 * acceptable and keeps the logic simple across platforms.
 */
export function useBackButtonTrap(onBack: () => void) {
  // Keep a stable ref so the event listener always calls the latest version
  // of onBack without needing to re-register the listener on every render.
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    // Seed the sentinel — without this the very first back press exits the app.
    history.pushState({ _backTrap: true }, "");

    function handlePopState() {
      onBackRef.current();
      // Always re-push so subsequent back presses also hit this handler.
      history.pushState({ _backTrap: true }, "");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []); // register once on mount, clean up on unmount
}
