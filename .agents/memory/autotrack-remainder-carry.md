---
name: Auto-track tray/batch remainder carry
description: Why auto-track dough trays/batches must carry a fractional remainder across buckets, or they freeze.
---

# Auto-track tray/batch decrement must carry a fractional remainder

Auto-track runs once per 5-min wall-clock bucket. Skids/cases advance via a
**cumulative-floor delta** (`floor(cumulative) - prevFloored`), so sub-unit
production is preserved across buckets. Trays/batches originally decremented with
a fresh per-bucket `Math.floor((bucketDurationMin * ppm) / perUnit)`.

**Bug:** any consumption under 1 unit *per bucket* floored to 0 and was lost
forever. For batches especially (`perBatch` = doughBatchYield, often hundreds of
doughballs), one 5-min bucket consumes < 1 batch, so it floored to 0 every bucket
and batches never moved — user reported "trays and batches are not auto updating".

**Fix / invariant:** carry a fractional remainder ref per unit:
`exact = bucketConsumption + remainder; consumed = floor(exact); remainder = exact - consumed`.
Reset the remainder refs wherever the other auto-track baselines reset (run
end/pending, active-run/runId change, autoTrack toggle), so a new/switched run
starts clean.

**Why:** without carry, any depleting counter whose per-bucket consumption is
< 1 unit silently freezes. This is intrinsic to per-bucket flooring; the
cumulative-delta pattern used by skids/cases does not have it.

**How to apply:** mirror web `useAutoTrack.ts` and mobile `RunContext.tsx`
auto-track effect exactly (strict parity). Remainder is NOT advanced while the
manual-edit suppression window is open (effect returns before the decrement
block) — accepted <1-unit catch-up lag, consistent with skids/cases.

**Known separate parity drift (NOT this bug):** web skids/cases expected output
applies a freezer/tunnel offset (`elapsedMinAfterTunnel`), mobile's
`expectedCasesRaw` uses `netElapsedSec` with no freezer subtraction. Track/fix
separately if it surfaces.
