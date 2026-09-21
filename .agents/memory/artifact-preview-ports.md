---
name: Artifact preview ports
description: How to identify the correct local preview endpoint for an artifact workflow.
---

Artifact web workflows can bind to a dynamic local port even when the general webview guidance mentions port 5000. Use the configured workflow's reported open port for screenshots and manual preview checks.

**Why:** The run-calculator artifact served successfully on its workflow-assigned port while port 5000 was unused, so a valid app initially looked unavailable when probed at the default port.

**How to apply:** After restarting an artifact workflow, read its status/logs and pass the reported port to preview or browser smoke tooling; do not hardcode 5000 for artifact-specific checks.