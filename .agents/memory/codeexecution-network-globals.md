---
name: CodeExecution network globals
description: Runtime availability of network globals in the durable CodeExecution sandbox.
---

The durable CodeExecution impure sandbox has a limited set of Node-compatible globals: `fetch` may be available while `AbortSignal` and `process.cwd()` are not. Do not assume full Node runtime behavior.

**Why:** A bounded public-health check failed when the request tried to use `AbortSignal.timeout`; a separate workspace fingerprint attempt failed on `process.cwd()`. The fetch and explicit relative module import worked.

**How to apply:** Before relying on Node globals in an impure call, verify the specific global exists. Use ShellExec for workspace-root discovery and commands, and explicit paths/arguments in impure helpers. Keep public requests limited to the minimum required endpoints.

Some durable runtime versions disable top-level `Date.now()`, despite general tool guidance describing it as available. Obtain a fresh clock value inside a small impure helper and pass the numeric timestamp back.

**Why:** A deployment-log query failed before the callback ran because the durable runtime rejected `Date.now()`; the impure clock helper succeeded.

**How to apply:** For time-bounded evidence capture, get the clock in impure scope once, then use that fixed value for all related query bounds.
