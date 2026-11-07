---
name: Protected job effects
description: Cancellation and lease rules for durable or external effects executed by server jobs.
---

A server job must serialize cancellation with any protected durable or external effect. If cancellation is already committed, the effect must not start; if the effect wins the boundary, cancellation must wait until that effect commits. A long boundary must renew the same worker lease while it holds the serialization lock.

`context.commit` pins a database connection and row lock for the entire awaited callback. Keep that callback narrowly scoped: do not put routine cleanup, broad scans, separate global-DB queries, or provider/network waits inside it. A long external effect needs an explicit durable claim/lease design; do not simply remove its cancellation fence.

**Why:** A handler can ignore its abort signal after entering arbitrary side effects. Recording the job as cancelled does not undo those effects, and holding the cancellation lock without lease renewal lets another worker reclaim a still-running job. Production pool pressure also showed that a protected transaction combined with nested global-DB work can multiply connection demand.

**How to apply:** Expose the boundary through the job context and use it around the smallest scheduled effect that needs cancellation serialization. Preserve the effect’s existing idempotency and retry fences; do not add a second delivery claim path.