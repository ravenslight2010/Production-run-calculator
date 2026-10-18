---
name: GitHub CI trigger access
description: Check whether this workspace can actually query or trigger GitHub Actions before treating CI as available.
---

An authorized GitHub source-control connection does not necessarily mean `gh` is authenticated in the current shell, and Agent chat cannot directly dispatch a GitHub Actions workflow.

**Why:** In one Replit task environment, binding the existing GitHub connection still left `gh auth status` unauthenticated; official Replit docs state that workflow dispatch is not directly supported through chat.

**How to apply:** Check `gh auth status` before promising a run. If unavailable, use the normal branch/PR or push trigger only when the intended revision can be delivered safely; otherwise report CI evidence as missing and name the access or trigger needed. Never describe a configured workflow as a completed run.
