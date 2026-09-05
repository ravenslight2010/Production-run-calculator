---
name: Pool acquisition deadlines
description: "Pool checkout timeouts must cancel queued node-postgres waiters before caller fallback deadlines expire."
---

The node-postgres pool's `connectionTimeoutMillis` is the cancellation-safe
boundary for saturated checkout queues: it removes a pending waiter when the
deadline fires. An outer `Promise.race` only stops the caller from waiting and
can leave the pool queue occupied. Shared callers with their own fallback
deadlines need the pool timeout set strictly below those deadlines.

**Why:** PostgreSQL statement and lock timeouts begin only after a transaction
obtains a client, so a saturated pool can otherwise make health diagnostics
wait indefinitely and consume more queued capacity.

**How to apply:** When adding bounded database diagnostics or health probes,
prefer the pool's built-in acquisition timeout and leave enough margin for the
caller to execute its safe fallback. Verify both prompt response and zero
pending waiters under full checkout contention.