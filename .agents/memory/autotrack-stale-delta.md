---
name: Auto-track stale-delta catch-up bug
description: How a long pause or SSE form-reset causes auto-track to write a wrong low count (e.g. 524→54), and how the guards work.
---

## The bug
After a long run pause (or an SSE form-reset that clears the form to 0 cases),
`lastExpectedCasesRef` still holds the old high expected value (e.g. 468).
On the first case tick after resuming:
- `prevExpected = 468`
- `expectedRaw = 522` (grown during the pause)
- `deltaCases = 522 − 468 = 54`
- `curTotal = 0` (form was at 0)
- `target = 0 + 54 = 54` ← wrong!

Auto-track writes 54, autosave stamps it fresh, push goes out, all peers reset to 54.

## The fix (in useAutoTrack.ts)
`formResetSkippedRef` — a single-skip guard in the delta path:

```
if (!formResetSkippedRef.current && curTotal === 0 && prevExpected > cps) {
  formResetSkippedRef.current = true;   // skip write, re-baseline
} else {
  formResetSkippedRef.current = false;  // allow write (delta ≈ 1 after re-baseline)
  // ... normal form.setValue
}
```

- First detection (curTotal=0, prevExpected>cps): skip write only. `lastExpectedCasesRef`
  was already updated to `expectedRaw` unconditionally at line 450, so next tick
  `prevExpected ≈ expectedRaw` and `deltaCases ≈ 1`.
- Second tick: `formResetSkippedRef=true` → write proceeds even if curTotal still 0
  → writes +1 from 0. Auto-track resumes correctly.
- Reset `formResetSkippedRef = false` in `resetBookkeeping()` so it never bleeds across runs.

## The push starvation fix (in home.tsx autosave)
Changed `schedulePush(ds, 2000)` → `schedulePush(ds)` (600ms default).
With 1s auto-track ticks the 2000ms debounce was always reset before it fired,
meaning the only pushes were from the 30s interval. At 600ms the push fires
between ticks (write at T=0 → push at T=600ms, next write at T=1000ms).

**Why:** Both fixes together: push starvation meant the server had stale counts
for up to 30s; the stale-delta guard prevents the wrong catch-up write even if
the form was reset to 0 by an SSE echo carrying that stale data.

## Foreground reconciliation rule

A hidden browser can wake with both a large clock jump and a stale local
case/skid baseline while another device has corrected the shared count. Treat
foregrounding as a brief synchronization boundary: block auto-track and queued
pushes, pull the client-date snapshot, and apply it through the normal inbound
merge before counting resumes.

**Why:** The stale-delta guard only recognizes the special zero-form shape. A
valid remote correction such as 31 → 4 would otherwise look like an ordinary
non-zero total, so the waking device could add its hidden-time backlog and
publish a freshly stamped overwrite.

**How to apply:** Release the barrier only after the pull path has either
adopted the normal merge result or failed without changing local state. On
release, re-base auto-track timing and expected-case bookkeeping from the
currently held form/timeline so the next write is one normal increment, never
the hidden interval. Failed pulls must remain visibly unsynchronized (normal
retry/push handling continues); they must not be recorded as a successful
remote reconciliation.
