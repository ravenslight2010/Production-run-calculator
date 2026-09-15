---
name: Background database recovery
description: Reliability boundary for retrying scheduled work after pooled PostgreSQL connections reset.
---

Retry a transient database connection failure once only when the whole scheduled pass is idempotent, transactional, or protected by a durable lease. Count failed passes in a bounded recent window so concurrent idle successes cannot mask a repeatedly failing worker, and degrade readiness only after the threshold is reached.

Persist the bounded failure window in shared, payload-free diagnostics. Await a short, database-deadlined persistence attempt before a failed pass settles; serialize per-operation retention, and merge shared counts with local counts so an immediate probe cannot race an in-flight write. Shared reads must have the same short deadline and fall back locally.

**Why:** Managed PostgreSQL can terminate an idle or checked-out connection while the process remains healthy. A single reset should recover on a fresh pool checkout, but broad retries of unprotected mutations can duplicate operational work and one transient reset should not cause a readiness flap.

**How to apply:** When adding a database-backed scheduler, identify its transaction, idempotency key, or lease before using the shared retry boundary. Include it in bounded background diagnostics if sustained failure can silently delay operations. Retain only a fixed operation identifier, sanitized bounded error code, and timestamp.