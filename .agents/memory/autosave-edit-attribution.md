---
name: Autosave edit attribution + shared day-state data-loss guards
description: How web/mobile/server stop an empty/all-default run value from clobbering a populated one on the SHARED daily_sync row. Four co-designed layers; do not regress any.
---

# Shared day-state data loss: the empty-over-populated clobber

`daily_sync` is ONE row per `(date, scope)` (no user_id) shared by every device/tab. The recurring production symptom is "I enter cases needed / setup data, refresh, and it's gone" — an empty/all-default `runValues[id]` overwrites a populated stored value across all peers. The root cause is always the same shape: **an all-default run value gets paired with the run's REAL (often EQUAL) edit stamp**, and some merge accepts it.

The invariant, enforced at four boundaries: **never let an all-default run value overwrite a populated one.** The shared predicate is `isEmptyOverPopulated(candidate, fallback)` (`storage.ts`) = `deepEqual(candidate, DEFAULT) && !deepEqual(fallback, DEFAULT)`. A genuine user edit never reduces *every* field to its default at once, so an all-default value is always a programmatic reset/hydration artifact, never a real edit.

## Layer 1 — autosave write path (web `[v]` effect in home.tsx)

The per-run autosave effect on `const v = form.watch()` must `saveRunValues`+`markRunValuesUpdated`+`schedulePush` **only when `v` differs from `loadRunValues(runId)`** (structural `deepEqual`, key-order-insensitive objects, index-wise arrays since recipe-row order matters), AND must additionally skip when `isEmptyOverPopulated(v, loadRunValues(runId))`.

**Why:** `form.watch()` re-fires on every programmatic `form.reset(...)` (run switch, sync-apply, daily rollover, post-login load). Stamping those non-edits re-times stored values as a fresh local edit; with 2+ devices open this ping-pongs and the newest-stamped (often empty) value wins. The deepEqual guard alone is insufficient because a `form.reset(DEFAULT)` or unresolved run id leaves the form transiently empty while localStorage still holds real values → empty ≠ stored → guard passes → empty gets stamped fresh and wins.

**Parity:** mobile `diffStampRunEdits` (`context/sync/mapping.ts`) stamps only when a value differs from a primed baseline AND never stamps a run whose serialized value equals the empty/default (`emptyValString` param = `stableStringify(runToFormValues(makeNewRun()))`; runToFormValues ignores id → deterministic). Mobile builds values and stamps from the same `state.runs` object, so it has no web-style transiently-empty-form artifact.

## Layer 2 — push boundary (web `pickCurrentRunPushValue`)

The sync push payload is built separately from autosave and, for the CURRENT run, reads the value from the LIVE form while reading its stamp independently from localStorage. During mount/hydration or right after any `form.reset()`, the form is transiently all-default while localStorage holds the real value AND its real stamp — so any push in that window (periodic 30s, SSE-reconnect re-push, unrelated `schedulePush`) emits `DEFAULT` paired with the REAL stamp; equal stamps → peers accept → data wiped.

**Fix:** the current-run value in `buildSyncPayload` goes through pure `pickCurrentRunPushValue(live, stored)` (storage.ts) = returns `stored` when `isEmptyOverPopulated(live, stored)`, else `live`. Self-heals from durable localStorage, path-independent.

**General principle:** a guard on the write path is insufficient if a separate path can still PUSH the unprotected value. Protect at the payload-construction boundary too.

## Layers 3 & 4 — RECEIVE merge + SERVER (it's bidirectional)

Push guards only stop a healthy device from EMITTING an empty value. Once a corrupted row already exists on the server (written before guards shipped, or by a stale client), it flows back IN on every SSE reconnect/refresh: the web receive merge falls through `lTs > rTs` (false on EQUAL stamp) and saves the empty value over good localStorage.

- **Web receive merge** (home.tsx run-values loop) + **form.reset guard**: reject an incoming all-default value while local stored is populated (`isEmptyOverPopulated`); on rejection set `rejectedStale=true` AND **bump that run's stamp to `Date.now()`**.
- **Mobile receive** (`applyPayloadToState` mapped-remote loop): same guard via `isEmptyFormValue(payload.runValues[id])` vs `runToFormValues(prevRun)`; keep `prevRun`, set `rejectedStale=true`, `mergedUpdatedAt[id]=Date.now()`. Uses a local `deepEqual` + `EMPTY_FORM_VALUES` in mapping.ts.
- **Server** (`protectRunValues.ts`): per-run register merge — accept an incoming run value ONLY when present AND its stamp is **strictly newer** than stored; equal/older/omitted keep stored value+stamp. Only `runValues`/`runValuesUpdatedAt` are protected; all other fields pass through (clients additively reconcile). Broadcast the MERGED result, not the raw push.

**Server merge MUST be atomic.** The read of the existing row and the write must be one `db.transaction` with `SELECT ... FOR UPDATE` on the `(date, scope)` row (helper `upsertProtected` in sync.ts, used by BOTH PUT `/sync/today` and `/sync/:date`). A non-atomic read-before-write lets two concurrent PUTs merge against a stale snapshot and the later commit overwrite a newer stamp with an older one — reopening the loss window. First-write on a brand-new row has no lock (nothing to protect yet) — acceptable.

**Why the stamp BUMP on receive-rejection is mandatory:** the corrupted server row carries the run's REAL stamp `T`. A heal re-push at the same `T` ties, and the server's strict-newer rule keeps the corrupted existing value → heal blocked. Bumping the local stamp to `Date.now()` (> `T`) makes the re-push strictly win. The server strict-newer rule and the client bump are co-designed — never change one without the other.

**Recovery limit:** if localStorage was already overwritten to empty before these guards shipped, the value is gone everywhere (DB empty + local empty); guards stop future loss but can't resurrect it. Saved brand profiles may hold older copies for some runs, not all.

Tests (do NOT regress): `protectRunValues.test.ts` (server, pure/DB-free, incl. concurrency race), `pickCurrentRunPushValue.test.ts` (also locks `isEmptyOverPopulated`), `runValuesEqual.test.ts`, and the per-run protective-merge cases in `sync.integration.test.ts`.
