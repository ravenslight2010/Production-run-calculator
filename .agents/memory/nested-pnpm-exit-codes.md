---
name: Nested pnpm exit codes
description: Interpret expected nonzero CLI outcomes through recursive pnpm release wrappers.
---

When a script intentionally returns non-zero, a recursive pnpm wrapper—especially under the release-node shell wrapper—can report outer status 1 while showing the nested status in its lifecycle error.

**Why:** No-go commands legitimately return a non-zero status; treating the wrapper's status as the CLI's exact result can confuse a correctly blocked run with a different failure.

**How to apply:** Assert structured output and filesystem side effects for wrapped CLI runs. Use a direct invocation or function-level test when the exact process exit code matters.