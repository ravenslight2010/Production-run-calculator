---
name: Live line-speed timer rebase
description: Keeps auto-track countdowns aligned when the effective line speed or cadence inputs change during a run.
---

Line-demand countdown due timestamps must be rebased from the edit instant when the effective PPM or cadence inputs change; measured mixer and hopper durations remain separate fixed-machine inputs.

**Why:** Updating the period while retaining a due timestamp created at the old speed lets the next tick fire using stale timing.

**How to apply:** Compare the live timing basis after mount, skip the initial baseline, and rearm active case/dough timers only when the basis changes; let pause/resume and run-switch paths keep their existing rebasing rules.