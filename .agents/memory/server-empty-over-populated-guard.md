---
name: Server empty-over-populated guard
description: The /api/sync merge (protectRunValues) must reject all-default run values over populated ones, not trust stamps alone.
---

# Server-side empty-over-populated guard

The shared day-state merge `protectRunValues` (artifacts/api-server, used by
`upsertProtected` for both `/sync/today` and `/sync/:date`) must mirror the
clients' `isEmptyOverPopulated` guard: an all-default ("blank") incoming run
value must NEVER overwrite a populated stored one — even with a strictly-newer
stamp.

**Why:** Per-run values are a stamp-keyed LWW register, and the original server
rule was "strictly-newer stamp wins," assuming the empty-value corruption always
arrived with an EQUAL stamp. But the system creates **populated-yet-UNSTAMPED**
stored values — daily-rollover adopt and Excel/photo imports call `saveRunValues`
WITHOUT `markRunValuesUpdated`, so the stored stamp is 0 (seen in production: a
`daily_sync` row with populated `runValues` but empty `runValuesUpdatedAt`). A
stale-but-positive client stamp then beats stored stamp 0, so a blank value wins
and wipes real data, re-infecting every peer on next read — the recurring
"I entered it, refreshed, it vanished" loss. The client stamp map
(`RUN_VALUES_UPDATED_KEY`) is also never cleared, so a stale positive stamp can
outlive its value and become the same clobber vector.

**How to apply:**
- Guard lives in the strictly-newer branch: keep stored value when
  `exHas && isBlankRunValue(incoming) && !isBlankRunValue(stored)`.
- **Advance the kept value's stamp to the incoming (corrupt) stamp.** Keeping the
  old stamp is NOT enough: the corrupted client's stale positive stamp would
  out-rank the server's value on receive (`lTs > rTs` keeps local blank) and it
  would stay stuck showing blank. Advancing makes the surviving value strictly
  win on every peer and heals the offending client on its next read.
- Emptiness = EXACT `deepEqual` to a `BLANK_RUN_VALUE` copy of web
  `DEFAULT_VALUES`. This fails safe: drift (a field added to the clients' default
  but not the server copy) only DEGRADES protection (unrecognized blank → status
  quo), it can never false-positive and reject a real edit (a real edit is never
  deep-equal to the blank). So a hardcoded copy is acceptable.
- Don't block brand-new blank runs (no stored value) and don't touch the daily
  reset escape hatch (`resetAt` strictly newer with `exReset>0` returns incoming
  wholesale before the per-run loop).
- Server-only fix; protects web AND mobile because both push through `/api/sync`.
  Clients keep their own push+receive guards as defense-in-depth; the server is
  the mandatory last line.
