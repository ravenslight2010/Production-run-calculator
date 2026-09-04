---
name: sync-invariant-check
description: >
  Pre-ship checklist for sync-related code changes. Trigger when an agent
  modifies routes/sync.ts, storage.ts, home.tsx sync handlers, day-state
  shape, SSE handlers, stamp logic, reset/epoch logic, or the protectRunValues
  merge. Trigger it too for awake/sleeping-device handoffs, foreground wake
  reconciliation, stale writes, reset epochs, or live counter synchronization.
  Each invariant below traces back to a real production incident.
---

# Sync Invariant Check

Read this skill before shipping any change to:
- `artifacts/api-server/src/routes/sync.ts`
- `artifacts/api-server/src/lib/protectRunValues.ts`
- `artifacts/run-calculator/src/storage.ts` (sync-receive helpers, stamp maps)
- `artifacts/run-calculator/src/pages/home.tsx` (SSE apply callback, push logic, `buildSyncPayload`, `applySyncCallbackRef`)
- the current web sync handlers and shared storage helpers listed above; any
  separately maintained native sync client must be inspected from its current
  checkout rather than an archived repository path
- Any file that adds a field to `SyncPayload`, `RunMeta`, or `FormValues`/`DEFAULT_VALUES`
- Foreground/focus/visibility/online wake handling or any code that releases
  auto-track after a sleeping-device reconciliation
- Automatic case, Sauce, or Frontline applicator claim coordination, canonical
  claim responses, retry identity, or per-run coordination registers

## Boundary with state-accuracy checks

Use this skill for sync transport, persistence, LWW stamps, reset epochs,
SSE/day-state merge, and sleeping-device adoption. Use
`state-accuracy-check` for timer/counter math, auto-track bookkeeping,
pause/resume, and the first post-wake counter tick. Read both when a wake
handoff crosses those boundaries; do not duplicate timing formulas here.

Out of scope: inventory SSE stream (separate invariants).

---

## Quick-reference: what you changed → which invariants apply

| Changed area | Must check |
|---|---|
| `PUT /sync/today` or `PUT /sync/:date` handler | §1 (stamps), §4 (body limit), §5 (epoch/reset), §6 (empty-over-populated) |
| `GET /sync/today`, `GET /sync/scheduled`, `DELETE /sync/:date` | §3 (`?today=` date scoping) |
| `GET /sync/events` (SSE) | §2 (SSE stamp source), §3 (date scoping for watchDate) |
| `protectRunValues` / `upsertProtected` | §1 (LWW stamps), §5 (reset escape hatch), §6 (empty-over-populated) |
| `buildSyncPayload` / outgoing push | §1 (overlayRunMetaStamps before push), §2 (SSE stamp source), §5 (epoch param) |
| `applySyncCallbackRef` (SSE receive on web) | §1 (LWW stamps), §2 (SSE stamp source), §6 (rejectedStale re-push) |
| Adding a field to `DEFAULT_VALUES` / `FormValues` | §6 (BLANK_RUN_VALUE copies in protectRunValues.ts must be updated) |
| Reset / rollover / `POST /sync/reset` | §5 (epoch guard fail-closed), §6 (reset-path blank guard) |
| Any new sync write path (web or mobile) | §3 (`?today=` threading), §4 (body budget), §5 (epoch param + stale handling) |
| Foreground wake / focus / visibility / online recovery | §7 (adopt-before-publish barrier), plus State Accuracy §5 |
| Automatic Sauce/applicator claims or acknowledgements | §8 (per-run claim ownership), plus State Accuracy §5 |

---

## §1 — Run-meta LWW stamps (client + server)

**Source:** `.agents/memory/run-meta-lww.md`

**What to verify:**

1. **Stamping is centralized, not scattered.** On web, `saveDayState` diff-stamps `metaUpdatedAt` (lifecycle fields only). Sync-receive calls pass `{stampMeta:false}` so adopted remote runs keep the peer's stamp. On mobile, `updateCurrentRun` stamps lifecycle changes; any new mutation path that bypasses it (e.g. `updateRunMeta`, `startRun`'s direct setState) must self-stamp.

