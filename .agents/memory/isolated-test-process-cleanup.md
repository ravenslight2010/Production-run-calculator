---
name: Isolated test process cleanup
description: Prevent timed-out test descendants from outliving cleanup of their disposable database.
---

Keep ownership of a test session after its direct timeout wrapper exits; a reaped leader does not prove the test process tree is gone. Drain the process group with TERM, escalate to KILL when needed, and confirm no live session members remain before stopping the disposable database. If that confirmation fails, skip database shutdown and preserve its data directory with a warning.

**Why:** Timeout wrappers can stop their direct command while API/test grandchildren remain alive. Database teardown must not race against those descendants, and SIGKILL delivery is not itself proof that they have exited.

**How to apply:** For isolated test runners that launch a dedicated session, retain its leader/session ID through normal timeout completion and signal cleanup. Test timeout expiry with fake descendants and fake database commands; never use a shared or production database for process-cleanup regressions.
