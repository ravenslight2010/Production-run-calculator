// @vitest-environment jsdom
//
// Rendered verification that the forward-skew upper-bound cap holds in the
// REAL ElapsedTimeBadge component exported from home.tsx — the same component
// used at both capped call sites:
//
//   1. CompactRunStrip "Running · <elapsed>" badge  (~line 15368 in home.tsx)
//   2. Elapsed Time display card                    (~line 16021 in home.tsx)
//
// ElapsedTimeBadge is the single source of truth for the cap expression:
//   addend = Math.min(runAge, Math.max(0, nowMs - pausedAt))
//
// Both call sites render ElapsedTimeBadge with their respective
// data-testid props, so any regression in the component (e.g. removing the
// Math.min upper bound) will fail this test regardless of which call site is
// affected.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ElapsedTimeBadge } from "./pages/home";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helper: parse "1h 30m" → total minutes, or "45m" → 45.
// ---------------------------------------------------------------------------
function toMinutes(text: string): number {
  const hourMatch = text.match(/(\d+)h\s*(\d+)m/);
  if (hourMatch) return parseInt(hourMatch[1]) * 60 + parseInt(hourMatch[2]);
  const minMatch = text.match(/(\d+)m/);
  if (minMatch) return parseInt(minMatch[1]);
  return 0;
}

describe("ElapsedTimeBadge — cap rendered via real component", () => {
  // -------------------------------------------------------------------------
  // Scenario A: normal case — no extreme drift, cap is inactive.
  // Run started 40 min ago, paused 10 min ago → addend = 30 min → total 70m.
  // -------------------------------------------------------------------------
  it("normal paused run: shows 1h 10m (40 min age + 30 min pause addend)", () => {
    const startedAt = 0;
    const nowMs = 40 * 60_000;
    const pausedAt = 10 * 60_000; // paused 30 min ago
    render(
      <ElapsedTimeBadge
        data-testid="badge"
        nowMs={nowMs}
        startedAt={startedAt}
        pausedAt={pausedAt}
      />,
    );
    expect(screen.getByTestId("badge").textContent).toBe("1h 10m");
  });

  // -------------------------------------------------------------------------
  // Scenario B: extreme forward-drifted pausedAt (recorded when device clock
  // was 2 hours behind), which would make the raw addend 150 min for a 30-min
  // run. The Math.min upper-bound cap clamps addend to runAge (30 min) so the
  // total shows 60 min (2× run age) instead of 180 min.
  // -------------------------------------------------------------------------
  describe("extreme forward-drifted pausedAt — cap fires on both call sites", () => {
    const startedAt = 1_000_000_000; // arbitrary epoch anchor
    const runAgeMs = 30 * 60_000; // run is 30 min old
    const nowMs = startedAt + runAgeMs;
    // pausedAt stamped when the device clock was 2 hours behind nowMs:
    const pausedAt = startedAt - 2 * 60 * 60_000;

    it("CompactRunStrip call site: displayed time ≤ 2× run age (60m)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("strip-elapsed").textContent ?? "",
      );
      expect(minutes).toBeLessThanOrEqual((runAgeMs / 60_000) * 2);
    });

    it("CompactRunStrip call site: shows exactly 1h 0m (cap clamps to run age)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="strip-elapsed"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      expect(screen.getByTestId("strip-elapsed").textContent).toBe("1h 0m");
    });

    it("Elapsed Time card call site: displayed time ≤ 2× run age (60m)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      const minutes = toMinutes(
        screen.getByTestId("elapsed-card-value").textContent ?? "",
      );
      expect(minutes).toBeLessThanOrEqual((runAgeMs / 60_000) * 2);
    });

    it("Elapsed Time card call site: shows exactly 1h 0m (cap clamps to run age)", () => {
      render(
        <ElapsedTimeBadge
          data-testid="elapsed-card-value"
          nowMs={nowMs}
          startedAt={startedAt}
          pausedAt={pausedAt}
        />,
      );
      expect(screen.getByTestId("elapsed-card-value").textContent).toBe("1h 0m");
    });
  });

  // -------------------------------------------------------------------------
  // Scenario C: no pausedAt → addend is 0, only raw run age shown.
  // -------------------------------------------------------------------------
  it("no pausedAt: shows raw run age (45m)", () => {
    render(
      <ElapsedTimeBadge
        data-testid="badge"
        nowMs={45 * 60_000}
        startedAt={0}
        pausedAt={null}
      />,
    );
    expect(screen.getByTestId("badge").textContent).toBe("45m");
  });

  // -------------------------------------------------------------------------
  // Scenario D: future pausedAt (stamp in the future, skew other direction).
  // Math.max(0, nowMs - pausedAt) clamps the addend to 0 → raw age shown.
  // -------------------------------------------------------------------------
  it("future pausedAt: addend clamped to 0, shows raw run age (30m)", () => {
    const nowMs = 30 * 60_000;
    render(
      <ElapsedTimeBadge
        data-testid="badge"
        nowMs={nowMs}
        startedAt={0}
        pausedAt={nowMs + 5 * 60_000} // 5 min in the future
      />,
    );
    expect(screen.getByTestId("badge").textContent).toBe("30m");
  });
});
