---
name: Autosave edit attribution (web)
description: Web autosave must only stamp/push a run edit when form values actually changed vs stored, or multi-device sync clobbers real data.
---

# Web autosave edit attribution

The web per-run autosave effect (`home.tsx`, the `[v]` effect on `const v = form.watch()`) must treat a form change as a real edit — `saveRunValues` + `markRunValuesUpdated` + `lastLocalEditRef` + `schedulePush` + `flashSaved` — **only when `v` differs from `loadRunValues(runId)`** (structural `deepEqual` in `storage.ts`). If equal, return early.

**Why:** `form.watch()` re-fires on every programmatic `form.reset(...)` too — run switch, sync-apply (`form.reset(merged)`), daily rollover, post-login load. Stamping those non-edits with a fresh `markRunValuesUpdated(now)` re-times already-stored values as a brand-new local edit. With the app open on 2+ devices/tabs this creates a ping-pong: each device re-stamps loaded/stale/empty values, which then win the per-run lost-update guard in `/api/sync` and overwrite the peer's genuine edit. Symptom users hit: "I enter cases needed / setup data and it vanishes" in production (recurred 4×; was NOT the earlier server-cache fix).

**How to apply:** Keep the `deepEqual(loadRunValues(runId), v)` early-return at the top of that effect. The form is initialized from `loadRunValues(currentRunId)` so `v` starts correct (guard is safe at mount). Genuine writes (typing, fill-missing/voice/AI `setValue`, apply-profile, copy-run) differ from stored → still stamped/pushed. Pure loads/switches/sync echoes equal stored → skipped. Non-form pushes (run metadata, list changes, periodic/stale-repush) go through their own `schedulePush` and are unaffected.

**Parity:** mobile was already correct — `diffStampRunEdits` (`context/sync/mapping.ts`) only stamps when a value differs from a primed baseline. This change closes the gap by making web match mobile's "stamp genuine changes only" model. No mobile code change needed; do not regress web back to unconditional stamping.

`deepEqual` semantics: objects key-order-insensitive, arrays compared by index (recipe-row order is meaningful). Worst case if it ever fails to match a true echo = one spurious stamp (current pre-fix behavior), so the guard is safe.
