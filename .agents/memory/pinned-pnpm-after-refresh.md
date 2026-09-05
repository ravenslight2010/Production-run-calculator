---
name: Pinned pnpm after baseline refresh
description: Recovering when a baseline update raises the Node and pnpm requirements beyond the shell shim.
---

After a fast-forward raises the repository's `packageManager` requirement, the installed Node module may be current while the `pnpm` executable is still an older shim. That shim can repeatedly try to install the pinned pnpm version and abort before any script runs.

**Why:** Replit's installed language module and the repository's exact package-manager pin can advance independently. A non-interactive modules-directory replacement also aborts unless CI behavior is enabled.

**How to apply:** Confirm the required Node module is installed, invoke the exact pinned pnpm version through a one-shot launcher, and set CI mode for the first command so the dependency tree can be recreated from the frozen lockfile. Do not change project dependencies merely to repair the shell toolchain.