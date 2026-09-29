---
name: Replit config edit validator
description: Required workspace procedure for safely changing the root .replit configuration.
---

Stage the complete proposed `.replit` file in a temporary file inside the workspace, then use the `verifyAndReplaceDotReplit` CodeExecution callback with that file's absolute path. Direct patches or shell writes to `.replit` are rejected.

**Why:** Replit validates and replaces this configuration through a controlled path, so ordinary file-editing tools cannot safely update it.

**How to apply:** Read the whole current `.replit`, make the smallest complete-file change, stage it inside the workspace, call the validator, and confirm it reports success before checking the resulting diff.