2. **Strictly-newer-wins at all three merge points:**
   - Web receive (`applySyncCallbackRef` in `home.tsx`)
   - Mobile receive (`context/sync/`)
   - Server run-list union (`protectRunValues.ts` — the `metaStampOf` comparison at the `runById` map loop)
   Tie or absent stamps fall back to incoming-wins (legacy behavior). Equal stamps must NOT overwrite.

3. **Settings/progress fields must NOT bump `metaUpdatedAt`.** Those converge via the separate per-run VALUE stamps. Mixing them lets an idle value edit shadow a peer's genuine Start/End.

4. **Per-run VALUE stamps (`runValuesUpdatedAt`):** Any web write path that mutates run values outside the normal form flow (e.g. `applyCaseUpdateChoices`, re-import accept dialog) must call `markRunValuesUpdated` + set `lastLocalEditRef` before `schedulePush`. The lint-style AST guard (`runValueStampGuard.test.ts` in the web artifact) enforces this — run it.

5. **`rejectedStale` re-push:** When a receive path keeps a local run (newer local stamp), it must set the `rejectedStale` flag (computed OUTSIDE the React updater on web) so the server and peers eventually converge on the newer copy.

**Failure mode if violated:** Pressing Start/Pause/End then having a stale sync echo arrive reverts the run lifecycle ("I started it, it went back to unstarted").

---

## §2 — SSE stamp source: must use `overlayRunMetaStamps`, NOT raw React state

**Source:** `.agents/memory/sse-meta-stamp-source.md`

**What to verify:**

In `home.tsx` — inside `applySyncCallbackRef.current` (the SSE functional updater) and in the `rejectedStale` pre-check — the local run list must be wrapped with `overlayRunMetaStamps(prev.runs)` or `overlayRunMetaStamps(dayStateRef.current.runs)`, never compared against raw React state runs.

**Why this is non-obvious:** `saveDayState()` writes fresh `metaUpdatedAt` stamps to localStorage. But `startRun()`, `pauseRun()`, etc. spread from React state (`{ ...r, startedAt: now }`), so `newDs.runs[i].metaUpdatedAt` is the stale React value — NOT the localStorage value. `overlayRunMetaStamps` takes the MAX of React state and localStorage, so it always sees the freshest stamp.

**Both call sites in `applySyncCallbackRef`:**
- The per-run LWW comparison (which copy wins)
- The `rejectedStale` pre-check (whether to force a re-push)

**Failure mode if violated:** A "trick push" (e.g. schedule-editor save for today) carries a newer `metaUpdatedAt`. User then presses Start. `saveDayState` writes `T_start` to localStorage but React state still holds the old stamp. SSE echo arrives; stale React stamp < trick stamp → remote wins → `startedAt` is erased.

---

## §3 — `?today=` client date scoping (not server UTC)

**Source:** `.agents/memory/scheduled-day-client-date.md`

**What to verify:**

1. **Every server endpoint that filters by date** uses `clientToday(req)` (defined in `sync.ts`), NOT `todayStr()` (server UTC). Applies to:
   - `GET /sync/today` — row lookup
   - `PUT /sync/today` — row upsert + `isCurrentDay` flag for `applyResetBoundary`
   - `GET /sync/events` — initial-row select AND `SseClient.watchDate`
   - `GET /sync/scheduled` — `gt(date, clientToday(req))` filter
   - `DELETE /sync/:date` — past-day guard
   - `PUT /sync/:date` — same-day broadcast condition

2. **`broadcast()` is date-scoped** — only delivers to `scope + watchDate` matches. Never fan out to all same-scope clients regardless of their watch date. Verify the `client.watchDate === date` check in the `broadcast()` function is intact.

3. **Every CLIENT caller threads `?today=${todayStr()}`** on ALL sync URLs:
   - Web: `home.tsx` — `fetchToday`, `putToday`, `openSyncStream`, `commitMultiDayImport`, `commitExcelImport`, and schedule move/delete calls
   - Mobile: `context/sync/client.ts` — `fetchToday`, `putToday`, `openSyncStream`
   - SSE uses `&today=` (appended to query string, not replacing it)

4. **A client that writes today's row must also self-apply today locally.** After a successful PUT of today, call `applySyncCallbackRef.current(outPayload)` directly — never rely on the SSE self-echo as the only delivery path.

**Failure mode if violated:** A user behind UTC (US evening) has their local "tomorrow" equal the server's UTC "today". Server-side date filtering drops scheduled days a day early; live writes clobber a different calendar row; SSE delivers another day's state into the live view.

