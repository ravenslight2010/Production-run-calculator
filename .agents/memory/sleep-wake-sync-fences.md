---
name: Sleep-wake sync fences
description: Foreground recovery must fence already-queued timers and rebase missing-row partial writes from an explicit empty snapshot identity.
---

Wake recovery is not safe if only the scheduling function checks the barrier: a timer callback already in the event queue must re-check the barrier and build from the current day-state ref. A partial fallback for a missing row also needs an explicit empty canonical snapshot identity and a forced complete seed; otherwise the next replay can send another unusable partial delta or an unbased complete write.

**Why:** A sleeping tab can wake with a queued pre-sleep callback or stale partial baseline after another device has advanced the shared row.

**How to apply:** When changing Home sync recovery, audit timer callbacks and retry callbacks separately from their enqueue guards, and keep missing-row fallback response identity, completeness, and retry construction aligned.