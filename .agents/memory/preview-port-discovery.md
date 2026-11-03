---
name: Preview port discovery
description: Find the active web-workflow port when an app preview screenshot cannot connect.
---

When a managed Vite workflow is running but the screenshot tool's default port and the static `.replit` port entries refuse connections, the active server may be listening on a dynamically assigned port. A failed screenshot at the default port does not by itself mean the app is down.

**Why:** In this workspace, the active Vite listener used a port different from both the screenshot default and the listed static mappings; capturing the signed-out page at the actual listener worked without restarting the app.

**How to apply:** Check the workflow status and logs first. If the expected ports refuse connections, identify the listener owned by the active web workflow and pass that exact port to the preview screenshot. Do not restart or duplicate a running server just to guess ports, and do not inspect unrelated environment variables.
