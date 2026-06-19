---
name: Mobile per-second render clock split
description: Why the mobile RunContext keeps the 1s tick in a separate clock context, and the rule for adding consumers.
---

# Mobile foreground re-render: keep the clock context separate

The mobile app's per-second `tick`, the live `calc` snapshot, and `activeStoppage`
live in their own small context (`useRunClock()`), separate from the main
`useRun()` context. The main context value is memoized so its identity stays
stable across ticks.

**Why:** A 1-second timer drives the live run clock. When those live fields lived
inside the single (non-memoized, inline) `useRun()` value, every screen consuming
`useRun()` re-rendered once per second during an active run — wasted CPU/battery
in the foreground, even on settings tabs that show no live time.

**How to apply:**
- A screen should subscribe to `useRunClock()` ONLY if it must update every second
  (currently the Run screen, Stoppages active-duration, and Summary live metrics).
- Any other screen must read `run` from `useRun()` and compute its own snapshot via
  `computeCalc(run, Date.now())` — do NOT pull `calc` from the clock, or it
  re-renders every second and the optimization is lost.
- The main `useRun()` value's `useMemo` deps assume every callback in it is
  `useCallback`-stable. If you add a non-stable (plain inline) function to that
  value, the memo will rebuild on every tick and silently re-break this. Keep new
  context callbacks `useCallback`-wrapped.
