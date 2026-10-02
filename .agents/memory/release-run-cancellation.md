---
name: Release-run cancellation safety
description: A stopped background release wrapper can leave an active gate process changing evidence.
---

Do not assume stopping a tracked background shell task also stopped its current gate child. Resource-heavy Chromium runs can also overlap package tests and exhaust worker creation, causing pnpm to fail before tests begin.

**Why:** A release runner continued past a wrapper stop, and a concurrent full Chromium run prevented pnpm from starting a scheduler worker. Either can leave later work running without a complete tracked result.

**How to apply:** When pausing or resuming release validation, inspect managed workflow state and the process tree, serialize browser and worker-heavy gates, and verify evidence state before treating cancellation or completion as final.

Backgrounded child processes can inherit SIGINT as ignored, so forwarding SIGINT to a detached process group may not interrupt the command. **Why:** asynchronous shell execution can preserve ignored signal dispositions across exec, making cancellation appear handled while the browser and local servers continue. **How to apply:** create a dedicated session and restore SIGINT's default disposition before exec; let Playwright handle the graceful interrupt and reserve forced termination for that owned session.