---
name: Full release browser refresh
description: Full-mode release evidence depends on the entire stateful 159-case browser contract, not only retained-evaluation validation.
---

The full release evidence folder cannot be considered refreshed when the full-browser gate fails or remains checkpointed, even if standard-mode retained-evaluation verification passes.

**Why:** State-dependent browser failures can leave the full report stale while the release runner preserves an incomplete checkpoint; treating the retained inventory as sufficient would produce misleading release evidence.

**How to apply:** Run full mode against a fresh disposable database, keep the generated checkpoint until the browser gate is resolved, and only accept the folder after the runner writes and verifies a current full report with no checkpoint. For focused `-g` diagnosis, use a reporter that does not require the entire browser-case contract; never treat a focused run as full release evidence.