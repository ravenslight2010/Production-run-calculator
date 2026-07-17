---
name: Freezer WIP in completion displays
description: casesInFreezer live tunnel/on-line WIP shown additively next to cased completion; drain math and pause semantics
---

# Freezer WIP in completion displays

Completion displays show product still in the freezer tunnel / on the line as an ADDITIVE sky-blue "+N in freezer" chip and a translucent second bar segment. Cased count stays the authoritative "% Done" — the freezer number never feeds casesLeftToRun or any spreadsheet PLANNING formula. (2026-07-10 update: it DOES feed the live press-side surfaces — `pressCasesLeft`/`pressDone` count freezer contents as "made"; see `press-done-model.md`. Spreadsheet/planning math is still freezer-free.)

**Rule:** the math is the pure `computeCasesInFreezer` in `@workspace/inventory-math` — never re-inline it. While running it equals the live casesOnLine model (fill to freezerTime, freeze at pausedAt); after end it drains to zero over freezerTime, capped by the actual fill at end.

**Pause semantics gotcha:** `resumeRun` SHIFTS `startedAt` forward by the closed pause's duration, so `endedAt - startedAt` already excludes closed pauses. Only a pause still OPEN at end (run ended while paused — `endRun` clears `pausedAt` without shifting `startedAt`) must be subtracted, found via the run's stoppages list (`type === "pause"` with no end or end >= endedAt). Subtracting closed pauses again would double-count.

**Why:** non-pause stoppage downtime is deliberately NOT subtracted anywhere — the live model ignores it, and subtracting only post-end would make the number jump at "End Run".

**How to apply:** any new completion/percent surface should reuse `calc.casesInFreezer` + the shared `casesFreezerPct`/`casesPctWithFreezer` derived values; keep "Target reached!" gated on cased count only. Web-only for now (mobile parity paused).

**Post-End drain ticking (2026-07-17):** auto-track's case/skid counter keeps ticking for an ENDED run while inside the drain window (endedAt + freezerTime). During the drain the increment source is NOT the time-based expected count — it is the drop in `calc.casesInFreezer` between case ticks ("what exited the tunnel"), so cased+freezer stays constant (no double count), the count self-stops at freezer-empty, can never exceed what was pressed, and a device opening mid-drain baselines with no back-fill jump. Dough tray/batch tracking stays fully stopped for ended runs; auto-track bookkeeping is NOT reset at End anymore — the reset fires when the drain window closes. Web-only.
