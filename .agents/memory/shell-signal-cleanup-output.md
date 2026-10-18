---
name: Shell signal cleanup output
description: Keep signal-time diagnostics visible when shell child output is redirected to a temporary log.
---

Apply output redirection to the child process rather than to a wrapper function when the wrapper's signal or exit traps need to report cleanup warnings.

**Why:** A function-level redirection also covers traps that run while the function is waiting. If the exit trap then deletes the temporary log, its cleanup diagnostics disappear with it.

**How to apply:** For shell runners that capture a subprocess log and remove it during cleanup, keep trap output on the runner's stderr and redirect only the background child command.
