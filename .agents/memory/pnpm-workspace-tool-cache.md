---
name: Workspace-local pnpm tool bootstrap
description: Run local pnpm checks with the exact workspace pin without recursive Corepack installs.
---

An older system pnpm can recursively provision the workspace's pinned manager
when its temporary installer inherits the ancestor `packageManager` setting.
This may exhaust workspace resources before the requested check starts.

**Why:** The system pnpm in this workspace repeatedly attempted to install the
workspace pin, while invoking that exact package through npm reached validation.

**How to apply:** For deterministic local validation, invoke pnpm commands
through `bash scripts/src/run-release-node.sh pnpm ...`. The runner reads the
exact workspace pin and obtains it via npm in a private temporary cache; child
commands inherit that selected pnpm, and the cache is removed afterward. Keep
the existing pinned Node and HTTPS-only safeguards enabled. Do not change
`packageManager` or the lockfile to work around local tool provisioning.
