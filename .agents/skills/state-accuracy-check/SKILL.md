---
name: state-accuracy-check
description: >
  Verify that timers, counters, and live state remain accurate and consistent
  after modifying LiveRunContext, useAutoTrack, autosave logic, press/freezer
  math, dough supply, or pause/resume handling. Use this skill whenever you
  touch any of those areas to prevent silent accuracy regressions from shipping.
  Triggers on changes to: LiveRunContext.tsx, useAutoTrack.ts, home.tsx autosave
  effect, press-done / pressCasesLeft math, dough tray/batch supply logic,
  run pause or resume handlers, SSE sync receive, or cross-run form resets.
---

# State Accuracy and Consistency Check

Use this skill **before completing any task** that touches:
- `artifacts/run-calculator/src/contexts/LiveRunContext.tsx`
- `artifacts/run-calculator/src/hooks/useAutoTrack.ts`
- The autosave `useEffect([v])` block in `artifacts/run-calculator/src/pages/home.tsx`
- Press/freezer math (`pressCasesLeft`, `pressDone`, `casesInFreezer`)
- Dough supply counters (`traysOnLine`, `batchesReady`, auto-track tick effects)
- Run pause/resume handlers (`pausedAt`, stoppage recording, `runStatus` transitions)
- SSE sync receive or `form.reset()` call sites

---

## Six Accuracy Categories

### 1. Clock Isolation

**Where:** `LiveRunContext.tsx` — `useClock(runStatus)`, `liveFreezerMin`, `nowTime`

**Failure mode:** Any component that subscribes to `nowTime` re-renders once per second. Adding a new consumer of `useLiveRun()` in a screen that has no live clock display burns CPU/battery on every tick.

**What to verify:**
- Only screens that *must* update every second call `useLiveRun()` and read from `calc` or `nowTime` directly.
- Non-live screens (settings tabs, schedule editor, etc.) read `run` from `useRun()` and call `computeCalc(run, Date.now())` locally — they must NOT pull `calc` from the live context.
- The module-level `calcRef` (`LiveRunContext.tsx:122`) lets `home.tsx` read the latest calc without subscribing. Never remove this escape hatch.
- Mobile has a parallel `useRunClock()` context for the same purpose. Changes to the web clock-isolation model do NOT automatically apply to mobile — note the divergence and track it separately.
- **Test:** `contexts/__tests__/LiveRunContext.clock-isolation.test.tsx` — run it and confirm it passes after any change to the provider's value shape.

---

### 2. Auto-Track Counters (cases/skids)

**Where:** `useAutoTrack.ts` — case tick block (~line 450+), `lastExpectedCasesRef`, `formResetSkippedRef`

**Failure mode A — stale-delta catch-up:** After a long pause or SSE form-reset the form shows 0 cases while `lastExpectedCasesRef` still holds a large accumulated value. The first post-resume tick computes `delta = expectedRaw − old_prevExpected` and writes that whole backlog on top of 0 (e.g. 54 instead of 524).

**Failure mode B — absolute vs. incremental:** Skids/cases must be applied **incrementally** (each tick adds the delta since the last tick onto the current total). An absolute write based on elapsed-time `expectedCases` silently overwrites operator corrections on the next bucket.

**Failure mode C — delta must use unclamped raw:** `lastExpectedCasesRef` must track `expectedCasesRaw` (unclamped), not `expectedCases` (clamped to `casesNeeded`). Once the time estimate saturates at `casesNeeded`, a clamped-delta source pins to 0 forever; after an operator corrects the count down, auto-track can never climb again.

**What to verify:**
- `formResetSkippedRef`: when `curTotal === 0 && prevExpected > casesPerSkid`, the first tick skips the write and re-baselines. The NEXT tick writes normally with a delta of ~1. The ref is cleared in `resetBookkeeping()`.
- `lastExpectedCasesRef` is updated to `expectedCasesRaw` **unconditionally** on every case tick (even suppressed ones), so bookkeeping never drifts.
- The freezer-tunnel offset: `expectedCasesRaw = floor((elapsedMinAfterTunnel × ppm) / pizzasPerCase)` where `elapsedMinAfterTunnel = max(0, elapsedMin − freezerTime)`. The `doughFeedComplete` gate uses raw elapsed (no offset). Never re-couple these two timelines.
- The case counter is clamped at write time: `Math.min(target, Math.max(curTotal, casesNeeded))` — it can never cycle past the run's target.
- Skids are derived from the same running total so they roll automatically at the right case count.

