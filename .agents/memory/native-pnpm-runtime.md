---
name: Native pnpm runtime bootstrap
description: Recovering from a recursive package-manager version bootstrap without changing engine or lockfile constraints.
---

A package-manager self-bootstrap failure is not evidence of an application
failure. Preserve the project's exact engine, lockfile, and TLS constraints while
repairing the environment.

**Why:** An older pnpm's self-install can inherit the enclosing workspace's newer
package-manager requirement and recurse. This prevented both checks and managed
development workflows from opening ports before any application code ran.

**How to apply:** Distinguish a package-manager bootstrap failure from an
application failure before changing application code. Verify the runtime and
package-manager versions used by child scripts as well as the parent command.
Keep engine, lockfile, and TLS constraints intact; machine-specific provisioning
belongs in ephemeral environment setup, not project memory.
