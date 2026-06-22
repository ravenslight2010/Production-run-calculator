---
name: Milestone notifications must not re-fire when viewing old runs
description: Why "fire once" run-milestone alerts need an "armed" latch, not just a last-id ref, so browsing completed runs doesn't set them off.
---

# Run-milestone notifications must distinguish "just happened" from "viewing history"

Both apps fire run-milestone alerts (15-min, batch due, time's up, freezer
empty) from `useNotifications`. A milestone whose trigger condition is still TRUE
for an already-finished run (e.g. "freezer drain complete" is permanently true
once an old run's freezer has long drained) will re-fire whenever the user
selects/scrolls to that run, because the condition `remainMs <= 0` is met again.

**Bug:** the freezer-empty alert was guarded only by a single-string "last
notified run id" ref. Switching between completed runs changed the id, so the
guard passed and it fired on every completed run the user scrolled through.

**Fix / invariant:** a "completion" alert may only fire for a run we actually
*watched reach* completion. Use a two-step per-run latch:
1. **arm** the run (add id to a `Set`) only while the milestone is still pending
   (e.g. `remainMs > 0`),
2. **fire once** when it completes, only if armed and not already in the
   notified `Set`.

A run that ended long ago is never armed when you view it (its condition is
already past), so it stays silent. A run that ends while you watch arms during
the countdown, then fires exactly once at zero.

**Why:** time-based "already past" conditions are sticky-true; a last-id ref
can't tell "this just happened" from "I'm looking at an old record." The arm
latch encodes "I observed the transition."

**How to apply:** mirror web `src/hooks/useNotifications.ts` and mobile
`hooks/useNotifications.ts` exactly (strict parity). Other effects (15-min,
batch, time's up) are already safe because they gate on running/started &&
!ended, so viewing ended runs can't trigger them — keep them that way.
