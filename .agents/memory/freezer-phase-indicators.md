---
name: Freezer phase indicators
description: Run-tab "Freezer filling/emptying" status indicators, how phases are detected, and parity rules.
---

# Freezer filling / emptying indicators (Run tab)

Two auto-hiding status banners on the Run tab of BOTH apps (web
`artifacts/run-calculator/src/pages/home.tsx`, mobile
`artifacts/run-calculator-mobile/app/(tabs)/index.tsx`):

- **Freezer filling** — run start: product is still travelling the freezer
  tunnel, so the completed count hasn't begun climbing yet.
- **Freezer emptying** — run end: dough feed is done but the tunnel is still
  draining the last cases.

## Phase detection (time-based, identical web+mobile)

Uses NET elapsed (web `elapsedBatchSec`, mobile `calc.netElapsedSec`), `ppm`,
`pizzasPerCase`, `casesNeeded`, `freezerTime`:

- `feedDoneMin = (casesNeeded * pizzasPerCase) / ppm` (Infinity if casesNeeded/ppc ≤ 0 → open-ended run, emptying never fires).
- `filling = elapsedMin>0 && elapsedMin<freezerMin && !feedComplete`
- `emptying = feedComplete && (feedDoneMin + freezerMin - elapsedMin) > 0`

**Why these guards matter / gotchas:**
- Gate the whole block on `ppm > 0` and `freezerMin > 0`; without `ppm>0`,
  filling would show before line speed is configured (no product actually
  moving) — flagged in review.
- `filling` requires `!feedComplete` so a very short run (feed completes before
  the tunnel even fills) cleanly switches straight to emptying instead of
  showing both.
- Only render while `runStatus==="running"` / `run.isRunning` and the run is NOT
  ended — the ended run is already covered by the separate "Freezer draining"
  banner keyed on `endedAt`. "Auto-hide when not in use" = pure conditional
  render, no dismiss state.
- Consistent with the intentional tunnel-offset count model (see
  `autotrack-remainder-carry.md`): "filling" is exactly the window where the
  completed count legitimately sits flat, so it explains the flat count.
- Countdown rounding uses `Math.floor` on both platforms for exact parity.

## "Everything stuck at 0" in production = missing line setup, not a bug

Real-world incident: a running run showed count/timing/freezer all at 0 for an
hour. Prod data showed the run values AND every saved profile had
`crustsPerCycle`/`cycleSpeed`/`pizzasPerCase`/`freezerTime` = 0 — spec-sheet
imports fill recipes/die types but NEVER machine/line settings, so factories
that onboarded purely via imports have no ppm inputs anywhere.

Fix: web Run tab now shows a missing-setup banner (right above the freezer
block) while a run is running, listing exactly which numbers are 0
(ppm inputs incl. Speed Adjustment, Pizzas Per Case; Freezer Time gets a
softer freezer-only headline when it's the only gap). Check missing-setup
before hunting for calc bugs when "counts don't move" is reported.
(Web-only for now — mobile parity paused.)
