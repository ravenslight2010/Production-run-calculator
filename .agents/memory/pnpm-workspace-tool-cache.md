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

Ad-hoc external tool links can outlive their temporary targets. Also, a version
check through a shell or Node launcher is not proof that a direct child-process
spawn can execute the same entry.

**Why:** A cached link survived a resume after its target disappeared. Later,
the package's plain-text fallback worked through a shell-mediated launcher but
failed with ENOEXEC when the API starter spawned it directly.

**How to apply:** Prefer the canonical runner for checks. When restoring an
existing app workflow that uses a bare manager, verify its exact pin and a
direct child-process version check. Provision with integrity verification and
use the verified native executable or a proper executable launcher. Never
weaken TLS, change the repository pin or count an unstarted check as passed.

Recursive provisioning can exhaust the container's process/thread limit,
making unrelated app workflows fail.

**Why:** Concurrent launches once amplified a recursive version switch into
dozens of installer processes; application code was not the cause.

**How to apply:** Inspect process ancestry, stop only the confirmed recursive
installer tree, repair tool provisioning and then restore affected workflows.
