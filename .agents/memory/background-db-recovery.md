---
name: Background database recovery
description: Reliability boundary for retrying scheduled work after pooled PostgreSQL connections reset.
---

Retry a transient database connection failure once only when the whole scheduled pass is idempotent, transactional, or protected by a durable lease. Count failed passes in a bounded recent window so concurrent idle successes cannot mask a repeatedly failing worker, and degrade readiness only after the threshold is reached.

Classify known connection errors through a short, cycle-safe `cause` chain, including pg-pool checkout timeout messages. Keep job claim plus attempt creation, and job finalization plus attempt completion, in single transactions. If post-handler finalization fails, leave the running lease intact; an expired-lease reclaim closes the prior attempt as retrying before starting another one.

Persist the bounded failure window in shared, payload-free diagnostics. Await a short, database-deadlined persistence attempt before a failed pass settles; serialize per-operation retention, and merge shared counts with local counts so an immediate probe cannot race an in-flight write. Shared reads must have the same short deadline and fall back locally.

A replacement process may fence predecessor failures only after it completes the same operation successfully. Tag failures with a unique process identity: later local successes may fence that process's own failures, but must never fence failures emitted by another instance during the current process epoch.

For transaction retries that rebuild automatic claims, capture a stable event-ID namespace outside the retry callback and reuse it for the same date transaction. The claim ledger must deduplicate an ambiguous commit reply; wall-clock bookkeeping must match the accepted generation and sequence, not only the event ID, before advancing.

**Why:** Managed PostgreSQL can terminate an idle or checked-out connection while the process remains healthy. A single reset should recover on a fresh pool checkout, but broad retries of unprotected mutations can duplicate operational work. Separate lifecycle transactions and durable leases also make ambiguous claim/finalization replies recoverable without recording false handler failures.

**How to apply:** When adding a database-backed scheduler, identify its transaction, idempotency key, or lease before using the shared retry boundary. For durable jobs, make paired job/attempt state transitions atomic and only classify handler execution errors inside the handler boundary. Include silently delayed work in bounded background diagnostics. Retain only a fixed operation identifier, opaque process identity, sanitized bounded error code, and timestamp. Test predecessor recovery and a concurrently failing peer separately.

**Why:** A callback can commit successfully and lose its database reply. Rebuilding random claim IDs may then apply the next due effect as though it were the original retry, and event-ID-only wall checks can advance bookkeeping for a sequence that was never accepted.

**How to apply:** For scheduled transaction callbacks that construct claims, create one namespace before the retry wrapper and include it in each event ID. On replay, the durable ledger must fence the event before side effects; only advance dependent cursors when the exact generation, sequence, and event ID were accepted.