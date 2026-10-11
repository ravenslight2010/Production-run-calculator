---
name: CodeExecution network globals
description: Runtime availability of network globals in the durable CodeExecution sandbox.
---

In the durable CodeExecution impure sandbox, `fetch` may be available while `AbortSignal` is not. Do not assume Node's full network globals are present.

**Why:** A bounded public-health check failed when the request tried to use `AbortSignal.timeout`; the fetch itself was available.

**How to apply:** Before relying on timeout helpers in an impure network call, verify the specific global exists or use an available registered callback. Keep public requests limited to the minimum required endpoints.

Some durable runtime versions disable top-level `Date.now()`, despite general tool guidance describing it as available. Obtain a fresh clock value inside a small impure helper and pass the numeric timestamp back.

**Why:** A deployment-log query failed before the callback ran because the durable runtime rejected `Date.now()`; the impure clock helper succeeded.

**How to apply:** For time-bounded evidence capture, get the clock in impure scope once, then use that fixed value for all related query bounds.
