import { useEffect } from "react";

type ScreenWakeLockSentinel = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<ScreenWakeLockSentinel>;
  };
};

/**
 * Keeps the display awake while an operator-facing screen is active.
 *
 * Screen Wake Lock is optional and may be rejected by the browser because of
 * permissions, power state, or platform policy. Those outcomes must not affect
 * the rest of the application.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) return;

    let disposed = false;
    let requestInFlight = false;
    let sentinel: ScreenWakeLockSentinel | null = null;

    const onRelease = () => {
      sentinel = null;
    };

    const releaseCurrent = () => {
      const current = sentinel;
      sentinel = null;
      if (!current) return;
      current.removeEventListener("release", onRelease);
      void current.release().catch(() => undefined);
    };

    const acquire = async () => {
      if (
        disposed
        || requestInFlight
        || sentinel
        || document.visibilityState !== "visible"
      ) return;

      requestInFlight = true;
      try {
        const acquired = await wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") {
          void acquired.release().catch(() => undefined);
          return;
        }
        sentinel = acquired;
        acquired.addEventListener("release", onRelease);
      } catch {
        // Unsupported policy, denied permission, and low-power rejection are
        // expected non-fatal outcomes. Floor Mode remains fully usable.
      } finally {
        requestInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      } else {
        releaseCurrent();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquire();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      releaseCurrent();
    };
  }, [active]);
}