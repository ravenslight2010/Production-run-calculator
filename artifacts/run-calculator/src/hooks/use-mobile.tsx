import * as React from "react"

const MOBILE_BREAKPOINT = 768

function matchesMedia(query: string): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
      : null;
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql?.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql?.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

function canUseTouchInput(): boolean {
  if (typeof window === "undefined") return false;

  const primaryCoarse = matchesMedia("(pointer: coarse)");
  const anyCoarse = matchesMedia("(any-pointer: coarse)");
  const primaryFine = matchesMedia("(pointer: fine)");
  const touchPoints = navigator.maxTouchPoints ?? 0;

  // A coarse primary pointer is touch-oriented even when the browser does
  // not expose maxTouchPoints. A touch-capable browser with no fine primary
  // pointer is also touch-oriented; keep laptops with a fine mouse on the
  // native select path until touch is actually used.
  return primaryCoarse || anyCoarse && !primaryFine || touchPoints > 0 && !primaryFine;
}

/**
 * Reports whether the current input is touch-oriented, without user-agent or
 * viewport assumptions. The initial value is stable during hydration; the
 * effect updates it once browser capabilities are available.
 */
export function useIsTouchDevice(): boolean {
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);

  React.useEffect(() => {
    const mediaQueries = typeof window.matchMedia === "function"
      ? [
          window.matchMedia("(pointer: coarse)"),
          window.matchMedia("(pointer: fine)"),
          window.matchMedia("(any-pointer: coarse)"),
        ]
      : [];
    const update = () => setIsTouchDevice(canUseTouchInput());
    mediaQueries.forEach((query) => query.addEventListener("change", update));
    window.addEventListener("touchstart", update, { passive: true });
    update();

    return () => {
      mediaQueries.forEach((query) => query.removeEventListener("change", update));
      window.removeEventListener("touchstart", update);
    };
  }, []);

  return isTouchDevice;
}