---

## §4 — Body size limit (10 MB, not Express default 100 KB)

**Source:** `.agents/memory/sync-body-limit.md`

**What to verify:**

The Express server (`artifacts/api-server`) must set `express.json` and `express.urlencoded` limits to `10mb`. The default is ~100 KB.

**Why 10 MB:** day-state sync payloads embed full per-run recipe `FormValues` for every run. Real-world multi-run days exceed 100 KB. The default limit returns `413 PayloadTooLargeError` on every write — silently breaking both live sync AND scheduled-day saves. The client saw it as a crash.

**Risk of raising further:** every new per-run field added to `FormValues` grows the payload. If 413s reappear, trim non-essential synced fields first rather than raising the limit again. The per-run recipe embed (dough/cheese/frontline recipe rows) is the main growth driver.

**Where to check:** look for the `express.json({ limit: "10mb" })` call in the API server entry point (`artifacts/api-server/src/index.ts` or equivalent app setup).

**Failure mode if violated:** All sync writes fail with 413; devices appear to sync (no UI error shown to the user) but nothing persists; scheduled-day saves silently vanish.

---

## §5 — Epoch/reset scoping (fail-closed guard)

**Source:** `.agents/memory/sync-reset-boundary-hardening.md`

**What to verify:**

1. **`isStaleResetPush` fails CLOSED once a scope has ever been reset.**
   - If `serverEpoch > 0` (scope has ever been reset), a missing or malformed `?epoch=` param is treated as stale. The gate must NOT treat absence as "no opinion / accept."
   - Only scopes that have NEVER been reset (`serverEpoch === 0`) may accept epoch-less pushes (backward compat for older clients).

2. **Every client sync write carries `epoch=` and handles `{ok, stale: true}`.**
   - Clients read the stored epoch with `getStoredResetEpoch()` and append `?epoch=${...}` to every PUT.
   - Response parsing: `res.ok` alone is NOT sufficient. A 200 with `{ok:true, stale:true}` means the write was dropped. Every sync write path must parse the body and route through `handleStaleSyncWrite` (adopt reset via `applyResetWipe` + reload).
   - Mobile does not yet send epoch — flag this if mobile sync is being changed.

3. **`resetBoundaryAt` is derived server-side, never trusted from the client.**
   In `applyResetBoundary()`: clamp to `min(resetAt, Date.now() + MAX_RESET_AT_SKEW_MS)` (currently 5 min), NOT a hard clamp to exactly `Date.now()`. The 5-minute allowance preserves genuine same-day rollovers that intentionally nudge `resetAt` a beat past a token's second-truncated `iat`.

4. **`resetAt` vs `resetBoundaryAt` are distinct:**
   - `resetAt`: keyed to the client's local calendar; can be set on future-day writes (purely to trigger additive merge). Must NEVER be used as the session fence.
   - `resetBoundaryAt`: set ONLY when target date === `clientToday(req)` (same-day write). This is the session fence in `requireAuth`.

5. **Verify both integration test files still pass** after any reset/epoch/boundary change:
   - `syncReset.integration.test.ts`
   - `sessionBoundary.integration.test.ts`

**Failure mode if violated:** After a manager wipes data via `POST /sync/reset`, open tabs with stale pre-reset data silently re-upload it (epoch guard bypassed). Or, a crafted client payload with a far-future `resetAt` permanently fences all sessions out of the live deployment.

---

## §6 — Empty-over-populated guard (both additive and reset paths)

**Source:** `.agents/memory/server-empty-over-populated-guard.md`

**What to verify:**

1. **The guard lives in `protectRunValues.ts` and applies in the ADDITIVE path (same-day editing):**
   In the strictly-newer-stamp branch (`inStamp > exStamp`), before accepting the incoming value: if `exHas && isBlankRunValue(inVals[id]) && !isBlankRunValue(exVals[id])`, keep the stored value and advance its stamp to `Math.max(inStamp, exStamp, Date.now())`.

2. **The same blank guard also applies in the RESET/ROLLOVER path (wholesale adopt):**
   When `exReset > 0 && inReset > exReset`, the per-run loop must still check `isBlankRunValue(inVals[id]) && !isBlankRunValue(exVals[id])` before clobbering stored values. A rollover push fetching a stale scheduled row can arrive with all-default values while another device already entered real data today.

