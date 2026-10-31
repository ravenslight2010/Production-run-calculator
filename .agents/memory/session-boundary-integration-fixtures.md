---
name: Session-boundary integration fixtures
description: Deterministic disposable-database setup for auth reset-boundary tests.
---

Session-boundary integration fixtures must make the calendar and cache lifecycle explicit: pin the facility timezone (and send the matching client date), use identities unique to the fixture, and clear module-level boundary/security caches after truncating the disposable database and during teardown.

**Why:** The sync writer keys rows by the client calendar while auth reads the facility-local boundary, and module-level caches can retain a prior case's answer. Either mismatch can make a valid live session appear authorized or unauthorized depending on host time and test order.

**How to apply:** In integration tests that write `daily_sync` and then exercise `requireAuth`, set and restore `FACILITY_TIME_ZONE`, include `today` on writes, and clear caches only after fixture reset completes.

Convergence fixtures that are not testing a reset must not manufacture a future
local reset marker merely to make a device look stale.

**Why:** A real recovery write can turn that synthetic marker into a legitimate
server-owned session boundary. Later requests and unrelated account bootstrap
checks can then fail with a daily-reset rejection, depending on cache timing.
That tests reset authorization rather than first-baseline adoption.

**How to apply:** Separate stale snapshot identity from reset lifecycle evidence.
Exercise newer-marker authorization in its dedicated reset tests; keep ordinary
baseline/reconnect fixtures free of a new reset boundary.