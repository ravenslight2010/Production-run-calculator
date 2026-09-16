---
name: Factory baseline ownership
description: How to share factory-wide runtime defaults without erasing historical compatibility sentinels.
---

Factory-wide defaults used by multiple services belong in a dependency-free shared constants package. Historical values used only to recognize old persisted or stale-client shapes must remain local, explicit compatibility sentinels rather than aliases of the current runtime default.

**Why:** A baseline repeated across web, calculations, fill logic, persistence, API normalization, and blank protection can drift. Replacing a historical sentinel with the current constant would also silently break recognition when the baseline changes.

**How to apply:** Import the shared constant for current defaults and fallbacks. Keep legacy sentinels literal, document why they differ, and use a contract test that checks required consumers plus current-versus-legacy blank behavior.