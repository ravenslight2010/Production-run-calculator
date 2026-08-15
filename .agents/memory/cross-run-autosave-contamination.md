---
name: Cross-run autosave contamination
description: Why the autosave can stamp one run's form values onto a different run's localStorage/profile slot, and how lastFormRunIdRef prevents it.
---

## The Bug

`useEffect([v])` (the autosave) reads run identity from `dayStateRef.current` (always the
latest ref), but `v` (from `form.watch()`) can still carry the previous run's values if
`dayState.currentIndex` advances before `form.reset()` re-emits.

Contamination sequence:
1. User is on Run A (BBQ Chicken). `v` = BBQ Chicken values.
2. Something (SSE sync, navigation) updates `dayState.currentIndex` → Run B (Spinach Goat Cheese).
3. `dayStateRef.current` immediately reflects Run B (refs update during render).
4. Before `form.reset(RunBVals)` fires, `v` changes slightly (field array tick, etc.).
5. Autosave fires: `runId = RunB`, `v = RunA values`, `deepEqual(stored RunB, RunA values)` = false → SAVES RunA onto RunB.
6. `saveProfile("Hannaford", "Spinach Goat Cheese", RunAValues)` contaminates the profile.
7. `propagateProfileToPendingRuns` spreads it to all matching pending runs.

## The Fix

Added `lastFormRunIdRef = useRef<string>("")` in home.tsx (near `lastLocalEditRef`).

**Guard in autosave** (early return):
```
if (lastFormRunIdRef.current !== runId) return;
```

**Updated everywhere `form.reset()` is called** with run-specific values to also set:
```
lastFormRunIdRef.current = <that run's id>;
```

Call sites stamped:
- `switchToRun` → `newId`
- SSE sync receive → `currentId`
- Form-heal `useEffect([currentRunId])` → `currentRunId` (both the heal branch AND the else branch, so the first genuine edit after a switch isn't blocked)
- Profile-update-into-open-form → `liveRun.id`
- Schedule editor commit → `newRuns[newIndex].id`
- First load / midnight reset → `firstId ?? ""`
- Fresh/default reset → `""`

**Why** the `else` branch in the form-heal effect matters: when no heal is needed (stored
equals form), we still need to stamp the ref so the autosave isn't permanently blocked for
that run. Without it, the autosave would skip every genuine user edit after a clean switch.

## Residual Hole (fixed later): the else-branch settle itself contaminated

The heal effect's else branch settled the form for the new run even when the form still
showed the PREVIOUS run's populated values. `shouldHealFormFromStored` only fires on
all-default-form-over-populated-stored, so the reverse case (populated form, blank/default
stored) fell through to "settle" — and the next autosave wrote the old run's
casesNeeded/skidsCompleted/recipes into the new (blank) run's slot. Trigger paths: a peer's
day RESET (sync-apply seeds a fresh placeholder run and the index clamp lands on it) or a
fully-tombstoned run union — the placeholder's id isn't in the payload, so no form.reset
fires. This was the source of the daily contaminated "Unnamed Run" rows.

**Fix**: `shouldResetFormOnRunSwitch` (storage.ts, unit-tested): when the form is NOT
settled for the new run AND its values differ from the new run's default-merged stored
copy, RESET the form to the stored copy instead of settling. No quiet-window exception —
in-flight typing belongs to the OLD run; keeping it in the new run's form IS the bug.
Rule: an unsettled form must never be adopted as-is by a run it wasn't reset for.

## Secondary Fix

Frontline tab (LiveFrontlineTabContent): App 3 / App 4 rows now only render when they
have non-zero work (`calc.app3Batches > 0` for cheese, `calc.app3Lbs > 0` for mix).
This suppresses phantom "0.00 batches" rows that appeared from stale stored values even
after a profile was corrected.
