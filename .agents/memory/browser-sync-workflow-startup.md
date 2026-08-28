---
name: Browser sync workflow startup
description: Environment requirement for browser tests that exercise the calculator and its sync API
---

Schedule-move browser fixtures require both the calculator web workflow and the API-server workflow to be running before authentication setup begins.

**Why:** If the API workflow is stopped or stale, the first browser failure appears as an authentication `Failed to fetch` during manager promotion, which can obscure the actual test flow.

**How to apply:** Restart the existing web and API workflows after code changes, inspect startup logs, then run the sync-convergence browser suite against the approved isolated test database.