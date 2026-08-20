---
name: SSE run-meta stamp source mismatch
description: saveDayState stamps localStorage but React state keeps old metaUpdatedAt — SSE LWW must read from localStorage via overlayRunMetaStamps, not React state runs.
---

## The rule

In the SSE apply callback's per-run lifecycle LWW (and the `rejectedStale` meta check), always use `overlayRunMetaStamps(prev.runs)` / `overlayRunMetaStamps(dayStateRef.current.runs)` — never the raw React state run arrays.

**Why:** `saveDayState()` writes fresh `metaUpdatedAt` stamps to localStorage but the React state run objects keep the OLD stamp from the previous render. `startRun()` (and pauseRun, resumeRun, endRun) spread `{ ...r, startedAt: now }` from React state, so `newDs.runs[i].metaUpdatedAt` = stale React value. `overlayRunMetaStamps` takes the MAX of React state and localStorage, so it always sees the freshest stamp.

**How to apply:** Whenever the SSE functional updater or the `rejectedStale` pre-check compares local vs remote `metaUpdatedAt`, wrap the local run list with `overlayRunMetaStamps(...)`. Both sites are in `applySyncCallbackRef.current` in home.tsx.

When a local event handler can mutate lifecycle state from a ref (such as a short-lived pause decision), the accepted SSE functional updater must also advance that ref to the merged day state before returning.

**Why:** React state effects update refs after render. In that window, a visible local control can still read an obsolete paused run and issue a newly stamped write that reverts a remote resume.

**How to apply:** Set the authoritative day-state ref in both changed and no-op branches of the accepted remote merge; never leave prompt/action handlers reading only the last rendered snapshot.

**Failure mode (the recurring bug):** The "trick" push (e.g. schedule-editor save for today) used `overlayRunMetaStamps` in `buildSyncPayload`, so the push and its SSE echo carried `rr.metaUpdatedAt = T_trick`. Then the user pressed Start Run. `saveDayState` wrote `T_start > T_trick` to localStorage, but `newDs_started.runs[i].metaUpdatedAt` stayed at the old React-state value. The SSE echo from the trick arrived: `lr.metaUpdatedAt (old React) < rr.metaUpdatedAt (T_trick)` → remote wins → `startedAt` erased. Second failure: if the `startRun` push was dropped by `isSyncApplyingRef`, the `rejectedStale` meta check also used stale React stamps → false → no re-push → server never learned about the start.
