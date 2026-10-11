---
name: Sleep-wake sync fences
description: Foreground recovery must adopt canonical state into storage and the selected form, rebase missing-row writes, and avoid phantom pending sync state.
---

Wake recovery is not safe if only the scheduling function checks the barrier: a timer callback already in the event queue must re-check the barrier and build from the current day-state ref. A partial fallback for a missing row also needs an explicit empty canonical snapshot identity and a forced complete seed; otherwise the next replay can send another unusable partial delta or an unbased complete write.

**Why:** A sleeping tab can wake with a queued pre-sleep callback or stale partial baseline after another device has advanced the shared row.

**How to apply:** When changing Home sync recovery, audit timer callbacks and retry callbacks separately from their enqueue guards, and keep missing-row fallback response identity, completeness, and retry construction aligned.

After a successful foreground pull has resolved the run-value LWW merge, the selected form must adopt that canonical value even if an ordinary quiet-window or push-acknowledgment guard would delay a reset. Keep the override limited to that successful foreground path; strictly newer local edits and empty-over-populated protection still win.

**Why:** Canonical values can already be durable while the open form still shows pre-wake counters. A later form save could then publish the stale values again.

**How to apply:** When the foreground merge is authoritative for the selected run, bypass only the ordinary quiet/ack gates. Retain the local-versus-remote stamp comparison and blank guard, and verify both canonical adoption and local-newer preservation.

An unchanged payload that already matches the last acknowledged signature must short-circuit before the scheduler marks a write pending. A timer-level no-op check is too late if an effect keeps scheduling the same payload.

**Why:** Repeated unchanged scheduling can leave the UI reporting a pending write even though no request is sent, blocking wake and sync-drain checks indefinitely.

**How to apply:** Rebuild the current payload at the scheduling boundary and skip only when the prior write is acknowledged and the full signature matches; real unsaved changes must still enter the queue.