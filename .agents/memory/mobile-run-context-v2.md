---
name: Mobile RunContext v2
description: Key design decisions for the expanded Expo mobile RunContext and tab screens
---

# Mobile RunContext v2

## Storage key
`run-calc-mobile-v2` — bumped from v1 when the data model expanded. Any further shape changes must bump to v3 (old data is silently dropped).

## Multi-run shape
State is `{ runs: RunState[], currentIndex: number }` stored as one JSON blob. Max 30 runs matches the web.

## PPM calculation
`crustsPerCycle * cycleSpeed * speedAdjustment` is preferred. Falls back to `lineSpeedPPM` only when `crustsPerCycle === 0`. Both fields are in `RunSettings`.

## Ingredient buffer formula (matches web utils.ts)
```
pizzasForIngredients = pizzasLeft + casesPerLayer * pizzasPerCase
sauceLbs = pizzasForIngredients * sauceOzPerPizza / 16 + 30
appNLbs  = pizzasForIngredients * appNOzPerPizza / 16 + 20
pep1Lbs  = pizzasForIngredients * pep1OzPerPizza / 16 + pep1Sticks
```

## toNum guard
`toNum()` in configure.tsx must accept `string | undefined | null` — Metro can call the component before form state initializes fully, causing a crash if undefined is passed to `String.replace`.

**Why:** First render race between RunContext async load from AsyncStorage and form initial state.

## Run clock must stop at endedAt
Any elapsed/downtime math in `computeCalc` must cap at `endedAt ?? now`, never `now` alone. A finished run whose clock keeps using `now` grows forever and silently corrupts every cross-run aggregate (Summary's net run time, downtime, Today PPM).

**Why:** The Summary tab sums per-run `netElapsedSec`/`totalDowntimeSec`; an unbounded finished-run clock made shift totals drift over time.
**How to apply:** When adding new time-based stats, derive from the run's boundary, and clear `endedAt` on resume so status/timing stay consistent.

## History archive must freeze runs at the day boundary
On calendar-day rollover (load-time check: `parsed.date !== todayStr()`), archived runs must be passed through `closeOutRun(run, boundaryMs)` where `boundaryMs = midnight of today`. This sets `endedAt` on still-running runs and closes open stoppages.

**Why:** History recomputes each archived run with the live `now`. Without freezing, any run that was running at midnight keeps accruing time forever, so historical PPM/net-time drift on every app launch. Also persist the rollover result immediately (`AsyncStorage.setItem`, not just the debounced `persist`) so the new date/empty runs/history survive a relaunch.

## Auto-track bucket marker must reset on run transitions
Auto-track derives skids/cases once per wall-clock 5-min bucket (`autoBucketRef`) while running, gated by an `autoTrack` flag and a 10-min manual-edit suppression window (`autoSuppressRef`, set by `suppressAutoTrack()` from the skids/cases steppers only). A dedicated effect resets `autoBucketRef` to `-1` on `currentRun.id`/`currentRun.isRunning` change.

**Why:** The bucket guard (`bucket === autoBucketRef.current`) would otherwise skip the first auto-write after start/stop/switch-run if it lands in the same wall-clock bucket as the previous run's last write, blocking updates until the next 5-min boundary.
**How to apply:** Mobile auto-tracks only skids + casesOnSkid (no per-tray/per-batch rate or freezerTime exists here, unlike web). Any new lifecycle-sensitive ref needs the same reset effect.
