---
name: Workspace-local pnpm tool bootstrap
description: Distinguish package-manager bootstrap recursion from a project validation failure.
---

Selecting the pinned Node executable does not select the pinned pnpm executable.
When pnpm's tool cache is nested inside the workspace, an older system pnpm can
recursively try to install the workspace's pinned pnpm version: its temporary
installer inherits the ancestor workspace's package-manager requirement.

**Why:** Completion validation repeatedly attempted to provision pnpm without
ever reaching TypeScript, while invoking the exact pinned pnpm directly reached
the project scripts. A long-running validation entry is not proof the named
check actually started.

The older system manager's version switcher also expects a legacy tool-cache
bin directory. A newer manager can install successfully into its normal
node_modules/.bin layout while leaving that legacy entry absent, so provisioning
can continue to recurse even after a direct invocation works.

**How to apply:** Inspect the retained command output and resolve both runtime
versions before diagnosing project code. Use the existing verified Node/HTTPS
runner and the exact package-manager pin to repair tool provisioning. Do not
downgrade the pin, disable strict checks or TLS, or label an unstarted check
passed. Verify the bare manager's version and expected cache-bin layout before
retrying completion; installation success alone is insufficient.

Recursive bootstrap can exhaust the container's process/thread limit before
any project check starts, making unrelated shell commands and app workflows
fail with resource errors.

**Why:** Concurrent workflow launches amplified one recursive version switch
into dozens of installer processes; the application code was not the cause.

**How to apply:** Inspect process ancestry when resource errors accompany a
version-switching install. Stop only the confirmed recursive installer tree,
repair the exact pinned tool's cache entry, then restore affected app workflows.
Do not respond by lowering test coverage or changing the repository's pin.
