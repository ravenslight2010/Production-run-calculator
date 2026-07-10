---
name: Press-done ("finished at press") model
description: Web live-run surfaces count cased + freezer as made; pressCasesLeft drives time-left, two-stage switchover alerts, dough auto-stop, and next-run dough pre-seed
---

# Press-done ("finished at press") model — web only

The press is physically finished when everything the run needs is either CASED
or IN THE FREEZER. The web calc exposes:
- `pressCasesLeft = max(0, casesNeeded − casesCompleted − casesInFreezer)`
- `pressDone = pressCasesLeft <= 0` (only meaningful with casesNeeded > 0)

**Why:** the crew's real trigger points (switch frontline, switch packaging,
stop making dough, stage next run's dough) all happen at the PRESS, ~freezerTime
before output finishes. Time-based estimates drift when the line runs off-pace;
counts don't.

**What uses the press basis (live-run surfaces only):**
- `adjustedTimeSec` uses `pressCasesLeft` while the run is live
  (`startedAt && !endedAt && casesNeeded > 0`), else falls back to the old
  `casesForTiming` basis. This auto-propagates to Time Left / Est. Finish
  displays and the 15-min + time's-up notifications ("time's up" now = press
  done, with the existing `runWasTimedRef` + ppm>0 guards).
- Two-stage warehouse switchover: frontline alert at `pressCasesLeft ≤
  2×casesPerSkid`, packaging at `≤ 1×casesPerSkid`. In `useNotifications` these
  are TWO independent Set latches (`switchover-frontline-${runId}` /
  `switchover-packaging-${runId}`). Short runs (< 2 skids total) show a
  "stage the next 2+ runs" note instead.
- Dough auto-track stop: `useAutoTrack`'s `doughFeedComplete` is
  `calc.pressDone` (count-based), replacing the old elapsed-time estimate.
- Next-run dough pre-seed: when the current run is running and `pressDone`,
  a one-shot effect seeds the NEXT run's `traysOnLine`/`batchesReady` at
  `suggestedDoughStaging` max BEFORE its Start. Guards: skip crust runs, skip
  cast/wall screens & auto-track off, never overwrite crew-entered counts, and
  the one-shot latch is consumed ONLY after an actual write (or a deliberate
  crew-entered skip) — an incomplete next run (no cases yet) must NOT burn the
  latch or it never seeds. Must stamp via `markRunValuesUpdated` (next run isn't
  the active form, so autosave never stamps it).

**What does NOT use it:** all spreadsheet/planning formulas (`casesLeftToRun`,
`totalTimeSec`, dough/frontline planning) intentionally keep the cased-only
basis. At steady state casesInFreezer ≈ static casesOnLine so planning numbers
barely shift.

**Carry-over feature REMOVED** (2026-07-10, user request) — the old "carry over
next run's dough" card is gone; `carryOverDone` field kept only for sync compat.
Its replacement is the automatic next-run pre-seed above.

Web-only (mobile parity paused). When parity resumes, port pressCasesLeft /
pressDone, the two-stage latches, the count-based auto-track stop, and the
pre-seed effect to mobile RunContext.
