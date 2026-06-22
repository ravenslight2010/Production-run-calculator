---
name: Floor Mode parity
description: Idle big-numbers "Floor Mode" display — web/mobile parity rules and the intentional platform diffs.
---

# Floor Mode (idle big-numbers display)

Floor Mode is the full-screen idle monitor for the line: big numbers, status, smart
chips, frontline reference, action controls. It exists on BOTH web (inline in
home.tsx) and mobile (`components/FloorMode.tsx`, wired in the Run tab).

## Intentional platform diffs (NOT formula drift — like Cast-to-Screens)
- **Third big number differs.** Web shows a live NEXT BATCH countdown; mobile has no
  live next-batch countdown, so mobile shows **Batches Ready** (`run.progress.batchesReady`).
- **No pause/resume on mobile.** Mobile has no `pause` stoppage type, so mobile Floor
  Mode action buttons are only Log Stop / End Stop / Skid Done (web also has Pause/Resume).

## Parity-sensitive details to keep aligned
- **Pace** is computed inline on both sides: expected cases = `ppm * elapsedAfterTunnel / pizzasPerCase`,
  delta = actual − expected, tolerance ±2 → on-pace/ahead/behind. Mobile uses
  `calc.netElapsedSec` (already subtracts ALL downtime) minus `freezerTime` — that
  stands in for web's pause-aware elapsed.
- **sauceBarrelBreakdown takes LBS on mobile** (`calc.sauceLbs`), batches on web — see
  the separate sauce-barrel-breakdown-signature note. Mobile Floor Mode passes `calc.sauceLbs`.
- Smart chips (the user-picked "smarter content"): pace, ETA, dough-short, allergen-sequence.

## Monitor hygiene (burn-in)
Both platforms drift the whole panel slowly and auto-dim to ~0.45 after ~90s of no
interaction, restoring instantly on touch/mouse/key. Web uses CSS `@keyframes floor-drift`
+ `floorDimmed` state; mobile uses Animated drift loop + Animated opacity.

## Mobile idle activation gotcha
Auto-open after 3 min idle MUST be gated on tab focus (`useFocusEffect`), not a plain
effect — expo-router keeps tabs mounted, so an ungated timer pops Floor Mode over
whatever OTHER tab the user is on, and touches there won't reset it.
**Why:** tabs don't unmount; the Run screen keeps running in the background.
