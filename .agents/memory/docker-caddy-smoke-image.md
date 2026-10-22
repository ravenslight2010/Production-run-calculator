---
name: Docker/Caddy smoke image boundary
description: Preserve test-only migration optimization and protected, reproducible CI inputs.
---

The browser smoke should use a test-only image containing the deployed database package and its migration protection script, then run real migrations against disposable PostgreSQL. Keep that target separate from production Compose; do not trade away migrations, HTTPS/API readiness, browser cases, or cleanup to improve timing.

**Why:** The full workspace migration image carries substantial unrelated dependencies. The deployed migration package can execute the same database operations with a much smaller image, while isolating that optimization from production behavior.

**How to apply:** When changing Docker/Caddy smoke construction, preserve the test-only image boundary and verify actual migration completion, HTTPS/API readiness, the full browser matrix, and resource cleanup.

The owner authorized supplying the exact reviewed reconciliation report to CI
through a protected input channel on 2026-10-22. That is not approval to publish
its contents in Git, logs, artifacts, shared image caches, or untrusted PR jobs.

**Why:** Retained workspace inputs can make local Docker builds pass while fresh
Git checkouts fail. The repository is public, so fixing reproducibility must
not turn operational evidence into a public fixture.

**How to apply:** Keep protected build inputs restricted to reviewed main-branch
code, verify their approved bytes before use, and distinguish local
fresh-checkout reproduction from an actual hosted CI run. Never bypass source
identity checks to manufacture a passing fresh build.
