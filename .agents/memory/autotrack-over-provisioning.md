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

2. **Dough/doughball over-depletion.** Auto-track *decrements*
   `traysOnLine`/`batchesReady` every bucket (incremental: `floor(bucketDurationMin
   * ppm / perUnit)`, floored at 0). This runs on **both** web and mobile now (user:
   "auto track should be on both on all"). The decrement had no "run satisfied"
   check, so it kept depleting (and the steppers kept re-suggesting more dough)
   after the run already had everything it needed. Fix: gate the decrement on
   `doughFeedComplete` = **front-of-line** fed cases ≥ `casesNeeded`. Dough enters
   at the FRONT (web: raw `elapsedBatchSec`; mobile: `expectedCasesRaw` from
   `netElapsedSec`, both with NO freezer/tunnel offset), so feeding finishes
   *before* output does — gating on output-complete would over-consume by
   ~freezerTime.

**Why:** user reported dough/doughballs auto-tracking "keeps going even after we
have what we need for the run."

## Auto-tracked skids/cases must be INCREMENTAL, not absolute
Suppression windows are NOT enough on their own: skids/cases used to be written as
an ABSOLUTE value derived from elapsed time (`expectedCases`), so a manual edit was
only postponed — the instant the suppression window expired, auto-track re-asserted
its absolute estimate and permanently wiped the operator's manual entry (reported:
"entered 4 skids/12 cases, auto came back and reverted to 0/35"). Fix: skids/cases
are now applied INCREMENTALLY (like trays/batches always were) — each 5-min bucket
adds `deltaCases = expectedCases_now − lastExpectedCases` onto the CURRENT (possibly
manual) total, so a manual correction becomes the new baseline.
**Why:** absolute writes can only ever overwrite; incremental writes accumulate on
top of whatever the operator entered. **How to apply (web `useAutoTrack`, mobile
RunContext auto-track effect, kept at parity):**
- Keep a per-bucket `expectedCases` baseline ref (`lastExpectedCasesRef` /
  `autoExpectedCasesRef`) and advance it EVERY bucket — **including suppressed
  buckets** (advance bucket bookkeeping before the suppression `return`) — or the
  window expiring causes a catch-up jump.
- Sentinel `-1` = "not baselined yet": first bucket after a reset seeds the absolute
  count ONLY when `curTotal === 0`, otherwise it baselines without writing — this is
  what stops reloads / run-switches from double-counting saved progress.
- Re-baseline (`-1`) on: run switch (web new `runId` param; mobile
  `currentRun.id`/`isRunning`), `pending`/`ended`, AND the auto-track on/off toggle
  (else re-enabling adds the whole backlog accrued while off).
- Never pull a value below the operator's current total: clamp with
  `Math.min(target, Math.max(curTotal, casesNeeded))`.

## Manual edits must suppress auto-track on EVERY write path
Auto-track silently reclaims a field on the next 5-min bucket unless a manual
suppression window is armed. **Every** user-driven write to an auto-tracked field
(`skidsCompleted`, `casesOnCurrentSkid`, `traysOnLine`, `batchesReady`) must arm
suppression — not just the steppers. That includes: stepper +/- AND typed numeric
input (web `StepperField.onManualChange` fires on both), "Skid Done" quick actions
(home Current-Progress card + compact/floor button on web; packaging + Run-tab on
mobile), and the AI/voice `setRunProgress` path (web + mobile assistant).
**Why:** user reported manually-entered counts getting overwritten when auto
resumed; root causes were a too-short web window (1 min) and several write paths
that armed no suppression at all. **How to apply:** web window unified to a single
`AUTO_SUPPRESS_MS` (10 min) constant in `home.tsx`, matching mobile's 10-min
`suppressAutoTrack()`. When adding any new control that mutates these 4 fields,
arm suppression in the SAME handler on BOTH platforms.

**How to apply:** keep web (`useAutoTrack`) and mobile (RunContext auto-track
effect) at full parity — clamp AND the trays/batches decrement now live on both.
Mobile needs `autoBucketTimeMsRef` (wall-clock of last bucket write) for the
duration; `computeCalc` has no perTray/perBatch so call `computeDoughSupply`, but
override `perBatch` to be mode-aware (crust→`crustsPerCase`) to match web —
`computeDoughSupply.perBatch` is always batch yield (a divergence the parity test
locks). Don't break the self-correcting incremental decrement, the 0 floor, or the
10-min manual-edit suppression. Latent edge case (pre-existing): `casesNeeded <= 0`
falls back to unclamped raw and can still cycle/deplete.
