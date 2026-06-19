---
name: Auto-track must stop at the run's need
description: Auto-track (skids/cases + web dough trays/batches) must freeze/stop once the run has what it needs, not run forever while "running".
---

# Auto-track stops when the run has what it needs

Auto-track advances run progress once per 5-min bucket while a run is "running".
Two ways it used to over-provision past the run's actual need:

1. **Modulo wrap (web + mobile).** `skids`/`casesOnCurrentSkid` are derived from
   `expectedCases` (elapsed × ppm ÷ pizzasPerCase). `skids` was capped at
   `maxSkids` but `casesOnSkid = expectedCases % casesPerSkid` kept *cycling* once
   production passed `casesNeeded`. Fix: **clamp `expectedCases` to `casesNeeded`**
   before deriving skids/cases, so both freeze at the final state.

2. **Dough/doughball over-depletion (web only).** Web auto-track *decrements*
   `traysOnLine`/`batchesReady` every bucket; mobile does NOT auto-track these (no
   per-tray/batch consumption rate). The decrement had no "run satisfied" check, so
   it kept depleting (and the steppers kept re-suggesting more dough) after the run
   already had everything it needed. Fix: gate the decrement on `doughFeedComplete`
   = **front-of-line** fed cases ≥ `casesNeeded`. Dough enters at the FRONT (use
   raw `elapsedBatchSec`, NO freezer/tunnel offset), so feeding finishes *before*
   output does — gating on output-complete would over-consume by ~freezerTime.

**Why:** user reported dough/doughballs auto-tracking "keeps going even after we
have what we need for the run."

**How to apply:** keep web (`useAutoTrack`) and mobile (RunContext auto-track
effect) at parity for the clamp. The dough-decrement gate is web-only by design.
Don't break the self-correcting incremental decrement, the 0 floor, or the 10-min
manual-edit suppression (`autoSuppressUntilRef`). Latent edge case (pre-existing):
`casesNeeded <= 0` falls back to unclamped raw and can still cycle.
