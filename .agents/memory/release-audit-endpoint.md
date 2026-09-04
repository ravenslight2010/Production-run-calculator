---
name: Release audit endpoint
description: Environment behavior to recognize when the production dependency audit cannot reach its advisory service
---

The production dependency audit is a required release gate. If pnpm audit cannot complete because the npm advisory POST times out or the configured package firewall returns 502, the release remains NO-GO; do not substitute a package install check or waive the gate.

**Why:** Release validation has encountered advisory-service outages even while package resolution and ordinary registry GET requests still worked. A partial network signal is not vulnerability evidence.

**How to apply:** Preserve the runner checkpoint with the exact endpoint failure, retry through the supported resume path when service recovery is plausible, and only continue to full evidence after the audit itself passes.