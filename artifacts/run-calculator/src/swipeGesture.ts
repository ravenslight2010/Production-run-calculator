// Pure decision logic for the run-switch swipe gesture on the Run screen.
//
// The gesture's axis is decided EARLY, from the initial touchmove direction:
// once movement exceeds a small slop, the gesture locks to horizontal or
// vertical for the rest of the touch. A vertical-locked gesture can never
// switch runs (scroll safety), and a horizontal-locked one accepts a shorter
// travel (~40px) or a fast short flick, with a relaxed straightness ratio.

export type SwipeAxis = "undecided" | "horizontal" | "vertical";

export interface SwipeState {
  startX: number;
  startY: number;
  startT: number;
  axis: SwipeAxis;
}

/** Movement (px) before we commit to an axis. Below this it's still a tap. */
export const AXIS_LOCK_SLOP_PX = 12;
/** Normal swipe: minimum horizontal travel. */
export const SWIPE_MIN_TRAVEL_PX = 40;
/** Horizontal must beat vertical by this ratio (was 3x — too strict). */
export const SWIPE_DOMINANCE_RATIO = 1.5;
/** Absolute vertical drift cap for a normal swipe. */
export const SWIPE_MAX_VERTICAL_PX = 80;
/** Fast flick: shorter travel allowed when quick enough. */
export const FLICK_MIN_TRAVEL_PX = 24;
/** Fast flick: minimum horizontal velocity in px/ms (~500 px/s). */
export const FLICK_MIN_VELOCITY = 0.5;
/** Fast flick must complete within this duration to count as a flick. */
export const FLICK_MAX_DURATION_MS = 250;

export function createSwipeState(x: number, y: number, t: number): SwipeState {
  return { startX: x, startY: y, startT: t, axis: "undecided" };
}

/**
 * Feed touchmove positions. Locks the axis on the first move that exceeds the
 * slop; once locked, the axis never changes for the rest of the touch.
 */
export function updateSwipeAxis(state: SwipeState, x: number, y: number): SwipeState {
  if (state.axis !== "undecided") return state;
  const dx = Math.abs(x - state.startX);
  const dy = Math.abs(y - state.startY);
  if (Math.max(dx, dy) < AXIS_LOCK_SLOP_PX) return state;
  return { ...state, axis: dx >= dy ? "horizontal" : "vertical" };
}

/**
 * Decide at touchend. Returns "prev" (swipe right), "next" (swipe left), or
 * null. Vertical-locked gestures and taps always return null.
 */
export function resolveSwipe(
  state: SwipeState,
  x: number,
  y: number,
  t: number,
): "prev" | "next" | null {
  // Axis may still be undecided if there were no touchmove events (some taps)
  // — fall back to judging the end position, same early-lock rule.
  const s = updateSwipeAxis(state, x, y);
  if (s.axis !== "horizontal") return null;

  const dx = x - s.startX;
  const dy = y - s.startY;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const dt = Math.max(1, t - s.startT);

  if (adx < ady * SWIPE_DOMINANCE_RATIO) return null;
  if (ady > SWIPE_MAX_VERTICAL_PX) return null;

  const isNormalSwipe = adx >= SWIPE_MIN_TRAVEL_PX;
  const isFlick =
    adx >= FLICK_MIN_TRAVEL_PX &&
    dt <= FLICK_MAX_DURATION_MS &&
    adx / dt >= FLICK_MIN_VELOCITY;
  if (!isNormalSwipe && !isFlick) return null;

  return dx < 0 ? "next" : "prev";
}

/**
 * True when a touch starting on this element must never trigger a run switch:
 * form controls, buttons/links, and horizontally scrollable containers.
 */
export function isSwipeExcludedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, button, a, [role='slider'], [data-no-swipe]")) return true;
  // Walk up looking for a horizontally scrollable ancestor.
  let el: Element | null = target;
  while (el && el !== document.body) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const overflowX = typeof getComputedStyle === "function" ? getComputedStyle(el).overflowX : "";
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}
