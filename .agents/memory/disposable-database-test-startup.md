---
name: Disposable database test startup
description: "Interpreting initial PostgreSQL fixture setup timeouts in disposable-database integration tests."
---

An initial timeout in a disposable-database test's setup hook may reflect database/schema fixture startup rather than a test failure. If the hook times out before any tests begin, retry with a longer hook timeout and confirm whether execution reaches the test body before diagnosing the code.

**Why:** A first run of the PostgreSQL integration suite timed out at the default 60-second hook limit before tests started; rerunning with a 180-second limit completed the fixture and passed.

**How to apply:** Use this only when the failure is specifically a setup-hook timeout before test execution. Do not increase timeouts to mask a test-body hang or database failure.
