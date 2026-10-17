---
name: Release database readiness
description: Replit workflow ordering for release checks that query the application database.
---

Before starting a release workflow with a database-backed preflight, confirm the API-server workflow has finished its schema push and reached startup-ready. Starting the release and API workflows together can make the report-key audit fail closed as unavailable. Do not weaken the audit; rerun the release check after the API is ready.

**Why:** The release preflight queried the development database while the API workflow was still applying its schema. The same check passed once API startup completed.

**How to apply:** If the report-key rotation preflight reports `audit-unavailable` during simultaneous workflow startup, check API startup logs first. Restart only the release workflow after API readiness is confirmed.

For database-backed test shards, a setup timeout in the full suite is not by itself evidence that the test hook is too short. If the same shard passes alone, first reduce concurrent database load and rerun the release suite before changing its timeout.

**Why:** The role/capability setup timed out under the full release load but passed when rerun by itself, so increasing the timeout immediately would have hidden a possible contention problem.

**How to apply:** Compare full-suite and isolated results. Keep the hook unchanged until the timeout reproduces with startup complete and competing database work removed; then optimize setup or adjust only the affected hook with measured evidence.
