---
name: AI optimize assistant
description: How the /ai/optimize assistant feature is shaped and kept at web+mobile parity.
---

## Apply-action undo (web + mobile)
apply functions (web `applyOptimizeAction`, mobile `applyAction`) return optional `undo: () => void`; RecCard shows a ~6s Undo button.
**reorder undo diverges by platform — intentional:** web `moveRun` reads `dayState` from a stale closure, so undo must snapshot prior `runs`+`currentIndex` and restore via setDayState/saveDayState/schedulePush. Mobile `moveRun` is a functional `setAppState`, so undo just reverse-moves `moveRun(toIdx, fromIdx)`. Both restore prior order; don't "unify" by copying web's snapshot to mobile or mobile's reverse-move to web.

The AI assistant (`POST /ai/optimize`) reuses the photo-intake plumbing: OpenAI
JSON-mode call, Zod-validated contract via OpenAPI codegen (`AiOptimizeBody`),
rateLimit, `requireRole("manager")`, and the same raw-fetch client convention.
It returns ranked recommendation cards in three categories: `run`, `break`,
`efficiency`. No auto-apply — advisory only.

**Parity is in the shaped input, not just the formulas.** Both platforms build an
identical `OptimizeInput` (per-run `OptimizeRun` + scheduled + history) so the
model sees the same data shape regardless of platform. Keep the two builders
(`run-calculator/src/aiOptimize.ts` and `run-calculator-mobile/context/aiOptimize.ts`)
in lockstep.

**Why the downtime filters differ across platforms but mean the same thing:**
web filters `stoppage.type !== "pause"` because web has a "pause" stoppage type
that is not real downtime; mobile's stoppage types are jam/changeover/break/other
with NO "pause", so mobile counts every completed stoppage. Both reduce to "real
stoppages with an end time." Do not "fix" mobile to add a pause filter — there is
no pause type to exclude.

**How to apply:** any change to the recommendation categories, per-run fields,
benchmark/today-PPM math, or the prompt must land in BOTH builders + the server
prompt, and the OpenAPI contract must be regenerated. `benchmarkPpm` is computed
from the shaped history runs (avg actualPpm of finished runs with netElapsedSec>=60)
on both platforms — keep that identical rather than reusing each platform's own
benchmark helper.
