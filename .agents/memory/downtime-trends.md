---
name: Downtime trends + stall detection
description: Client-side downtime trends from synced history + advisory auto-stall nudge; where the logic lives and the accepted blind spots.
---

# Downtime trends + auto stall detection (web-only, parity paused)

## Decisions
- **Trends are computed CLIENT-SIDE, no API.** The synced 14-day `history`
  (HistoryDay carries full RunMeta incl. stoppages) plus today's `dayState.runs`
  already contain everything; `@workspace/downtime-trends.aggregateDowntime`
  is pure and runs in the browser. Don't add a server endpoint for this —
  there's no server-only data involved.
  **Why:** avoids OpenAPI/codegen churn and an auth surface for data the
  client already holds.
- Today's day is passed FIRST in the days array — `aggregateDowntime` keeps
  the first occurrence of a duplicate date, so live state wins over any stale
  history snapshot of the same date.
- Reasons are free text → bucketed case-insensitively (first spelling shown).
  Single stoppages are clamped at 12h (`MAX_SINGLE_STOPPAGE_MS`) so a
  forgot-to-end stoppage can't dominate charts; open stoppages capped at now.
- Hour-of-day buckets take `tzOffsetMin` with `Date#getTimezoneOffset()`
  semantics so they land in the operator's local clock.

## Stall detection
- `detectStallFromDelta` feeds off the web pace gauge's existing `paceDelta`
  (cases behind × pizzasPerCase ÷ ppm = minutes behind); threshold 10 min.
- Fires only when: run RUNNING (started, not ended, not paused), ppm>0,
  pizzasPerCase>0, and NO open stoppage. Advisory banner only — one tap runs
  the existing `logStop("Auto-detected stall")`; nothing auto-writes.
- **Episode latch** (per notification-view-refire lesson): shown-once ref per
  stall episode; dismiss hides it and it can't re-fire until the stall
  actually clears (and re-arms). Reset on run change. Suppressed on
  `?screen=` cast displays.
- **Accepted blind spot:** with auto-track ON the counters self-advance at
  expected pace, so stalls are only detectable from staff-maintained counts.
  Documented in code; don't "fix" by watching auto-track internals.

## Mobile port notes (when parity resumes)
- Lib is platform-free. Feed `detectStallFromDelta` from mobile computeCalc's
  pace delta — beware the casesLeft vs casesLeftToRun basis differences noted
  in frontline-formula-parity. Trends screen: local history + today's runs.
