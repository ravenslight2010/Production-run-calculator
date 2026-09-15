---
name: Background database recovery
description: Reliability boundary for retrying scheduled work after pooled PostgreSQL connections reset.
---

Retry a transient database connection failure once only when the whole scheduled pass is idempotent, transactional, or protected by a durable lease. Count failed passes in a bounded recent window so concurrent idle successes cannot mask a repeatedly failing worker, and degrade readiness only after the threshold is reached.

**Why:** Managed PostgreSQL can terminate an idle or checked-out connection while the process remains healthy. A single reset should recover on a fresh pool checkout, but broad retries of unprotected mutations can duplicate operational work and one transient reset should not cause a readiness flap.

**How to apply:** When adding a database-backed scheduler, identify its transaction, idempotency key, or lease before using the shared retry boundary. Include it in bounded background diagnostics if sustained failure can silently delay operations.