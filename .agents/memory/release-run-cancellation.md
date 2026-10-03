---
name: Release-run cancellation safety
description: A stopped background release wrapper can leave an active gate process changing evidence.
---

Do not assume stopping a tracked background shell task also stopped its current gate child. Resource-heavy Chromium runs can also overlap package tests and exhaust worker creation, causing pnpm to fail before tests begin.

**Why:** A release runner continued past a wrapper stop, and a concurrent full Chromium run prevented pnpm from starting a scheduler worker. Either can leave later work running without a complete tracked result.

**How to apply:** When pausing or resuming release validation, inspect managed workflow state and the process tree, serialize browser and worker-heavy gates, and verify evidence state before treating cancellation or completion as final.

Automatic task-completion validation can start overlapping API, browser,
standard/full release, and other gates simultaneously rather than limiting itself
to the assigned fix's tests.

**Why:** That fan-out exhausted process/thread creation even with memory available,
and release-only prerequisites were also missing; scoped passing evidence did not
make the automatic completion attempt pass.

**How to apply:** Inspect registered completion checks before submission. Keep
resource-heavy checks serialized where supported, record actual failures and
missing release prerequisites, and do not use a validation bypass to turn runnable
failed checks into passing evidence.

Keep scoped bug-fix completion distinct from published release approval.

**Why:** A completion batch can require published deployment/revision identity
that is unavailable even when the fix's serial checks pass; a healthy public
probe and a deployment URL do not supply that independent binding.

**How to apply:** Repair runnable failing checks first. If an audited completion
exception is genuinely necessary for unavailable production prerequisites, name
the completed scoped evidence and preserve broader FAIL/BLOCKED outcomes. Do not
change release commands, fabricate identity, or imply a GO or publish approval.

Backgrounded child processes can inherit SIGINT as ignored, so forwarding SIGINT to a detached process group may not interrupt the command. **Why:** asynchronous shell execution can preserve ignored signal dispositions across exec, making cancellation appear handled while the browser and local servers continue. **How to apply:** create a dedicated session and restore SIGINT's default disposition before exec; let Playwright handle the graceful interrupt and reserve forced termination for that owned session.