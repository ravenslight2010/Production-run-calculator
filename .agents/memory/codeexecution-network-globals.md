---
name: CodeExecution network globals
description: Runtime availability of network globals in the durable CodeExecution sandbox.
---

In the durable CodeExecution impure sandbox, `fetch` may be available while `AbortSignal` is not. Do not assume Node's full network globals are present.

**Why:** A bounded public-health check failed when the request tried to use `AbortSignal.timeout`; the fetch itself was available.

**How to apply:** Before relying on timeout helpers in an impure network call, verify the specific global exists or use an available registered callback. Keep public requests limited to the minimum required endpoints.