---

### 3. Auto-Track Counters (dough trays/batches)

**Where:** `useAutoTrack.ts` — tray/batch tick blocks, `traysRemainderRef`, `traySeededRef`, `batchSeededRef`

**Failure mode A — remainder carry:** Per-tick flooring discards sub-unit consumption. Without a fractional carry (`traysRemainderRef`), any tray depleting at < 1 unit per tick freezes at its start value and never moves.

**Failure mode B — effect declaration order:** The three baseline-reset effects (runId change, auto-track toggle, run-stopped) must be declared **before** the tick-write effect. With write-first ordering, the mount pass writes, then the reset wipes the remainder ref — freezing slow-depleting batches and causing a double-decrement.

**Failure mode C — over-depletion past run need:** Tray/batch decrements must be gated on `doughFeedComplete` (web: `calc.pressDone`, count-based). Without this gate, counters keep depleting after the run is satisfied and the "Suggest" button keeps re-firing.

**Failure mode D — zero-seed:** Crews that never enter staged dough see counters sit at 0 the whole run. A one-shot per-run seed (`traySeededRef`, `batchSeededRef`) fires at the first eligible tick when the counter is still 0, seeding with `suggestedDoughStaging(traysNeeded, batchesNeeded)`.

**What to verify:**
- `traysRemainderRef` is advanced **only when not suppressed** and **not dough-timer-paused**. Suppressed ticks advance bookkeeping refs but skip writes and remainder updates (accepted <1-unit lag).
- All three bookkeeping refs (`traysRemainderRef`, `traySeededRef`, `batchSeededRef`) reset in `resetBookkeeping()` — alongside all due-time refs.
- `traySeededRef` and `batchSeededRef` re-seed mid-run on remount if the counter is legitimately 0 (self-consistent).
- Rate-based cadence: tray period = `perTray/ppm` min; batch production period = `perBatch/ppm/4` min (quarter-batch so integer count drops once per full batch via remainder carry). Both clamped 2s–60min via `clampPeriodMs`.
- **No configurable fixed-interval**: a user-requested fixed refresh interval was explicitly rejected — do not reintroduce it.

---

### 4. Dough Supply and Pause Consistency

**Where:** `useAutoTrack.ts` — `pauseDoughTimers()`, `resumeDoughTimers()`, the `runStatus === "running"` effect (~line 416), `doughTimerPausedRef`

**Failure mode:** The independent dough-timer pause (`doughTimerPausedRef`) and the global run pause (`runStatus === "paused"`) can desync. If a dough pause is set before a global pause, the global resume might not clear it, leaving dough timers frozen when the line is actually moving.

**What to verify after any pause/resume change:**

| System | How paused | How resumed | What resets |
|---|---|---|---|
| Global run clock | `runStatus = "paused"`, `pausedAt` set | `runStatus = "running"`, `pausedAt` cleared | `liveFreezerMin` freezes at `pausedAt` level |
| Cases/skids auto-track | Freezes when `runStatus !== "running"` | Re-arms `caseNextDueMsRef = 0` on resume | `lastExpectedCasesRef` kept (no catch-up jump) |
| Tray/batch consumption | `trayLastMsRef = 0`, `trayNextDueMsRef = 0` on resume | Re-arms from zero on `runStatus = "running"` effect | Consumption delta never spans the pause gap |
| Dough-timer independent pause | `doughTimerPausedRef.current = Date.now()` | `doughTimerPausedRef.current = 0` + all tray/batch due refs zeroed | Cleared by `runStatus = "running"` effect AND `fireAutoTrackNow()` |
| Freezer ramp | Freezes at `pausedAt` in `liveFreezerMin` | Resumes from frozen level | Never counts pause gap as run time |
| Press-done model | `pressDone` = count-based (`casesCompleted + casesInFreezer ≥ casesNeeded`) | Unaffected by pause | `adjustedTimeSec` uses `pressCasesLeft` while live |

- After a global resume, `trayLastMsRef` and `batchLastMsRef` must both be 0 so the first post-resume tick does not compute a delta spanning the full pause duration (consumption overshoot).
- `trayProdNextDueMsRef` must also be 0 on resume so the production ticker re-phases from now, not from a stale pre-pause timestamp.
- `hopperProdNextDueMsRef = 0` on resume restarts the hopper countdown display from full duration.
- Confirm: `resumeDoughTimers()` zeros all six due refs; `fireAutoTrackNow()` does the same plus clears `doughTimerPausedRef`.

