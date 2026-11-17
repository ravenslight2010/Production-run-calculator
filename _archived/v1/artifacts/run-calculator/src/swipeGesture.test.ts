import { describe, it, expect } from "vitest";
import {
  createSwipeState,
  updateSwipeAxis,
  resolveSwipe,
} from "./swipeGesture";

// Simulate a touch flow: touchstart at (x0,y0,t0), touchmoves, touchend.
function runGesture(
  points: Array<{ x: number; y: number; t: number }>,
): "prev" | "next" | null {
  const [start, ...rest] = points;
  let state = createSwipeState(start.x, start.y, start.t);
  const end = rest.length ? rest[rest.length - 1] : start;
  for (const p of rest.slice(0, -1)) state = updateSwipeAxis(state, p.x, p.y);
  return resolveSwipe(state, end.x, end.y, end.t);
}

describe("run-switch swipe gesture", () => {
  it("natural slightly diagonal left swipe switches to next run", () => {
    // 55px left, 25px down over 300ms — old rules rejected this (needed 60px & 3x ratio)
    expect(
      runGesture([
        { x: 200, y: 300, t: 0 },
        { x: 180, y: 305, t: 80 },
        { x: 160, y: 315, t: 160 },
        { x: 145, y: 325, t: 300 },
      ]),
    ).toBe("next");
  });

  it("natural diagonal right swipe switches to previous run", () => {
    expect(
      runGesture([
        { x: 100, y: 300, t: 0 },
        { x: 130, y: 310, t: 100 },
        { x: 150, y: 320, t: 250 },
      ]),
    ).toBe("prev");
  });

  it("short fast flick registers via velocity", () => {
    // Only 30px travel but done in 50ms → 0.6 px/ms
    expect(
      runGesture([
        { x: 200, y: 300, t: 0 },
        { x: 185, y: 302, t: 25 },
        { x: 170, y: 304, t: 50 },
      ]),
    ).toBe("next");
  });

  it("short slow drag does NOT register", () => {
    expect(
      runGesture([
        { x: 200, y: 300, t: 0 },
        { x: 185, y: 302, t: 200 },
        { x: 170, y: 304, t: 500 },
      ]),
    ).toBe(null);
  });

  it("vertical scroll gesture never switches, even if it hooks sideways at the end", () => {
    // Starts clearly vertical → axis locks to vertical; a late horizontal hook is ignored
    expect(
      runGesture([
        { x: 200, y: 300, t: 0 },
        { x: 202, y: 330, t: 80 }, // locks vertical
        { x: 150, y: 380, t: 300 }, // ends with a big horizontal component
      ]),
    ).toBe(null);
  });

  it("diagonal-but-vertical-dominant gesture is a scroll", () => {
    expect(
      runGesture([
        { x: 200, y: 300, t: 0 },
        { x: 190, y: 320, t: 80 }, // dy > dx at lock time
        { x: 150, y: 400, t: 300 },
      ]),
    ).toBe(null);
  });

  it("tap does nothing", () => {
    expect(
      runGesture([
        { x: 200, y: 300, t: 0 },
        { x: 202, y: 301, t: 90 },
      ]),
    ).toBe(null);
  });

  it("axis stays locked once decided (no re-lock on later moves)", () => {
    let s = createSwipeState(200, 300, 0);
    s = updateSwipeAxis(s, 220, 302); // locks horizontal
    expect(s.axis).toBe("horizontal");
    const locked = updateSwipeAxis(s, 220, 400); // huge vertical afterwards
    expect(locked.axis).toBe("horizontal");
  });

  it("horizontal swipe with excessive vertical drift is rejected", () => {
    // 140px right but also 90px down — beyond the vertical cap
    expect(
      runGesture([
        { x: 100, y: 200, t: 0 },
        { x: 140, y: 210, t: 80 },
        { x: 240, y: 290, t: 300 },
      ]),
    ).toBe(null);
  });

  it("straightness ratio relaxed to 1.5x: 60px horizontal with 35px vertical passes", () => {
    expect(
      runGesture([
        { x: 200, y: 300, t: 0 },
        { x: 175, y: 308, t: 100 },
        { x: 140, y: 335, t: 350 },
      ]),
    ).toBe("next");
  });

  it("resolveSwipe works even with no touchmove events (axis decided at end)", () => {
    const s = createSwipeState(200, 300, 0);
    expect(resolveSwipe(s, 130, 310, 200)).toBe("next");
    const tap = createSwipeState(200, 300, 0);
    expect(resolveSwipe(tap, 201, 300, 100)).toBe(null);
  });
});
