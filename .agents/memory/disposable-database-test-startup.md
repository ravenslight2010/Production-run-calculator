---
name: Disposable database test startup
description: "Interpreting fixture setup timeouts and keeping ad-hoc PostgreSQL rehearsal clusters available."
---

An initial timeout in a disposable-database test's setup hook may reflect database/schema fixture startup rather than a test failure. If the hook times out before any tests begin, retry with a longer hook timeout and confirm whether execution reaches the test body before diagnosing the code.

For an ad-hoc local PostgreSQL rehearsal, use a unique data directory, socket directory, and port, and keep the server process attached to a live background shell until the rehearsal is done. In this workspace, a server started by `pg_ctl` in a completed shell invocation was no longer reachable in the next invocation.

**Why:** A PostgreSQL integration suite once timed out at the default 60-second setup-hook limit before tests started; retrying with a 180-second hook completed and passed. Separately, an ad-hoc cluster stopped between shell calls, showing that process lifetime must be managed explicitly for multi-command rehearsals.

**How to apply:** For test-hook timeouts, extend the hook only when it timed out before test execution; do not mask test-body hangs or database failures. For manual rehearsals spanning shell calls, keep the isolated server process alive until checks finish, then stop and remove only that disposable cluster.
