---
name: Run-complete "time's up" alert timing
description: How the end-of-run notification must be gated to avoid false fire at run start, and the web/mobile parity gotcha behind it.
---

# Run-complete "time's up" alert

The end-of-run notification ("time's up, end the run") lives in each app's
`useNotifications` run-complete effect. It must only fire on a genuine countdown
reaching zero — never the instant a run starts.

## Rule
Fire run-complete only when BOTH:
1. There is a valid timing basis (line speed `ppm > 0`).
2. Remaining time has actually counted DOWN from a positive value to <= 0
   (tracked with a per-run `runWasTimedRef` latch).

**Why:** A run started before line speed / casesNeeded are entered has zero
remaining time from the very first tick, so without the latch + ppm guard it
pops "time's up" immediately at start. Reported as a real user bug.

## Web/mobile parity gotcha
The two apps express "no valid timing basis" differently — this is the trap:
- **Mobile** `computeCalc.minutesRemaining` is `number | null`; it is **null**
  whenever `ppm <= 0` (only set when `ppm > 0`). So `minutesRemaining === null`
  already means "no basis".
- **Web** `computeCalc.adjustedTimeSec` is **never null** — when `ppm <= 0` it
  falls back to `totalTimeSec`, which is NOT a real countdown. So web MUST add
  an explicit `if (calc.ppm <= 0) return;` guard to match mobile. `ppm` had to
  be added to the web hook's `NotifCalc` interface for this.

**How to apply:** Any change to either run-complete effect must keep the latch
+ ppm guard on BOTH platforms and fire on the same logical condition
(`ppm > 0 && remaining counted down to <= 0`). Don't assume web's
`adjustedTimeSec` going to 0 means completion — confirm `ppm > 0` first.
