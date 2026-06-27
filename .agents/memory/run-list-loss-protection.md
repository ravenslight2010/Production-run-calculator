---
name: Run-list loss protection (server)
description: Why the sync server must additively protect dayState.runs, not just per-run values, and how the resetAt escape hatch works.
---

# Run-list loss protection on the shared day-state row

The `daily_sync` blob row (one per scope+date) is shared by all web + mobile
devices. Two distinct loss bugs lived here; both are now guarded server-side in
`protectRunValues` (called atomically under `FOR UPDATE` by `upsertProtected`):

1. **Empty value over populated** — per-run `runValues` is a strictly-newer-stamp
   register merge keyed on `runValuesUpdatedAt`. Equal/older stamps keep stored
   (blocks the transient empty-form-with-real-stamp push).
2. **Whole runs vanishing** — the server used to blind-replace `dayState.runs`
   from any single push. A device briefly holding a SHORTER run list (post-refresh
   / before seeing peers' runs) wiped everyone's runs. Confirmed in prod: runs
   with edit stamps but NO `deletedItems.runs` tombstone and no run object on any
   day = clobbered, never deleted.

**Rule:** the run LIST is now an additive union by id (incoming order first, then
stored-only runs appended), minus ids tombstoned in EITHER side's
`deletedItems.runs`. No single push can drop a non-tombstoned run.

**Why:** prior fixes (7 attempts) only ever protected run *values*; the run list
was the uncovered hole. Protecting values without the list still loses data.

**How to apply:** any future change to sync merge must treat `dayState.runs` and
`runValues` with the SAME additive + tombstone discipline. Deletion MUST go
through a synced `deletedItems.runs` tombstone or the additive union resurrects it
(accepted cross-peer re-add tradeoff, same as master-data merges).

**resetAt escape hatch:** if incoming `dayState.resetAt > stored resetAt` the
server adopts the incoming payload WHOLESALE (a genuine daily reset/new shift
starts fresh; empty maps are correct). During normal same-day editing `resetAt`
is stable, so additive protection applies. This mirrors the clients'
`isReset = remoteResetAt > prev.resetAt` receive semantics. New-day rollovers
write a NEW date row (empty existing → accept incoming) so they don't hit this.

**resetAt baseline guard (critical):** the escape hatch MUST also require the
STORED row to already have a real baseline — `exReset > 0 && inReset > exReset`.
A missing/NULL stored resetAt defaults to 0, so without this guard EVERY normal
same-day push (which carries the day's real, large, stable resetAt) compares
`bigNumber > 0` → looks like a "newer reset" → wholesale-clobbers the shared row,
bypassing ALL additive protection. This was the "a reset blanked everything I
entered" report (production: the active day's row had resetAt = NULL while every
other day had a number). **Why:** a missing baseline must never be treated as
"older than every real reset." Falling through to additive merge preserves runs
AND populates resetAt from incoming, so the next comparison is sound (a genuine
reset on a legacy null-baseline row then clears on the SECOND push — acceptable
vs. silent loss). The same null/0 trap applies to ANY future resetAt comparison.

Lost runs' DATA is unrecoverable once gone from the row (values aren't stored);
the fix only prevents FUTURE loss. Orphan stamps left by past loss are benign
(payload builders key runValues to `dayState.runs`, so orphan stamps are ignored).
