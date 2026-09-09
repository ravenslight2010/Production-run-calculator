---
name: Browser E2E disposable database
description: Destructive Playwright suites require an explicitly disposable database identity before fixture setup can run.
---

Destructive browser suites must use a database whose name contains an explicit
e2e/test/tmp/temporary marker (or a local database) in addition to the approved
test-mode flags. A shared development database is intentionally rejected even
when the browser URL and credentials are otherwise available.

**Why:** These suites delete live-day rows and mutate shared master data during
fixture setup; environment flags alone are not enough to prove that the target
is disposable.

**How to apply:** Before running recipe-refresh or similar browser coverage,
prepare a dedicated disposable Postgres database through the repository's
isolation setup, then run the suite with the approved test flags. If only a
shared database is configured, report the browser run as blocked rather than
weakening the guard.