---

### 5. SSE/Sync Counter Drift

**Where:** `home.tsx` — SSE receive handler, `form.reset()` call sites, `schedulePush` debounce, `lastLocalEditRef`

**Failure mode A — stale SSE echo overwriting live counts:** SSE carries day-state that was saved before the latest manual edits. If a long pause starved the push (was on a 2000ms debounce, now 600ms), an SSE echo carrying old counts arrives, resets the form to 0, and then the stale-delta guard in auto-track must catch the resulting jump.

**Failure mode B — push starvation:** Auto-track writes every ~1s. A push debounce ≥ 1000ms means every write resets the timer before it fires, and the only pushes are from the 30s interval. The debounce must be < the auto-track tick period (600ms is correct for 1s ticks).

**What to verify:**
- `schedulePush(ds)` default debounce is 600ms; do not bump it above ~900ms or push starvation returns.
- SSE receive sets `lastFormRunIdRef.current = currentId` before `form.reset()` so the autosave guard re-arms for the correct run.
- After a `form.reset()` to 0 (SSE echo), the `formResetSkippedRef` guard in `useAutoTrack` fires on the next case tick and re-baselines before writing — preventing a wrong low count (Category 2 above).
- `overlayRunMetaStamps(prev.runs)` is used for SSE LWW stamping, NOT raw React state. `saveDayState` stamps localStorage only; React state keeps the old stamp until the next render. Using raw state causes `startedAt` to be erased by a stale echo.

---

### 6. Press-Done Model

**Where:** `LiveRunContext.tsx` — `pressCasesLeft`, `pressDone` in the `calc` useMemo; `useAutoTrack.ts` — `doughFeedComplete`; `useNotifications` — two-stage switchover latches; `home.tsx` — next-run pre-seed effect

**Both platforms.** Mobile `pressDone` is count-based (`casesCompletedTotal + casesOnLine >= casesNeeded`) matching web semantics — see `_archived/mobile/context/RunContext.tsx`. Mobile's separate `doughFeedComplete` gate (used to stop tray/batch auto-track) uses a time-based `feedCasesRaw` (elapsed with no tunnel offset), which is a distinct gate from `pressDone` — do not conflate the two.

**Core invariant:** `pressDone = casesCompleted + casesInFreezer >= casesNeeded` (count-based, NOT elapsed-time). This is the correct trigger because the dough crew's work ends when everything is either cased or in the freezer tunnel — the physical press is done.

**What to verify:**
- `pressCasesLeft = max(0, casesNeeded − casesCompleted − casesInFreezer)` — never negative.
- `adjustedTimeSec` uses `pressCasesLeft` only while the run is live (`startedAt && !endedAt && casesNeeded > 0`); all other cases fall back to `casesForTiming`.
- The two-stage warehouse switchover alerts use **independent Set latches** per run ID (`switchover-frontline-${runId}`, `switchover-packaging-${runId}`) — not a single flag. Both must arm and re-arm correctly when the run ID changes.
- Dough auto-track stop: `useAutoTrack` receives `calc.pressDone` as the `pressDone` field of its `calc` param. The tray/batch decrement gate checks `calc.pressDone`, not elapsed time.
- Next-run pre-seed: when `pressDone` flips true, a one-shot effect seeds `traysOnLine`/`batchesReady` on the NEXT unstarted non-crust run via `markRunValuesUpdated`. Guards: skip if crew already entered values, skip cast/wall screens, skip if auto-track is off, latch consumed only after an actual write.
- The carry-over card was removed (2026-07-10). `carryOverDone` field is kept only for sync compat — do not revive it or depend on it for logic.

---

## Cross-Run Safety Checklist

These are the three lines of defense against a form reset clobbering another run's data. Verify all three are intact after any autosave, form.reset, or run-switch change.

### Line 1: `lastFormRunIdRef` guard in autosave

**Location:** `home.tsx` autosave `useEffect([v])`

```
if (lastFormRunIdRef.current !== runId) return;
```

