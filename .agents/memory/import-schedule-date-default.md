---
name: Import/schedule date default = today
description: Which date the Excel-import + future-day schedule editor default to, and the intentional Forecast=tomorrow exception. Parity-sensitive.
---

# Import / schedule editor default date

The Excel run import AND the future-day schedule editor default to **today** and
allow selecting today (web schedule editor `min` = today, not tomorrow). Imports
stay additive regardless of the chosen day.

**Why:** user explicitly wanted to import/schedule for any day INCLUDING the current
day, with today as the default (not tomorrow).

**How to apply (keep web+mobile in lockstep):**
- Web `home.tsx`: `importDefaultDate` init, new-schedule-day default, apply-plan
  fallback, both import-default setters, and the schedule editor date `min` all use
  `todayStr()`.
- Mobile `summary.tsx` import modal `defaultDate` = `todayStr()`. Mobile
  `schedule.tsx` already defaults to today (`nextDates` starts at i=0,
  `selectedDate`=today) — no tomorrow there.

**Intentional exception — do NOT change to today:** the AI **Forecast** feature
(`AssistantTab` web + `assistant.tsx` mobile, each with its own local
`tomorrowStr()`) deliberately defaults to **tomorrow** — forecasting is future-only.
Keep that on both platforms; don't unify it with the import/schedule default.
