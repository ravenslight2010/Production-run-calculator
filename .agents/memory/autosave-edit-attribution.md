---
name: Autosave edit attribution (web)
description: Web autosave must only stamp/push a run edit when form values actually changed vs stored, or multi-device sync clobbers real data.
---

# Web autosave edit attribution

The web per-run autosave effect (`home.tsx`, the `[v]` effect on `const v = form.watch()`) must treat a form change as a real edit — `saveRunValues` + `markRunValuesUpdated` + `lastLocalEditRef` + `schedulePush` + `flashSaved` — **only when `v` differs from `loadRunValues(runId)`** (structural `deepEqual` in `storage.ts`). If equal, return early.

**Why:** `form.watch()` re-fires on every programmatic `form.reset(...)` too — run switch, sync-apply (`form.reset(merged)`), daily rollover, post-login load. Stamping those non-edits with a fresh `markRunValuesUpdated(now)` re-times already-stored values as a brand-new local edit. With the app open on 2+ devices/tabs this creates a ping-pong: each device re-stamps loaded/stale/empty values, which then win the per-run lost-update guard in `/api/sync` and overwrite the peer's genuine edit. Symptom users hit: "I enter cases needed / setup data and it vanishes" in production (recurred 4×; was NOT the earlier server-cache fix).

**How to apply:** Keep the `deepEqual(loadRunValues(runId), v)` early-return at the top of that effect. The form is initialized from `loadRunValues(currentRunId)` so `v` starts correct (guard is safe at mount). Genuine writes (typing, fill-missing/voice/AI `setValue`, apply-profile, copy-run) differ from stored → still stamped/pushed. Pure loads/switches/sync echoes equal stored → skipped. Non-form pushes (run metadata, list changes, periodic/stale-repush) go through their own `schedulePush` and are unaffected.

**Parity:** mobile uses `diffStampRunEdits` (`context/sync/mapping.ts`) — stamps only when a value differs from a primed baseline.

`deepEqual` semantics: objects key-order-insensitive, arrays compared by index (recipe-row order is meaningful).

## The deepEqual guard alone is NOT enough — empty-over-populated still clobbers

The `deepEqual(loadRunValues(runId), v)` guard compares the live form against **localStorage**, which is the **wrong baseline**: a programmatic `form.reset(DEFAULT_VALUES)` (or a mount/init resolving the current run id to `""`) can leave the form transiently **empty while localStorage still holds the real values**. Then `v` (empty) ≠ stored (populated) → the guard does NOT skip → it saves+stamps the empty form with a **fresh** `markRunValuesUpdated(now)`, and that newest-stamped empty **wins** the per-run lost-update guard across every connected tab/device. This is a SHARED `daily_sync` row (one per (date,scope), no user_id), so the empty propagates to everyone.

**Confirmed in prod (5th data-loss report):** refresh fired a burst of initial GETs, the client minted an empty stamp ~0.5s before them, then `PUT /api/sync/today` wrote the empty `runValues` (exactly `DEFAULT_VALUES`) over a populated run on the shared row. Six concurrent `/api/sync/events` SSE = heavy multi-tab, so one bad client poisons all.

**Fix (the durable rule):** in the `[v]` effect, after the deepEqual early-return, add a SECOND semantic guard — **never save+stamp when `deepEqual(v, DEFAULT_VALUES) && !deepEqual(loadRunValues(runId), DEFAULT_VALUES)`.** A genuine user edit never reduces *every* field to its default at once; an all-default form is always a programmatic reset. Net effect: **web never stamps an all-DEFAULT form** (if stored==DEFAULT the first guard skips; if stored!=DEFAULT this guard skips). Cost: you can't reduce a run to *exactly* all-defaults via autosave (a meaningless run; identity lives in dayState), which is overwhelmingly worth it vs. catastrophic loss.

**Mobile parity:** `diffStampRunEdits` gained an optional `emptyValString` param and **never stamps a run whose serialized value equals the empty/default** (`s === emptyValString`). Caller passes `stableStringify(runToFormValues(makeNewRun()))` (runToFormValues ignores the id, so deterministic). Mirrors web's "never stamp an all-DEFAULT value".

Tests: `artifacts/run-calculator/src/runValuesEqual.test.ts` locks the predicate `deepEqual(v, DEFAULT) && !deepEqual(stored, DEFAULT)`. Do NOT regress either guard.

## The autosave guards still aren't enough — guard the PUSH BOUNDARY too

The two `[v]`-effect guards only cover the **autosave write path**. The sync **push payload** is built separately, and for the CURRENT run it reads the value from the **live form** (`form.getValues()`) while reading the edit-stamp map (`runValuesUpdatedAt`) **independently from localStorage**. During mount/hydration and right after ANY programmatic `form.reset()`, the form is transiently all-default while localStorage still holds the real value **and its real stamp**. ANY push firing in that window — periodic 30s push, SSE-reconnect re-push, or a `schedulePush` triggered by unrelated state — emits `runValues[curId]=DEFAULT` paired with the run's REAL stamp. Equal stamps → every peer's per-run lost-update guard ACCEPTS the empty value → real data wiped. The autosave guards never run for these paths.

**Confirmed in prod (6th report):** today's row had a run with intact identity (Costco/THREE MEAT, identity lives on the run object and is pushed as-is) but `runValues` reset to EXACTLY `DEFAULT_VALUES`, while `runValuesUpdatedAt` still carried a real stamp. Value/stamp decoupling, exactly as above.

**Fix (durable rule):** never let an all-default LIVE form overwrite a populated STORED value at the push boundary either. The current-run value in `buildSyncPayload` goes through the pure `pickCurrentRunPushValue(live, stored)` (storage.ts): returns `stored` when `deepEqual(live, DEFAULT) && !deepEqual(stored, DEFAULT)`, else `live`. Self-heals from durable localStorage and covers EVERY push path, not just direct edits. Test: `artifacts/run-calculator/src/pickCurrentRunPushValue.test.ts`.

**Why mobile needs no equivalent:** mobile builds both `runValues` and stamps from the SAME `state.runs` object (no separate transiently-empty form), and `diffStampRunEdits` already refuses to stamp all-default runs. The value/stamp decoupling is a web-only react-hook-form hydration artifact.

**General principle:** the `/api/sync` server is a dumb last-writer-wins blob store; ALL protection is client-side. A guard on the write path is insufficient if a separate code path can still PUSH the unprotected value — protect at the payload-construction boundary so it's path-independent.
