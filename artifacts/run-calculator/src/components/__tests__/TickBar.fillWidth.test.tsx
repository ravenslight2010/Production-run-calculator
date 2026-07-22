// @vitest-environment jsdom
//
// Regression guard: the REAL TickBar component (src/components/TickBar.tsx —
// the same component rendered in LiveDoughTabContent) must correctly update
// its fill div's inline style.width when secLeft changes.
//
// This exercises the actual TickBar UI rendering path. If the pct formula,
// style binding, or data-testid is removed, these assertions fail immediately
// without requiring a full running session.
//
// Two complementary guards:
//   1. Formula correctness — exact pct values at secLeft=period, half, zero.
//   2. Monotone increase — fill width strictly grows as secLeft decreases,
//      so a frozen bar (all widths equal) is immediately caught.

import { describe, it, expect, afterEach } from "vitest";
import { render, within, cleanup } from "@testing-library/react";
import { TickBar } from "../../components/TickBar";

afterEach(cleanup);

const PERIOD = 36; // seconds — typical tray period (perTray=60, ppm=100)

function getFill(container: HTMLElement): HTMLElement {
  const fill = within(container).getByTestId("tickbar-fill");
  return fill as HTMLElement;
}

describe("TickBar component — fill-width regression guard", () => {
  it("fill is 0% when secLeft equals periodSec (bar just reset to full countdown)", () => {
    const { container } = render(
      <TickBar
        label="Line eats 1 tray in"
        secLeft={PERIOD}
        periodSec={PERIOD}
        color="text-orange-400"
      />,
    );
    // pct = (1 - 36/36) * 100 = 0
    expect(getFill(container).style.width).toBe("0%");
  });

  it("fill is 100% when secLeft is 0 (countdown has elapsed)", () => {
    const { container } = render(
      <TickBar
        label="Line eats 1 tray in"
        secLeft={0}
        periodSec={PERIOD}
        color="text-orange-400"
      />,
    );
    // pct = (1 - 0/36) * 100 = 100
    expect(getFill(container).style.width).toBe("100%");
  });

  it("fill width increases as secLeft decreases (monotone animation guard)", () => {
    const { container, rerender } = render(
      <TickBar
        label="Line eats 1 tray in"
        secLeft={PERIOD}
        periodSec={PERIOD}
        color="text-orange-400"
      />,
    );
    const fill = getFill(container);

    // T0: secLeft = PERIOD → pct ≈ 0%
    const w0 = parseFloat(fill.style.width);

    // T1: secLeft = PERIOD/2 → pct = 50%
    rerender(
      <TickBar
        label="Line eats 1 tray in"
        secLeft={PERIOD / 2}
        periodSec={PERIOD}
        color="text-orange-400"
      />,
    );
    const w1 = parseFloat(fill.style.width);

    // T2: secLeft = 0 → pct = 100%
    rerender(
      <TickBar
        label="Line eats 1 tray in"
        secLeft={0}
        periodSec={PERIOD}
        color="text-orange-400"
      />,
    );
    const w2 = parseFloat(fill.style.width);

    // Guard: each step must produce a strictly larger fill — a frozen bar
    // would make w0 === w1 === w2 and fail here.
    expect(w1).toBeGreaterThan(w0);
    expect(w2).toBeGreaterThan(w1);

    // Exact values so any formula change in TickBar.tsx is immediately caught.
    expect(w0).toBeCloseTo(0);
    expect(w1).toBeCloseTo(50);
    expect(w2).toBeCloseTo(100);
  });

  it("fill is 0% when periodSec is 0 (no division-by-zero crash)", () => {
    const { container } = render(
      <TickBar
        label="Line eats 1 tray in"
        secLeft={0}
        periodSec={0}
        color="text-orange-400"
      />,
    );
    expect(getFill(container).style.width).toBe("0%");
  });

  it("applies the correct fill color class derived from the color prop", () => {
    const { container } = render(
      <TickBar
        label="Press adds 1 tray in"
        secLeft={18}
        periodSec={PERIOD}
        color="text-emerald-400"
      />,
    );
    // color.replace("text-","bg-") must be in the class list
    expect(getFill(container).className).toContain("bg-emerald-400");
  });
});
