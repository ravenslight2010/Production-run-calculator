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

Historical package experiments need their workspace context, not just the
package directory and symlinked dependencies.

**Why:** Native pnpm can verify/materialize dependencies before running a
script. A partial archive can fail on missing catalogs or frozen-lockfile
importers before the historical command executes; a symlinked hoist root can
also be rejected. These are fixture failures, not historical application bugs.

**How to apply:** Preserve source workspace manifests, catalogs and lockfile
importers in the disposable snapshot. Install its own frozen dependencies with
unneeded lifecycle hooks disabled, and distinguish setup failure from the
command under investigation. Do not regenerate a historical lockfile to make
the experiment appear successful.
