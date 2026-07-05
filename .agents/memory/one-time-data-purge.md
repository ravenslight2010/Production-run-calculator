---
name: Data reset (factory-wide)
description: How the server-driven data reset clears daily_sync and neutralizes populated clients without the additive sync union resurrecting old data. Replaces the old marker-wipe recipe.
---

# Data reset (server-driven, per-scope epoch)

A DB truncate alone is NOT enough: every device keeps a full local copy (web
localStorage `run-calc*`, mobile AsyncStorage `run-calc*`) and the additive
`/api/sync` union re-uploads it, resurrecting everything. The reset must clear
the server AND neutralize every populated client in the same motion, and it must
not race the live sync loop (a stale client re-seeding the just-cleared row).

## The mechanism (current)

A per-scope reset **epoch** integer in the `data_reset` table (scope PK, `epoch`
default 0, `resetAt`) is the single source of truth.

- **Trigger:** `POST /api/sync/reset` (`requireCapability("manage-staff")`). In one
  tx it deletes all `daily_sync` rows for the scope, bumps the epoch, and
  broadcasts a `{ reset: true, resetEpoch }` SSE frame to that scope's clients.
  There is no code change, no marker bump, no manual API-down/truncate.
- **Live clients** honour the SSE reset frame: wipe local `run-calc*` storage
  (except the epoch marker), record the new epoch, and reload (web) / reset
  in-memory state (mobile). This is what stops the racing re-upload.
- **Offline-during-reset clients** catch up on next connect: they `GET
  /api/sync/reset-epoch`; if the server epoch is newer than the one they've
  honoured, they run the same wipe before pulling today's row.
- **The race is closed server-side too:** every `PUT /api/sync/*` today route
  carries `&epoch=<honoured>`; the server rejects the write (`{ok:false,stale}`)
  when the client's epoch is behind, so a stale client physically cannot re-seed
  the freshly-cleared row in the window before it processes the reset. A missing
  `epoch` param is treated as not-stale (older clients / scheduled PUTs bypass).

**Ops fallback when you can't call the manager-only endpoint** (no manager
session token handy): do what `POST /sync/reset` does, via SQL — in one tx
`upsert data_reset(scope) set epoch = epoch + 1` and `DELETE FROM daily_sync`
(scope 'live'), keeping `users`/`roles`/`user_roles`. Then have each open client
reload once: on boot it `GET`s `reset-epoch`, sees the higher epoch, wipes, and
re-pulls the now-empty row. The SQL path skips the SSE broadcast, so already-open
tabs won't wipe until they reload — but the PUT epoch guard means their stale
pushes are rejected in the meantime, so they cannot re-seed the cleared row.
Verify by watching `daily_sync` stay empty for ~20s before asking for the reload
(if it repopulates, an *old-code* tab with no `?epoch=` param is bypassing the
guard — get it reloaded onto current code first).

**Why an epoch (not a marker constant):** the marker was a client-side constant
that had to be hand-bumped and shipped for every purge, and it raced the sync
loop (a tab that wiped while the server row was still populated re-adopted the
data, then never wiped again because the marker was now set). A server-owned
monotonic epoch makes the reset a one-click runtime action that every client
converges on exactly once, with the PUT guard as the hard backstop.

## Key names / shapes

- Epoch marker key: web `run-calc-reset-epoch` (localStorage), mobile
  `run-calc-mobile-reset-epoch` (AsyncStorage). Excluded from the wipe.
- SSE reset frame: `{ reset: true, resetEpoch }` (distinct from the normal
  `{ data, senderId }` envelope — clients branch on `reset` first).
- Client helpers: web `getStoredResetEpoch()` / `applyResetWipe(serverEpoch)` in
  `storage.ts` (fail-safe, returns whether it wiped); mobile equivalents live in
  `context/RunContext.tsx` (`getStoredResetEpoch`, in-effect `applyServerReset`)
  and `context/sync/client.ts` (`fetchResetEpoch`, `putToday` epoch param,
  `onReset` stream handler). Web+mobile parity.

## Historical context (retired 2026-07-03/04)

The purge originally used a marker-guarded local wipe (`applyOneTimeLocalWipeIfNeeded`
+ a `run-calc*-local-wipe-YYYYMMDDx` constant) plus manual steps: stop API,
TRUNCATE all tables except `users`/`roles`/`user_roles`, bump the marker suffix,
restart. It took several rounds because factory seed blobs re-installed like a
fresh install and because a LIVE tab re-adopted the still-populated synced
master-data after its wipe. Those seed **application** helpers (spec/mix/dough/
sauce/cheese) and the wipe marker are now removed; the seed **data** files
(`specSeed.ts` etc.) stay because `fillMissing` still reads `SPEC_PROFILES`.

Auth is never touched by a reset (web httpOnly cookie, mobile bearer token);
`users`/`roles`/`user_roles` are global-scope tables and are not in `daily_sync`.
