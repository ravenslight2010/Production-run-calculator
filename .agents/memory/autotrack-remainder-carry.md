---
name: Auto-track tray/batch remainder carry
description: Why auto-track dough trays/batches must carry a fractional remainder across buckets, or they freeze.
---

# Auto-track tray/batch decrement must carry a fractional remainder

Each auto-track counter ticks at its own natural production pace (see "Rate-based
cadence" below). Skids/cases advance via a **cumulative-floor delta**
(`floor(cumulative) - prevFloored`), so sub-unit production is preserved across
ticks. Trays/batches originally decremented with a fresh per-tick
`Math.floor((durationMin * ppm) / perUnit)`.

**Bug:** any consumption under 1 unit *per tick* floored to 0 and was lost
forever. For batches especially (`perBatch` = doughBatchYield, often hundreds of
doughballs), one tick consumes < 1 batch, so it floored to 0 every tick
and batches never moved — user reported "trays and batches are not auto updating".

**Fix / invariant:** carry a fractional remainder ref per unit:
`exact = tickConsumption + remainder; consumed = floor(exact); remainder = exact - consumed`.
Reset the remainder refs wherever the other auto-track baselines reset (run
end/pending, active-run/runId change, autoTrack toggle), so a new/switched run
starts clean.

**Why:** without carry, any depleting counter whose per-bucket consumption is
< 1 unit silently freezes. This is intrinsic to per-bucket flooring; the
cumulative-delta pattern used by skids/cases does not have it.

**How to apply:** mirror web `useAutoTrack.ts` and mobile `RunContext.tsx`
auto-track effect exactly (strict parity). Remainder is NOT advanced while the
manual-edit suppression window is open (writes AND remainder updates are skipped;
bookkeeping refs still advance) — accepted <1-unit catch-up lag, consistent with
skids/cases.

**Freezer/tunnel offset for skids/cases (fixed):** skids/cases count *completed
output*, which exits the freezer tunnel `freezerTime` minutes after the dough is
fed in — so it must use `elapsedMinAfterTunnel = max(0, elapsedMin - freezerTime)`,
NOT raw elapsed. The `doughFeedComplete` gate counts *front-of-line feed* and
must stay on RAW elapsed (no offset). Both apps now split these into two counts
(`feedCasesRaw` raw → doughFeedComplete; `outputCasesRaw` after-tunnel → skids/
cases). Never re-couple them into one count, or one timeline will be wrong.
**Why:** mobile previously used one no-offset count for both and overcounted
completed cases by `freezerTime` worth of production.

**Incremental delta must baseline off the UNCLAMPED expected, not the clamped
one:** skids/cases `expectedCases` is clamped to `casesNeeded` for display/write,
but the per-tick delta MUST be `rawExpected_now - rawExpected_prev` (web
`expectedCasesRaw`, mobile `outputCasesRaw`). If the delta uses the *clamped*
value, then once the time-based estimate saturates at `casesNeeded` both terms pin
at `casesNeeded`, delta is 0 forever, and after the operator corrects the count
DOWN (estimate ran ahead) auto-track can never climb again — user reported "auto
count was ahead, I adjusted it and hit Resume now, it never started back up."
Keep the output cap (`Math.min(target, Math.max(curTotal, casesNeeded))`) so the
count still can't cycle past target. Strict web+mobile parity.

**Freezer delay is intentional even with cases on the skid at Start:** when the
operator enters a starting count (e.g. cases already on the skid) before Start,
the desired behavior is to KEEP the freezer-tunnel delay for NEW output and have
the count build up FROM the entered number — which the incremental delta model
already does (`target = curTotal + delta`, tunnel-offset output). Do NOT remove
the tunnel offset for a "primed" line; an attempt to credit output immediately
on a primed line was explicitly rejected by the user.

## Effect declaration order: resets BEFORE the write effect

React runs effects in declaration order. The baseline-reset effects (runId /
auto-track toggle / run-stopped) must be declared BEFORE the write effect. With
write-first ordering, the mount pass wrote, the resets then wiped the
bookkeeping refs — losing the fractional tray/batch remainder (freezing
slow-depleting batches) — and re-armed the SAME tick to fire again on the next
second (double tray decrement). Mobile always had reset-first; web was fixed to
match. Guarded by the web auto-track test suite (single-tick-on-mount +
remainder-carry cases).

## Rate-based cadence: each counter ticks at its production pace (NO interval setting)

A user-configurable fixed refresh interval was built and then explicitly
REJECTED by the user — do not reintroduce it. Instead every counter has its own
period derived from the line rate: cases/skids = `pizzasPerCase/ppm` min (skid
counter derives from the same running total, so it rolls the moment a skid's
last case completes); trays = `perTray/ppm`; batches = quarter-batch
`perBatch/ppm/4` (the integer count still drops once per full batch via the
remainder carry). Periods are clamped 2s–60min (`clampPeriodMs` web /
`clampAutoPeriodMs` mobile): floor because the app clock ticks per second,
ceiling so a garbage rate can't freeze a counter forever. Implementation is
per-counter "next due at" wall-clock refs (0 = fire on next tick) plus
per-counter lastMs refs for actual-duration consumption (capped at 2 periods,
first tick assumes one period). "Resume now" / auto-toggle-on
(`fireAutoTrackNow` web, `resumeAutoTrack` mobile) zero ONLY the due refs —
keeping the expectedCases baseline and lastMs — so resuming never causes a
catch-up jump over a manual edit; full resets (run change/stop/toggle) clear
everything.
