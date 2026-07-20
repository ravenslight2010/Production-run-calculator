---
name: Run-complete "time's up" alert timing
description: How the end-of-run notification must be gated to avoid false fire at run start, and the web/mobile parity gotcha behind it.
---

# Run-complete "time's up" alert

The end-of-run notification ("time's up, end the run") lives in each app's
`useNotifications` run-complete effect. It must only fire on a genuine countdown
reaching zero — never the instant a run starts.

## Rule
Fire run-complete only when ALL of:
1. There is a valid timing basis (line speed `ppm > 0`).
2. Remaining time has actually counted DOWN from a positive value to <= 0
   (tracked with a per-run `runWasTimedRef` latch).
3. The run has been running at least 60s (safety floor) — stale carried-over
   progress fields or a transient calc/run-id mismatch at Start can zero the
   countdown even when the latch was set; no run legitimately completes in
   under a minute.

## Threshold alerts must CROSS, not just be under
Same class of bug for the "15 minutes left" alert: a run whose press time is
under 15 min starts with the countdown already <= 900s and fired instantly at
Start. Any threshold alert must latch per-run that the value was observed
ABOVE the threshold first (web: `sawAbove15Ref` Set) and only fire on the
downward crossing. Apply this pattern to any new time/quantity threshold alert.

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
