---
name: Replit config edit validator
description: Required workspace procedure for safely changing the root .replit configuration.
---

Stage the complete proposed `.replit` file in a temporary file inside the workspace, then use the `verifyAndReplaceDotReplit` CodeExecution callback with that file's absolute path. Direct patches or shell writes to `.replit` are rejected.

**Why:** Replit validates and replaces this configuration through a controlled path, so ordinary file-editing tools cannot safely update it.

**How to apply:** Read the whole current `.replit`, make the smallest complete-file change, stage it inside the workspace, call the validator, and confirm it reports success before checking the resulting diff.

### Private evaluator readiness

For a private console-only service, bind its readiness listener to `127.0.0.1`, do not configure `waitForPort`, and use its explicit health command as the readiness check. Do not add a `localPort`-only mapping just to make the workflow appear healthy; keep all evaluator ports unmapped.

**Why:** Replit's port-health wait cannot be satisfied by a local-only mapping, and a managed workflow can run and report health through its own bounded readiness check without publishing any evaluator port.

**How to apply:** Keep the service console-only, confirm `waitForPort` is absent, confirm no evaluator port has an external mapping, and wait for pinned model identity through the loopback health endpoint before reporting ready.