3. **`isBlankRunValue` recognizes THREE blank shapes:**
   - `LEGACY_BLANK_RUN_VALUE` (old field set, pep batch lbs defaulted to 25)
   - `CURRENT_BLANK_RUN_VALUE` (today's `DEFAULT_VALUES`, all-zero quantities)
   - Current shape with machine-time fields at 0 (normalized to defaults before comparison)
   - Current shape carrying the exact all-four-pep-at-25 legacy signature
   Any new field added to `DEFAULT_VALUES` must be added to `CURRENT_BLANK_RUN_VALUE` in `protectRunValues.ts`. The guard fails safe (unrecognized blank → status quo, not false positive), but missing entries degrade protection.

4. **Stamp advancement is mandatory when the guard fires.** Keeping the stored value WITHOUT advancing its stamp is insufficient: the corrupted client's stale positive stamp would out-rank the stored value on receive (`lTs > rTs` keeps the local blank) and it stays stuck showing blank. Advancing to `Date.now()` makes the surviving value strictly win on every peer.

5. **Client-side defense-in-depth (web `storage.ts` / mobile):**
   The client `acceptRemoteRunValueOnSync` helper in `storage.ts` mirrors this guard on receive — a blank remote value must not overwrite a populated local one. Verify it still applies when `home.tsx`'s sync-receive path calls it.

**Failure mode if violated:** "I entered the run setup, refreshed, it vanished." The all-default form (transiently blank during mount or `form.reset()`) is pushed with the run's real edit stamp; blank-over-populated wipes the stored value and re-infects every peer on next read.

---

## §7 — Sleeping-device wake handoff (adopt before publish)

**Source:** `sync.integration.test.ts` and `foregroundSyncWakeGuard.test.ts`.

When a device has been asleep, backgrounded, offline, or otherwise missed
updates, its first foreground recovery is a reconciliation barrier:

1. Pull the client-date live row with `cache: "no-store"` and the correct
   `?today=` value. Do not publish the device's stale local snapshot first.
2. Keep queued pushes and lifecycle actions behind the barrier. A waking device
   must adopt the newer server/canonical response through the established
   inbound merge, persist newer lifecycle state, update the local day-state
   ref, and only then release auto-track and normal writes.
3. A failed pull is not reconciliation. Keep the barrier/retry state correct;
   do not mark the device reconciled or silently release stale writes.
4. Coalesce focus, visibility, and online wake events so concurrent recovery
   pulls do not create competing writes.
5. After adoption, the next counter tick must rebase from the adopted values.
   It must not apply hidden-time elapsed deltas, replay a stale lifecycle, or
   overwrite a manual correction. A successful sync PUT must self-apply the
   server's canonical `{ok:true,data}` response; a `{ok:true,stale:true}`
   reset response must go through the epoch-stale handler and must not apply
   its data.
6. The server-side handoff contract is canonical convergence: if the sleeping
   device submits its pre-sleep snapshot, return the newer merged state; its
   repeat write after adoption is idempotent. A transient blank wake payload
   must preserve populated values, advance protection stamps, and record the
   conflict rather than erase live setup/progress.

**Exact regression scenarios:**

- API: awake device advances setup, skid progress/manual correction, and run
  lifecycle while device B sleeps; B's stale wake push receives the canonical
  newer lifecycle, run values, and packaging progress; B adopts and repeats
  the write without a hidden-time counter delta; a blank wake payload remains
  protected and produces a conflict record.
- Foreground wiring: wake pulls the date-scoped row, routes it through the
  existing inbound merge, reconciles profiles/factory data only after the live
  row lands, fences Start/Pause/Resume/End until adoption completes, retries
  failed pulls, and releases auto-track only after counter rebase.
- Write response: successful writes immediately self-apply canonical data;
  reset-stale responses invoke stale handling and never apply data; failed or
  invalidated responses apply nothing.
- Live counter receive: `casesOnCurrentSkid` is normalized to a rounded
  integer, including missing/null/NaN input, before it reaches the display.
- Blank shape: `CURRENT_BLANK_RUN_VALUE` stays aligned with `DEFAULT_VALUES`.

**Safe merge vs. heal/investigation:**

- Safe merge behavior: newer server state is adopted before the retry, the
  repeat write is idempotent, LWW/blank guards preserve populated values, and
  counters rebase once without a jump. Fix the sync path and add/keep the
  focused regression test when any of these contracts is missing.
- Data-heal or production investigation: stored production values are already
  wrong, a stale wake was accepted and propagated to peers, reset-epoch data
  was resurrected, canonical adoption still diverges after a retry, or
  conflicts persist beyond the expected transient race. Do not hide these with
  a client merge; inspect production history and use the data-heal playbook
  when persisted data was poisoned.

This section covers the sync barrier and convergence. Use
`state-accuracy-check` for timer/counter math, auto-track bookkeeping,
pause/resume, and the first post-wake tick; do not duplicate those formulas
here.

---

## §8 — Per-run automatic claim ownership

Automatic tracking claims are scoped by run ID, channel, lifecycle generation,
sequence, event ID, and the claimed run's value stamp.

1. The server reads mutations, correction generations, recipes, and inventory
   instructions only from `runValues[claim.runId]`. It updates only that run's
   value stamp and `autoTrackCoordination.runs[claim.runId][channel]`.
2. Validate lifecycle against the canonical run metadata. Pending, paused, and
   ended runs cannot emit Sauce/applicator claims; the case channel's bounded
   Packaging drain policy does not extend to them.
3. A response is canonical. The client applies returned values and the returned
   sequence/next-due state, never the optimistic claim payload. A conflict is a
   retry from newly adopted canonical values; an identical accepted retry is
   duplicate/idempotent.
4. Capture run identity when dispatching. If selection or lifecycle generation
   changes before resolution, the old `then`, `catch`, and `finally` paths must
   not write the shared form, advance refs, schedule a retry, or clear a new
   run's same-channel pending marker.
5. Two-run tests must keep the non-claiming run's values, value stamp, and
   coordination register byte-for-byte unchanged. Include a stale claim after a
   lifecycle/selection generation change for both Sauce and an applicator.

Use `state-accuracy-check` for cadence, caps, pause/rebase math, and pending
counter policy. This section owns transport identity and canonical convergence.

---

## Focused validation

Run the exact handoff regression set after sync or wake changes:

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/lib/autoTrackCoordination.test.ts src/routes/sync.integration.test.ts \
  src/routes/syncReset.integration.test.ts
pnpm --filter @workspace/run-calculator exec vitest run \
  src/foregroundSyncWakeGuard.test.ts src/syncReceiveCasesOnSkid.test.ts \
  src/syncWriteResponse.test.ts src/blankRunValueSync.test.ts \
  src/hooks/__tests__/useAutoTrack.applicators.test.tsx
```

If a test needs a broader change, run the corresponding package's full
`test` script as well. Do not call a wake path validated merely because the
HTTP request returned 200: inspect whether its body was canonical or
`stale:true`, and whether the client adopted it.

---

## Checklist summary (copy-paste for PR review)

```
Sync invariant check:
[ ] §1 LWW stamps: metaUpdatedAt strictly-newer-wins at all 3 merge points; settings/progress don't bump it; rejectedStale re-push set on receive
[ ] §2 SSE stamp source: overlayRunMetaStamps() used in applySyncCallbackRef, NOT raw React state runs
[ ] §3 ?today= threading: clientToday(req) on all server date filters; ?today= on all client callers; broadcast() is date+scope scoped; self-apply after writing today
[ ] §4 Body limit: express.json limit is "10mb" (not 100kb default)
[ ] §5 Epoch/reset: isStaleResetPush fails closed when serverEpoch>0; client sends ?epoch= and parses stale body; resetBoundaryAt clamped server-side with 5min skew; integration tests pass
[ ] §6 Empty-over-populated: blank guard in additive path AND reset path; stamp advanced to Date.now() when guard fires; CURRENT_BLANK_RUN_VALUE updated if DEFAULT_VALUES changed
[ ] §7 Wake handoff: pull/adopt canonical client-date state before publishing or releasing lifecycle/auto-track work; failed pulls stay unreconciled; canonical retry is idempotent; reset-stale data is not applied; post-wake counters rebase without hidden-time delta
[ ] §8 Auto-track claims: run-scoped values/stamps/registers; canonical response adoption; idempotent retry; stale run acknowledgements cannot contaminate the selected run
```
