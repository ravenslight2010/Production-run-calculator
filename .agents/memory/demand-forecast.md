---
name: AI demand forecast
description: /ai/forecast predicts an upcoming day's run plan from real history; manager-gated, advisory, never auto-commits.
---

# AI demand forecast

Manager-gated, rate-limited `POST /ai/forecast` predicts an upcoming production
day's run plan (what to run, rough cases, sensible order) plus a plain-language
rationale. Grounded in real finished history + shared facility memory.

**Hard rule:** never auto-commit a forecast. The client only *seeds the editable
schedule* — web pre-fills the schedule editor dialog for the target date (manager
reviews then saves); mobile adds scheduled runs and navigates to /schedule. The
manager always reviews/adjusts before anything is planned.

**Honesty rule:** never fabricate when history is thin. The server returns a null
forecast with a `note` when there's no usable finished history (hard floor when
total finished runs is 0), and the model is instructed to express uncertainty via
the `confidence` field (high/medium/low) rather than inventing demand.

**Why:** matches the "AI never fabricates / never auto-applies" posture used across
all the other AI features (optimize, ask, photo, fill-missing). Managers must stay
in control of the schedule.

**How to apply:**
- Wire shapes live in the OpenAPI contract (`/ai/forecast`, generated `AiForecastBody`).
  Only FINISHED history runs carry demand signal — both clients filter to
  `status === "finished"` via the shared `buildOptimizeRun` before mapping to the
  compact `ForecastHistoryRun {brand,flavor,dieType,cases,netRunMin}`.
- `buildOptimizeRun` is exported from BOTH `aiOptimize.ts` files for reuse — web sig
  `(run, vals, nowMs)`, mobile sig `(run, index, nowMs)` (mobile history runs carry
  their own settings). Don't copy web call sites to mobile.
- Server records each produced forecast back through the shared facility-memory
  write path (`recordFacilityKnowledge`, domain `"forecast"`, key `plan:<date>`),
  best-effort — same pattern as the other AI memory writers.
- Forecast UI lives inside the manager gate in the Assistant tab on both apps,
  alongside optimize. Default target date = tomorrow. Web+mobile at EXACT parity
  (replit.md rule).
