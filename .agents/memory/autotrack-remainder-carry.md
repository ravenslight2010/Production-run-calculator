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

**Freezer/tunnel offset for skids/cases (fixed):** skids/cases count *completed
output*, which exits the freezer tunnel `freezerTime` minutes after the dough is
fed in — so it must use `elapsedMinAfterTunnel = max(0, elapsedMin - freezerTime)`,
NOT raw elapsed. The `doughFeedComplete` gate counts *front-of-line feed* and
must stay on RAW elapsed (no offset). Both apps now split these into two counts
(`feedCasesRaw` raw → doughFeedComplete; `outputCasesRaw` after-tunnel → skids/
cases). Never re-couple them into one count, or one timeline will be wrong.
**Why:** mobile previously used one no-offset count for both and overcounted
completed cases by `freezerTime` worth of production.

**Primed-line exception to the tunnel offset:** the tunnel offset only holds
when the tunnel starts EMPTY at run start. If the line is already primed —
completed cases on the skid *before* Start — finished product exits immediately,
so the OUTPUT count must use raw elapsed (no tunnel offset). Latch "primed" once
per run from the start-of-run completed total on the first bucket; reset it with
the other auto-track baselines. The feed-completion gate stays on raw elapsed
regardless.
**Why:** an operator with cases already on the skid saw auto-track keep the
pre-start count but not climb for a full extra skid — it was waiting out a
freezer tunnel that didn't apply to an already-running line. Keep web+mobile at
parity.