This ref must be set **at every `form.reset()` call site** that resets to a specific run's values:
- `switchToRun` → set to `newId`
- SSE sync receive → set to `currentId`
- Form-heal `useEffect([currentRunId])` — BOTH the heal branch AND the else branch (the else branch must stamp the ref or the autosave is permanently blocked for that run)
- Profile-update-into-open-form → set to `liveRun.id`
- Schedule editor commit → set to `newRuns[newIndex].id`
- First load / midnight reset → set to `firstId ?? ""`
- Fresh/default reset → set to `""`

**Check:** after adding any new `form.reset()` call, confirm `lastFormRunIdRef.current` is set to the target run ID in the same handler.

### Line 2: Empty-over-populated guard in `saveProfile`

**Location:** `storage.ts` — `saveProfile()`

`saveProfile` refuses to overwrite a profile that has real data when the incoming form values are blank/default. This central guard covers ALL call sites.

**Check:** `profileObjHasRealData(incoming)` must return false only for genuinely blank/default forms. Use `isAllDefaultRunValue` (recognizes both all-zero and legacy pep-25 shapes) — do NOT use a blanket "any non-zero number = real" check (legacy stored blanks can carry old non-zero defaults and would break the self-heal).

### Line 3: `shouldResetFormOnRunSwitch` deep-equality guard

**Location:** `storage.ts` — `shouldResetFormOnRunSwitch()`

When the form is not yet settled for the new run AND its values differ from the new run's default-merged stored copy, the form must be RESET to the stored copy — not adopted as-is. An unsettled form must never be inherited by a run it wasn't reset for.

**Check:** the else branch of the form-heal `useEffect([currentRunId])` must call `shouldResetFormOnRunSwitch` and reset when it returns true. No "quiet-window" exception — in-flight typing belongs to the OLD run.

---

## Quick Reference: What Resets Where

| Ref / State | Reset in `resetBookkeeping()` | Reset on `runStatus = "running"` | Reset by `fireAutoTrackNow()` | Reset by `resumeDoughTimers()` |
|---|---|---|---|---|
| `caseNextDueMsRef` | ✅ | — | ✅ | — |
| `trayNextDueMsRef` | ✅ | ✅ | ✅ | ✅ |
| `batchNextDueMsRef` | ✅ | ✅ | ✅ | ✅ |
| `trayProdNextDueMsRef` | ✅ | ✅ | ✅ | ✅ |
| `batchProdNextDueMsRef` | ✅ | ✅ | ✅ | ✅ |
| `hopperProdNextDueMsRef` | ✅ | ✅ | ✅ | ✅ |
| `trayLastMsRef` | ✅ | ✅ | — | ✅ |
| `batchLastMsRef` | ✅ | ✅ | — | ✅ |
| `lastExpectedCasesRef` | ✅ (→ -1) | — | — | — |
| `traysRemainderRef` | ✅ | — | — | — |
| `traySeededRef` | ✅ | — | — | — |
| `batchSeededRef` | ✅ | — | — | — |
| `drainFreezerRef` | ✅ (→ -1) | — | — | — |
| `formResetSkippedRef` | ✅ | — | — | — |
| `doughTimerPausedRef` | ✅ | ✅ (→ 0) | ✅ (→ 0) | ✅ (→ 0) |

`resetBookkeeping()` is called on: runId change, auto-track toggle, run becomes pending, run ends and drain window closes.

---

## Mobile vs. Web Parity Notes

- Web auto-track lives in `useAutoTrack.ts` (hook). Mobile auto-track lives in the `RunContext.tsx` auto-track effect.
- Mobile has `useRunClock()` (separate clock context). Web has `LiveRunContext` + module-level `calcRef`. These serve the same isolation purpose but are not the same code.
- Press-done model (`pressCasesLeft`, `pressDone`) is **web-only** as of 2026-07-10. Mobile still uses time-based `expectedCasesRaw` for the feed-complete gate. When porting, apply all six invariants above to mobile's RunContext.
- `suggestedDoughStaging()` is a shared export from `useAutoTrack.ts` on web; mobile has a verbatim copy in `RunContext.tsx`. Keep them identical whenever the formula changes.
- Manual-edit suppression window: both platforms use **1 minute** (`AUTO_SUPPRESS_MS = 1 * 60 * 1000` constant on web, `suppressAutoTrack()` sets `Date.now() + 1 * 60 * 1000` on mobile). Any new auto-tracked field must arm suppression on BOTH platforms in the same handler.
