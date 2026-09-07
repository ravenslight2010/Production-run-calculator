---
name: Dedicated browser test databases
description: Destructive recipe-refresh browser suites must target an explicitly disposable database.
---

Destructive browser suites must use a database whose name explicitly contains an e2e, test, tmp, or temporary marker; approval flags alone are not sufficient.

**Why:** recipe-refresh fixtures clear live-day rows and mutate shared profiles, so a generic development database is unsafe even when the test is authorized.

**How to apply:** create or select the disposable database first, point both the API workflow and Playwright command at it, then run the authenticated two-context journey.