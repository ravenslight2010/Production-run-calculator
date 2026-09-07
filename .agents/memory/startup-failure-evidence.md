---
name: Startup failure evidence
description: Process-level startup probes must preserve categorized failure evidence before repeated health checks rotate bounded logs.
---

When a startup verifier polls a long-lived failed process, capture the first safe categorized startup record separately from the rolling process buffer.

**Why:** Repeated readiness probes can quickly consume a bounded log buffer and erase the original failure category, making a healthy 503 proof look flaky or uncategorized.

**How to apply:** Assert readiness status and process liveness from HTTP, assert the captured startup category separately, and retain only sanitized evidence without URLs, credentials, request data, or stack traces.